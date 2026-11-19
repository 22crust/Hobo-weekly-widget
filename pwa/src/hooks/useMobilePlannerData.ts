import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, endOfMonth, format, parseISO, startOfMonth, startOfWeek, subWeeks } from "date-fns";
import { onDatabaseUpdated } from "../db/indexedDb";
import {
  clearCompletedLongTermSidebarTasks,
  clearCompletedWeeklySidebarTasks,
  createLocalEvent,
  createLocalTask,
  deleteLocalEventAll,
  deleteLocalEventAllFuture,
  deleteLocalEventThisOnly,
  deleteLocalTask,
  getAppSettings,
  getCachedCalendarEventsInRange,
  getExpandedLocalEventsInRange,
  getLongTermSidebarTasks,
  getTasksForWeekRange,
  getWeeklySidebarTasks,
  saveLocalEventAllFuture,
  saveLocalEventThisOnly,
  updateLocalEventSingle,
  updateLocalTask,
} from "../db/plannerRepo";
import {
  onGithubSyncStatus,
  pullAndMergeFromGithub,
  queueDebouncedGithubPush,
  startBackgroundGithubSync,
} from "../services/githubSyncService";
import {
  AppSettings,
  CreateLocalEventInput,
  CreateLocalTaskInput,
  GithubSyncStatusPayload,
  GoogleEvent,
  LocalTask,
  UpdateLocalEventInput,
} from "../types/planner";
import { applyAccentColor } from "../utils/accentColor";

export function useMobilePlannerData(
  currentWeekDate: Date,
  currentMonthDate: Date,
  selectedDayDate: string | null
) {
  const weekStartDate = useMemo(
    () => format(startOfWeek(currentWeekDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    [currentWeekDate]
  );
  const weekEndDate = useMemo(
    () => format(addDays(parseISO(weekStartDate), 6), "yyyy-MM-dd"),
    [weekStartDate]
  );

  const monthStartDate = useMemo(
    () => format(startOfMonth(currentMonthDate), "yyyy-MM-dd"),
    [currentMonthDate]
  );
  const monthEndDate = useMemo(
    () => format(endOfMonth(currentMonthDate), "yyyy-MM-dd"),
    [currentMonthDate]
  );

  const [weekEvents, setWeekEvents] = useState<GoogleEvent[]>([]);
  const [monthEvents, setMonthEvents] = useState<GoogleEvent[]>([]);
  const [selectedDayEvents, setSelectedDayEvents] = useState<GoogleEvent[]>([]);
  const [datedTasks, setDatedTasks] = useState<LocalTask[]>([]);
  const [weeklySidebarTasks, setWeeklySidebarTasks] = useState<LocalTask[]>([]);
  const [longTermSidebarTasks, setLongTermSidebarTasks] = useState<LocalTask[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [githubSyncStatus, setGithubSyncStatus] = useState<GithubSyncStatusPayload>({
    status: "disabled",
    last_synced_at: null,
    message: null,
  });

  const reloadData = useCallback(async () => {
    try {
      const [
        icsWeek,
        localWeek,
        icsMonth,
        localMonth,
        wTasks,
        wsTasks,
        ltTasks,
        appSettings,
      ] = await Promise.all([
        getCachedCalendarEventsInRange(weekStartDate, weekEndDate),
        getExpandedLocalEventsInRange(weekStartDate, weekEndDate),
        getCachedCalendarEventsInRange(monthStartDate, monthEndDate),
        getExpandedLocalEventsInRange(monthStartDate, monthEndDate),
        getTasksForWeekRange(weekStartDate, weekEndDate),
        getWeeklySidebarTasks(weekStartDate),
        getLongTermSidebarTasks(),
        getAppSettings(),
      ]);

      const mergeSortEvents = (a: GoogleEvent[], b: GoogleEvent[]) =>
        [...a, ...b].sort((x, y) => {
          if (x.event_date !== y.event_date) {
            return x.event_date.localeCompare(y.event_date);
          }
          if (x.is_all_day !== y.is_all_day) return x.is_all_day ? -1 : 1;
          return x.start_time.localeCompare(y.start_time);
        });

      setWeekEvents(mergeSortEvents(icsWeek, localWeek));
      setMonthEvents(mergeSortEvents(icsMonth, localMonth));
      setDatedTasks(wTasks);
      setWeeklySidebarTasks(wsTasks);
      setLongTermSidebarTasks(ltTasks);
      setSettings(appSettings);
      applyAccentColor(appSettings.accent_color);

      if (selectedDayDate) {
        const [icsDay, localDay] = await Promise.all([
          getCachedCalendarEventsInRange(selectedDayDate, selectedDayDate),
          getExpandedLocalEventsInRange(selectedDayDate, selectedDayDate),
        ]);
        setSelectedDayEvents(mergeSortEvents(icsDay, localDay));
      } else {
        setSelectedDayEvents([]);
      }
    } catch (err) {
      console.warn("[useMobilePlannerData] reloadData error:", err);
    }
  }, [weekStartDate, weekEndDate, monthStartDate, monthEndDate, selectedDayDate]);

  useEffect(() => {
    void reloadData();
  }, [reloadData]);

  useEffect(() => {
    let isDisposed = false;
    const unsubDb = onDatabaseUpdated((source) => {
      if (isDisposed) return;
      void reloadData();
      if (
        source?.startsWith("local_tasks:") ||
        source?.startsWith("local_events:") ||
        source?.startsWith("note_pages:")
      ) {
        queueDebouncedGithubPush();
      }
    });

    const unsubGh = onGithubSyncStatus((payload) => {
      if (!isDisposed) setGithubSyncStatus(payload);
    });

    const stopBg = startBackgroundGithubSync(() => {
      if (!isDisposed) void reloadData();
    });

    return () => {
      isDisposed = true;
      unsubDb();
      unsubGh();
      stopBg();
    };
  }, [reloadData]);

  const refreshNow = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await pullAndMergeFromGithub(false);
      await reloadData();
    } finally {
      setIsRefreshing(false);
    }
  }, [reloadData]);

  const actions = useMemo(
    () => ({
      refreshNow,
      addTask: async (input: CreateLocalTaskInput) => {
        await createLocalTask(input);
      },
      toggleTaskCompleted: async (task: LocalTask) => {
        await updateLocalTask(task.sync_id, { is_completed: !task.is_completed });
      },
      editTaskTitle: async (syncId: string, title: string) => {
        if (!title.trim()) return;
        await updateLocalTask(syncId, { title: title.trim() });
      },
      deleteTask: async (syncId: string) => {
        await deleteLocalTask(syncId);
      },
      moveTaskToDate: async (syncId: string, dateStr: string) => {
        const ws = format(startOfWeek(parseISO(dateStr), { weekStartsOn: 1 }), "yyyy-MM-dd");
        await updateLocalTask(syncId, {
          assigned_date: dateStr,
          assigned_week_start: ws,
          is_long_term: false,
          show_in_weekly: true,
          show_in_sidebar: false,
        });
      },
      moveTaskToWeeklySidebar: async (syncId: string) => {
        await updateLocalTask(syncId, {
          assigned_date: null,
          assigned_week_start: weekStartDate,
          is_long_term: false,
          show_in_weekly: false,
          show_in_sidebar: true,
        });
      },
      moveTaskToLongTermSidebar: async (syncId: string) => {
        await updateLocalTask(syncId, {
          assigned_date: null,
          assigned_week_start: null,
          is_long_term: true,
          show_in_weekly: false,
          show_in_sidebar: true,
        });
      },
      migrateTaskToPrevWeek: async (syncId: string) => {
        const prevWeekStart = format(
          subWeeks(parseISO(weekStartDate), 1),
          "yyyy-MM-dd"
        );
        await updateLocalTask(syncId, {
          assigned_date: null,
          assigned_week_start: prevWeekStart,
          is_long_term: false,
          show_in_weekly: false,
          show_in_sidebar: true,
        });
      },
      migrateTaskToNextWeek: async (syncId: string) => {
        const nextWeekStart = format(
          addWeeks(parseISO(weekStartDate), 1),
          "yyyy-MM-dd"
        );
        await updateLocalTask(syncId, {
          assigned_date: null,
          assigned_week_start: nextWeekStart,
          is_long_term: false,
          show_in_weekly: false,
          show_in_sidebar: true,
        });
      },
      clearCompletedWeeklySidebar: async () => {
        await clearCompletedWeeklySidebarTasks(weekStartDate);
      },
      clearCompletedLongTermSidebar: async () => {
        await clearCompletedLongTermSidebarTasks();
      },
      addLocalEvent: async (input: CreateLocalEventInput) => {
        return await createLocalEvent(input);
      },
      updateLocalEvent: async (
        seriesId: string,
        occurrenceDate: string,
        updates: UpdateLocalEventInput,
        scope: "this_only" | "all_future" | "all"
      ) => {
        if (scope === "this_only") {
          await saveLocalEventThisOnly(seriesId, occurrenceDate, updates);
        } else if (scope === "all_future") {
          await saveLocalEventAllFuture(seriesId, occurrenceDate, updates);
        } else {
          await updateLocalEventSingle(seriesId, updates);
        }
      },
      deleteLocalEvent: async (
        seriesId: string,
        occurrenceDate: string,
        scope: "this_only" | "all_future" | "all"
      ) => {
        if (scope === "this_only") {
          await deleteLocalEventThisOnly(seriesId, occurrenceDate);
        } else if (scope === "all_future") {
          await deleteLocalEventAllFuture(seriesId, occurrenceDate);
        } else {
          await deleteLocalEventAll(seriesId);
        }
      },
    }),
    [refreshNow, weekStartDate]
  );

  return {
    weekStartDate,
    weekEndDate,
    weekEvents,
    monthEvents,
    selectedDayEvents,
    datedTasks,
    weeklySidebarTasks,
    longTermSidebarTasks,
    settings,
    isRefreshing,
    githubSyncStatus,
    reloadData,
    actions,
  };
}
