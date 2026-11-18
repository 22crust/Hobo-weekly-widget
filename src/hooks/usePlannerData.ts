import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { onDatabaseUpdated } from "../db/database";
import {
  getGoogleEventsInRange,
  setGoogleEventHidden,
  unhideAllGoogleEventsInRange,
} from "../db/googleEventsRepo";
import {
  createLocalEvent,
  deleteLocalEventAll,
  deleteLocalEventAllFuture,
  deleteLocalEventThisOnly,
  getExpandedLocalEventsInRange,
  saveLocalEventAllFuture,
  saveLocalEventThisOnly,
  setLocalEventOccurrenceHidden,
  unhideAllLocalEventsInRange,
  updateLocalEventSingle,
} from "../db/localEventsRepo";
import {
  clearCompletedLongTermSidebarTasks,
  clearCompletedSidebarTasksForWeek,
  createLocalTask,
  deleteLocalTask,
  getLocalTasksInRange,
  getLongTermSidebarTasks,
  getWeeklySidebarTasks,
  migrateWeeklyTaskToWeek,
  moveLocalTaskToDate,
  moveLocalTaskToSidebar,
  toggleLocalTaskCompletion,
  updateLocalTask,
} from "../db/localTasksRepo";
import {
  createWeekImage,
  deleteWeekImage,
  getWeekImagesForWeek,
  updateWeekImage,
} from "../db/weekImagesRepo";
import {
  startBackgroundIcsSync,
  syncGoogleCalendarIcs,
} from "../services/icsSync";
import {
  onGithubSyncStatus,
  pullAndMergeFromGithub,
  queueDebouncedGithubPush,
} from "../services/githubSyncService";
import {
  CreateLocalEventInput,
  CreateLocalTaskInput,
  CreateWeekImageInput,
  GithubSyncStatusPayload,
  GoogleEvent,
  LocalTask,
  SyncStatus,
  UpdateLocalEventInput,
  UpdateLocalTaskInput,
  UpdateWeekImageInput,
  WeekImage,
} from "../types/planner";

/**
 * Shared reactive hook for querying and mutating `google_events`, `local_tasks`,
 * and `week_images` (weekly sticker layer) within `[startDate, endDate]`.
 *
 * Also coordinates non-blocking GitHub backup & sync when `enableBackgroundSync` is true:
 * - Pulls from GitHub on app launch and on manual refresh.
 * - Triggers a 15-second debounced background push whenever any local task or weekly
 *   sticker is added, edited, moved, resized, or deleted.
 */
export function usePlannerData(
  startDate: string,
  endDate: string,
  enableBackgroundSync = false
) {
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [datedTasks, setDatedTasks] = useState<LocalTask[]>([]);
  const [weeklySidebarTasks, setWeeklySidebarTasks] = useState<LocalTask[]>([]);
  const [longTermSidebarTasks, setLongTermSidebarTasks] = useState<LocalTask[]>([]);
  const [weekImages, setWeekImages] = useState<WeekImage[]>([]);
  const [calendarImages, setCalendarImages] = useState<WeekImage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSyncing: false,
    lastSyncedAt: null,
    lastError: null,
    upsertedCount: 0,
    hasConfiguredUrl: false,
  });
  const [githubSyncStatus, setGithubSyncStatus] =
    useState<GithubSyncStatusPayload>({
      status: "disabled",
      last_synced_at: null,
      message: null,
    });

  const rangeRef = useRef({ startDate, endDate });
  rangeRef.current = { startDate, endDate };
  const requestSeqRef = useRef(0);

  const reloadData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const { startDate: activeStart, endDate: activeEnd } = rangeRef.current;

    try {
      const [
        externalEvents,
        localEvents,
        rangeTasks,
        weekTasks,
        longTermTasks,
        stickers,
        calStickers,
      ] = await Promise.all([
        getGoogleEventsInRange(activeStart, activeEnd).catch((err) => {
          console.warn("[usePlannerData] getGoogleEventsInRange fallback:", err);
          return [] as GoogleEvent[];
        }),
        getExpandedLocalEventsInRange(activeStart, activeEnd).catch((err) => {
          console.warn("[usePlannerData] getExpandedLocalEventsInRange fallback:", err);
          return [] as GoogleEvent[];
        }),
        getLocalTasksInRange(activeStart, activeEnd, false).catch((err) => {
          console.warn("[usePlannerData] getLocalTasksInRange fallback:", err);
          return [] as LocalTask[];
        }),
        getWeeklySidebarTasks(activeStart, activeEnd).catch((err) => {
          console.warn("[usePlannerData] getWeeklySidebarTasks fallback:", err);
          return [] as LocalTask[];
        }),
        getLongTermSidebarTasks().catch((err) => {
          console.warn("[usePlannerData] getLongTermSidebarTasks fallback:", err);
          return [] as LocalTask[];
        }),
        getWeekImagesForWeek(activeStart).catch((err) => {
          console.warn("[usePlannerData] getWeekImagesForWeek fallback:", err);
          return [] as WeekImage[];
        }),
        getWeekImagesForWeek("calendar-permanent").catch((err) => {
          console.warn("[usePlannerData] getCalendarImages fallback:", err);
          return [] as WeekImage[];
        }),
      ]);

      const mergedEvents = [...externalEvents, ...localEvents].sort((a, b) => {
        if (a.event_date !== b.event_date) {
          return a.event_date.localeCompare(b.event_date);
        }
        if (a.is_all_day !== b.is_all_day) {
          return a.is_all_day ? -1 : 1;
        }
        return a.start_time.localeCompare(b.start_time);
      });

      if (
        seq !== requestSeqRef.current ||
        rangeRef.current.startDate !== activeStart ||
        rangeRef.current.endDate !== activeEnd
      ) {
        return;
      }

      setGoogleEvents(mergedEvents);
      setDatedTasks(rangeTasks);
      setWeeklySidebarTasks(weekTasks);
      setLongTermSidebarTasks(longTermTasks);
      setWeekImages(stickers);
      setCalendarImages(calStickers);
    } catch (err) {
      console.error("[usePlannerData] Failed to query local SQLite database:", err);
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reloadData();
  }, [startDate, endDate, reloadData]);

  // Subscribe once on mount to DB_UPDATED_EVENT; queue 15s debounced GitHub push whenever local_tasks or week_images changes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void onDatabaseUpdated((source) => {
      if (!isDisposed) {
        void reloadData();
        if (
          enableBackgroundSync &&
          (source?.startsWith("local_tasks:") ||
            source?.startsWith("week_images:"))
        ) {
          void queueDebouncedGithubPush();
        }
      }
    })
      .then((fn) => {
        if (isDisposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.warn("[usePlannerData] onDatabaseUpdated listener error:", err);
      });

    return () => {
      isDisposed = true;
      try {
        unlisten?.();
      } catch {
        // Ignore cleanup error
      }
    };
  }, [reloadData, enableBackgroundSync]);

  // Subscribe to Rust `"github-sync-status"` events + run initial GitHub pull & .ics sync on boot
  useEffect(() => {
    if (!enableBackgroundSync) return;
    let stopIcsSync: (() => void) | undefined;
    let unlistenGhStatus: (() => void) | undefined;
    let isDisposed = false;

    void onGithubSyncStatus((payload) => {
      if (!isDisposed) {
        setGithubSyncStatus(payload);
      }
    }).then((fn) => {
      if (isDisposed) {
        fn();
      } else {
        unlistenGhStatus = fn;
      }
    });

    // Purge soft-deleted rows older than 30 days on startup & pull latest planner-data.json from GitHub
    void pullAndMergeFromGithub(true).then(() => {
      if (!isDisposed) {
        void reloadData();
      }
    });

    try {
      stopIcsSync = startBackgroundIcsSync((status) => {
        if (isDisposed) return;
        setSyncStatus((prev) => ({
          ...status,
          lastSyncedAt: status.lastSyncedAt ?? prev.lastSyncedAt,
        }));
        if (!status.isSyncing) {
          void reloadData();
        }
      });
    } catch (err) {
      console.warn("[usePlannerData] startBackgroundIcsSync error:", err);
    }

    return () => {
      isDisposed = true;
      try {
        stopIcsSync?.();
        unlistenGhStatus?.();
      } catch {
        // Ignore cleanup error
      }
    };
  }, [enableBackgroundSync, reloadData]);

  const manualSync = useCallback(async () => {
    try {
      setSyncStatus((prev) => ({ ...prev, isSyncing: true, lastError: null }));
      const [icsResult] = await Promise.all([
        syncGoogleCalendarIcs(),
        pullAndMergeFromGithub(),
      ]);
      setSyncStatus((prev) => ({
        ...icsResult,
        lastSyncedAt: icsResult.lastSyncedAt ?? prev.lastSyncedAt,
      }));
      await reloadData();
    } catch (err) {
      console.warn("[usePlannerData] manualSync error:", err);
      setSyncStatus((prev) => ({
        ...prev,
        isSyncing: false,
        lastError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [reloadData]);

  // Listen for "Sync Google Calendar Now" ("trigger-sync") emitted from the System Tray menu
  useEffect(() => {
    if (!enableBackgroundSync) return;
    let unlistenTrigger: (() => void) | undefined;
    let isDisposed = false;

    void listen("trigger-sync", () => {
      if (!isDisposed) {
        void manualSync();
      }
    })
      .then((fn) => {
        if (isDisposed) {
          fn();
        } else {
          unlistenTrigger = fn;
        }
      })
      .catch(() => {
        // Fallback if running outside Tauri webview
      });

    return () => {
      isDisposed = true;
      try {
        unlistenTrigger?.();
      } catch {
        // Ignore cleanup error
      }
    };
  }, [enableBackgroundSync, manualSync]);

  return {
    googleEvents,
    datedTasks,
    weeklySidebarTasks,
    longTermSidebarTasks,
    weekImages,
    calendarImages,
    isLoading,
    syncStatus,
    githubSyncStatus,
    reloadData,
    manualSync,
    // Calendar Event visibility controls (both external feeds and local events)
    hideGoogleEvent: async (id: number, event?: GoogleEvent) => {
      try {
        if (event?.is_local && event.local_event_id) {
          await setLocalEventOccurrenceHidden(
            event.local_event_id,
            event.event_date,
            true
          );
        } else {
          await setGoogleEventHidden(id, true);
        }
      } catch (e) {
        console.error("[usePlannerData] hideGoogleEvent failed:", e);
      }
    },
    unhideGoogleEvent: async (id: number) => {
      try {
        await setGoogleEventHidden(id, false);
      } catch (e) {
        console.error("[usePlannerData] unhideGoogleEvent failed:", e);
      }
    },
    unhideAllGoogleEventsInDateRange: async (start: string, end: string) => {
      try {
        await Promise.all([
          unhideAllGoogleEventsInRange(start, end),
          unhideAllLocalEventsInRange(start, end),
        ]);
      } catch (e) {
        console.error("[usePlannerData] unhideAllGoogleEventsInDateRange failed:", e);
      }
    },
    // Local Calendar Event CRUD (`local_events`)
    addLocalEvent: async (input: CreateLocalEventInput) => {
      try {
        return await createLocalEvent(input);
      } catch (e) {
        console.error("[usePlannerData] addLocalEvent failed:", e);
        return null;
      }
    },
    editLocalEvent: async (id: string, updates: UpdateLocalEventInput) => {
      try {
        await updateLocalEventSingle(id, updates);
      } catch (e) {
        console.error("[usePlannerData] editLocalEvent failed:", e);
      }
    },
    editLocalEventThisOnly: async (
      seriesId: string,
      occurrenceDate: string,
      updates: UpdateLocalEventInput
    ) => {
      try {
        await saveLocalEventThisOnly(seriesId, occurrenceDate, updates);
      } catch (e) {
        console.error("[usePlannerData] editLocalEventThisOnly failed:", e);
      }
    },
    editLocalEventFuture: async (
      seriesId: string,
      occurrenceDate: string,
      updates: UpdateLocalEventInput
    ) => {
      try {
        await saveLocalEventAllFuture(seriesId, occurrenceDate, updates);
      } catch (e) {
        console.error("[usePlannerData] editLocalEventFuture failed:", e);
      }
    },
    removeLocalEvent: async (id: string) => {
      try {
        await deleteLocalEventAll(id);
      } catch (e) {
        console.error("[usePlannerData] removeLocalEvent failed:", e);
      }
    },
    removeLocalEventThisOnly: async (seriesId: string, occurrenceDate: string) => {
      try {
        await deleteLocalEventThisOnly(seriesId, occurrenceDate);
      } catch (e) {
        console.error("[usePlannerData] removeLocalEventThisOnly failed:", e);
      }
    },
    removeLocalEventFuture: async (seriesId: string, occurrenceDate: string) => {
      try {
        await deleteLocalEventAllFuture(seriesId, occurrenceDate);
      } catch (e) {
        console.error("[usePlannerData] removeLocalEventFuture failed:", e);
      }
    },
    // Local Task mutations
    addTask: async (input: CreateLocalTaskInput) => {
      try {
        return await createLocalTask(input);
      } catch (e) {
        console.error("[usePlannerData] addTask failed:", e);
        return 0;
      }
    },
    editTask: async (id: number, updates: UpdateLocalTaskInput) => {
      try {
        await updateLocalTask(id, updates);
      } catch (e) {
        console.error("[usePlannerData] editTask failed:", e);
      }
    },
    toggleTask: async (id: number, isCompleted: boolean) => {
      try {
        await toggleLocalTaskCompletion(id, isCompleted);
      } catch (e) {
        console.error("[usePlannerData] toggleTask failed:", e);
      }
    },
    moveTaskToDate: async (
      id: number,
      assignedDate: string,
      keepInSidebar?: boolean
    ) => {
      try {
        await moveLocalTaskToDate(id, assignedDate, keepInSidebar);
      } catch (e) {
        console.error("[usePlannerData] moveTaskToDate failed:", e);
      }
    },
    moveTaskToSidebar: async (
      id: number,
      options: {
        weekStartDate: string | null;
        isLongTerm: boolean;
        keepInDayColumn?: boolean;
      }
    ) => {
      try {
        await moveLocalTaskToSidebar(id, options);
      } catch (e) {
        console.error("[usePlannerData] moveTaskToSidebar failed:", e);
      }
    },
    migrateTaskToWeek: async (id: number, targetWeekStartDate: string) => {
      try {
        await migrateWeeklyTaskToWeek(id, targetWeekStartDate);
      } catch (e) {
        console.error("[usePlannerData] migrateTaskToWeek failed:", e);
      }
    },
    clearCompletedForWeekSidebar: async (weekStart: string, weekEnd: string) => {
      try {
        await clearCompletedSidebarTasksForWeek(weekStart, weekEnd);
      } catch (e) {
        console.error("[usePlannerData] clearCompletedForWeekSidebar failed:", e);
      }
    },
    clearCompletedForLongTermSidebar: async () => {
      try {
        await clearCompletedLongTermSidebarTasks();
      } catch (e) {
        console.error("[usePlannerData] clearCompletedForLongTermSidebar failed:", e);
      }
    },
    removeTask: async (id: number) => {
      try {
        await deleteLocalTask(id);
      } catch (e) {
        console.error("[usePlannerData] removeTask failed:", e);
      }
    },
    // Weekly Sticker Layer (`week_images`) mutations
    addWeekImage: async (input: CreateWeekImageInput) => {
      try {
        return await createWeekImage(input);
      } catch (e) {
        console.error("[usePlannerData] addWeekImage failed:", e);
        return null;
      }
    },
    editWeekImage: async (id: string, updates: UpdateWeekImageInput) => {
      try {
        await updateWeekImage(id, updates);
      } catch (e) {
        console.error("[usePlannerData] editWeekImage failed:", e);
      }
    },
    removeWeekImage: async (id: string) => {
      try {
        await deleteWeekImage(id);
      } catch (e) {
        console.error("[usePlannerData] removeWeekImage failed:", e);
      }
    },
  };
}
