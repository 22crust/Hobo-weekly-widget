import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { onDatabaseUpdated } from "../db/database";
import { generateUuid } from "../utils/id";
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
  clearCompletedTasksForBucket,
  createLocalTask,
  deleteLocalTask,
  getLocalTasksInRange,
  getSidebarTasksForWeek,
  migrateWeeklyTaskToWeek,
  moveLocalTaskToDate,
  moveLocalTaskToSidebar,
  toggleLocalTaskCompletion,
  updateLocalTask,
} from "../db/localTasksRepo";
import {
  countActiveTasksInBucket,
  createBucketDefinition,
  getActiveBucketDefinitions,
  getAllBucketLayouts,
  permanentlyDeleteHiddenBucket,
  renameBucketDefinition,
  saveBucketLayoutSnapshots,
} from "../db/bucketsRepo";
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
  pushCalendarCacheToGithub,
  queueDebouncedGithubPush,
  startBackgroundGithubSync,
} from "../services/githubSyncService";
import {
  BucketDefinition,
  BucketLayoutSnapshot,
  BucketScope,
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
  const [bucketDefinitions, setBucketDefinitions] = useState<BucketDefinition[]>([]);
  const [bucketLayouts, setBucketLayouts] = useState<BucketLayoutSnapshot[]>([]);
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

  const reloadData = useCallback(async (source?: string) => {
    const seq = ++requestSeqRef.current;
    const { startDate: activeStart, endDate: activeEnd } = rangeRef.current;

    const isTaskOnlyUpdate = Boolean(source?.startsWith("local_tasks:"));
    const isImageOnlyUpdate = Boolean(source?.startsWith("week_images:"));
    const isBucketOnlyUpdate = Boolean(
      source?.startsWith("bucket_definitions:") ||
        source?.startsWith("bucket_layouts:")
    );

    try {
      if (isTaskOnlyUpdate) {
        const [rangeTasks, sidebarTasks] = await Promise.all([
          getLocalTasksInRange(activeStart, activeEnd, false).catch(() => [] as LocalTask[]),
          enableBackgroundSync
            ? getSidebarTasksForWeek(activeStart, activeEnd).catch(() => [] as LocalTask[])
            : Promise.resolve([] as LocalTask[]),
        ]);

        if (
          seq !== requestSeqRef.current ||
          rangeRef.current.startDate !== activeStart ||
          rangeRef.current.endDate !== activeEnd
        ) {
          return;
        }
        setDatedTasks(rangeTasks);
        if (enableBackgroundSync) {
          setWeeklySidebarTasks(sidebarTasks.filter((t) => !t.is_long_term));
          setLongTermSidebarTasks(sidebarTasks.filter((t) => t.is_long_term));
        }
        return;
      }

      if (isBucketOnlyUpdate) {
        if (!enableBackgroundSync) return;
        const shouldReloadSidebarTasks = source === "bucket_definitions:delete";
        const [activeBucketDefs, allBucketLayouts, sidebarTasks] =
          await Promise.all([
            getActiveBucketDefinitions().catch(() => [] as BucketDefinition[]),
            getAllBucketLayouts().catch(() => [] as BucketLayoutSnapshot[]),
            shouldReloadSidebarTasks
              ? getSidebarTasksForWeek(activeStart, activeEnd).catch(
                  () => [] as LocalTask[]
                )
              : Promise.resolve(null),
          ]);

        if (
          seq !== requestSeqRef.current ||
          rangeRef.current.startDate !== activeStart ||
          rangeRef.current.endDate !== activeEnd
        ) {
          return;
        }
        setBucketDefinitions(activeBucketDefs);
        setBucketLayouts(allBucketLayouts);
        if (sidebarTasks) {
          setWeeklySidebarTasks(sidebarTasks.filter((t) => !t.is_long_term));
          setLongTermSidebarTasks(sidebarTasks.filter((t) => t.is_long_term));
        }
        return;
      }

      if (isImageOnlyUpdate) {
        const [stickers, calStickers] = await Promise.all([
          enableBackgroundSync
            ? getWeekImagesForWeek(activeStart).catch(() => [] as WeekImage[])
            : Promise.resolve([] as WeekImage[]),
          !enableBackgroundSync
            ? getWeekImagesForWeek("calendar-permanent").catch(() => [] as WeekImage[])
            : Promise.resolve([] as WeekImage[]),
        ]);

        if (
          seq !== requestSeqRef.current ||
          rangeRef.current.startDate !== activeStart ||
          rangeRef.current.endDate !== activeEnd
        ) {
          return;
        }
        if (enableBackgroundSync) setWeekImages(stickers);
        else setCalendarImages(calStickers);
        return;
      }

      const [
        externalEvents,
        localEvents,
        rangeTasks,
        sidebarTasks,
        stickers,
        calStickers,
        activeBucketDefs,
        allBucketLayouts,
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
        enableBackgroundSync
          ? getSidebarTasksForWeek(activeStart, activeEnd).catch((err) => {
              console.warn("[usePlannerData] getSidebarTasksForWeek fallback:", err);
              return [] as LocalTask[];
            })
          : Promise.resolve([] as LocalTask[]),
        enableBackgroundSync
          ? getWeekImagesForWeek(activeStart).catch((err) => {
              console.warn("[usePlannerData] getWeekImagesForWeek fallback:", err);
              return [] as WeekImage[];
            })
          : Promise.resolve([] as WeekImage[]),
        !enableBackgroundSync
          ? getWeekImagesForWeek("calendar-permanent").catch((err) => {
              console.warn("[usePlannerData] getCalendarImages fallback:", err);
              return [] as WeekImage[];
            })
          : Promise.resolve([] as WeekImage[]),
        enableBackgroundSync
          ? getActiveBucketDefinitions().catch(() => [] as BucketDefinition[])
          : Promise.resolve([] as BucketDefinition[]),
        enableBackgroundSync
          ? getAllBucketLayouts().catch(() => [] as BucketLayoutSnapshot[])
          : Promise.resolve([] as BucketLayoutSnapshot[]),
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
      setWeeklySidebarTasks(sidebarTasks.filter((t) => !t.is_long_term));
      setLongTermSidebarTasks(sidebarTasks.filter((t) => t.is_long_term));
      setWeekImages(stickers);
      setCalendarImages(calStickers);
      if (enableBackgroundSync) {
        setBucketDefinitions(activeBucketDefs);
        setBucketLayouts(allBucketLayouts);
      }
    } catch (err) {
      console.error("[usePlannerData] Failed to query local SQLite database:", err);
    } finally {
      if (seq === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [enableBackgroundSync]);

  useEffect(() => {
    void reloadData();
  }, [startDate, endDate, reloadData]);

  // Subscribe once on mount to DB_UPDATED_EVENT; queue 15s debounced GitHub push whenever local_tasks or week_images changes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void onDatabaseUpdated((source) => {
      if (!isDisposed) {
        void reloadData(source);
        if (
          enableBackgroundSync &&
          (source?.startsWith("local_tasks:") ||
            source?.startsWith("week_images:") ||
            source?.startsWith("local_events:") ||
            source?.startsWith("note_pages:") ||
            source?.startsWith("bucket_definitions:") ||
            source?.startsWith("bucket_layouts:"))
        ) {
          void queueDebouncedGithubPush();
        }
        if (enableBackgroundSync && source?.startsWith("calendar_events:")) {
          void pushCalendarCacheToGithub();
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
    let stopGithubSync: (() => void) | undefined;
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

    // Purge soft-deleted rows older than 30 days on startup & start 30m + focus GitHub sync
    try {
      stopGithubSync = startBackgroundGithubSync(() => {
        if (!isDisposed) {
          void reloadData();
        }
      });
    } catch (err) {
      console.warn("[usePlannerData] startBackgroundGithubSync error:", err);
    }

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
        stopGithubSync?.();
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
    bucketDefinitions,
    bucketLayouts,
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
      const nowIso = new Date().toISOString();
      const tempId = -Date.now();
      const optimisticTask: LocalTask = {
        id: tempId,
        sync_id: generateUuid(),
        title: input.title.trim(),
        notes: input.notes ?? null,
        assigned_date: input.assigned_date ?? null,
        assigned_week_start: input.assigned_week_start ?? null,
        is_long_term: Boolean(input.is_long_term),
        bucket_id:
          input.bucket_id || (input.is_long_term ? "long_term" : "weekly"),
        start_time: input.start_time ?? null,
        end_time: input.end_time ?? null,
        is_completed: false,
        show_in_weekly: input.show_in_weekly,
        show_in_sidebar: input.show_in_sidebar,
        sort_order: 0,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      };

      if (input.show_in_weekly && input.assigned_date) {
        setDatedTasks((prev) => [...prev, optimisticTask]);
      }
      if (input.show_in_sidebar) {
        if (input.is_long_term) {
          setLongTermSidebarTasks((prev) => [...prev, optimisticTask]);
        } else {
          setWeeklySidebarTasks((prev) => [...prev, optimisticTask]);
        }
      }

      try {
        return await createLocalTask(input);
      } catch (e) {
        console.error("[usePlannerData] addTask failed:", e);
        setDatedTasks((prev) => prev.filter((t) => t.id !== tempId));
        setWeeklySidebarTasks((prev) => prev.filter((t) => t.id !== tempId));
        setLongTermSidebarTasks((prev) => prev.filter((t) => t.id !== tempId));
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
      const updateList = (list: LocalTask[]) =>
        list.map((t) => (t.id === id ? { ...t, is_completed: isCompleted } : t));
      setDatedTasks(updateList);
      setWeeklySidebarTasks(updateList);
      setLongTermSidebarTasks(updateList);
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
      const all = [...datedTasks, ...weeklySidebarTasks, ...longTermSidebarTasks];
      const target = all.find((t) => t.id === id);
      if (target) {
        const moved: LocalTask = {
          ...target,
          assigned_date: assignedDate,
          show_in_weekly: true,
          show_in_sidebar: Boolean(keepInSidebar),
        };
        setDatedTasks((prev) => [
          ...prev.filter((t) => t.id !== id),
          moved,
        ]);
        if (!keepInSidebar) {
          setWeeklySidebarTasks((prev) => prev.filter((t) => t.id !== id));
          setLongTermSidebarTasks((prev) => prev.filter((t) => t.id !== id));
        }
      }
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
        bucketId?: string;
        keepInDayColumn?: boolean;
      }
    ) => {
      const resolvedBucketId =
        options.bucketId || (options.isLongTerm ? "long_term" : "weekly");
      const all = [...datedTasks, ...weeklySidebarTasks, ...longTermSidebarTasks];
      const target = all.find((t) => t.id === id);
      if (target) {
        const moved: LocalTask = {
          ...target,
          assigned_date: options.keepInDayColumn ? target.assigned_date : null,
          assigned_week_start: options.isLongTerm
            ? target.assigned_week_start
            : options.weekStartDate,
          is_long_term: options.isLongTerm,
          bucket_id: resolvedBucketId,
          show_in_weekly: Boolean(options.keepInDayColumn),
          show_in_sidebar: true,
        };
        if (!options.keepInDayColumn) {
          setDatedTasks((prev) => prev.filter((t) => t.id !== id));
        }
        if (options.isLongTerm) {
          setWeeklySidebarTasks((prev) => prev.filter((t) => t.id !== id));
          setLongTermSidebarTasks((prev) => [
            ...prev.filter((t) => t.id !== id),
            moved,
          ]);
        } else {
          setLongTermSidebarTasks((prev) => prev.filter((t) => t.id !== id));
          setWeeklySidebarTasks((prev) => [
            ...prev.filter((t) => t.id !== id),
            moved,
          ]);
        }
      }
      try {
        await moveLocalTaskToSidebar(id, {
          ...options,
          bucketId: resolvedBucketId,
        });
      } catch (e) {
        console.error("[usePlannerData] moveTaskToSidebar failed:", e);
      }
    },
    clearCompletedForBucket: async (
      bucketId: string,
      scope: BucketScope,
      weekStart: string,
      weekEnd: string
    ) => {
      try {
        await clearCompletedTasksForBucket(bucketId, scope, weekStart, weekEnd);
      } catch (e) {
        console.error("[usePlannerData] clearCompletedForBucket failed:", e);
      }
    },
    createBucket: async (title: string, scope: BucketScope) => {
      return await createBucketDefinition(title, scope);
    },
    renameBucket: async (id: string, newTitle: string) => {
      await renameBucketDefinition(id, newTitle);
    },
    saveBucketLayouts: async (snapshots: BucketLayoutSnapshot[]) => {
      await saveBucketLayoutSnapshots(snapshots);
    },
    countTasksInBucket: async (bucketId: string) => {
      return await countActiveTasksInBucket(bucketId);
    },
    deleteHiddenBucket: async (bucketId: string) => {
      await permanentlyDeleteHiddenBucket(bucketId);
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
      setDatedTasks((prev) => prev.filter((t) => t.id !== id));
      setWeeklySidebarTasks((prev) => prev.filter((t) => t.id !== id));
      setLongTermSidebarTasks((prev) => prev.filter((t) => t.id !== id));
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
