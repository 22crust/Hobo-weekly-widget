import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getAppSettings } from "../db/appSettingsRepo";
import {
  applyRemotePreferences,
  getSyncedPreferencesForBackup,
} from "../../shared/timeFormat";
import {
  getAllLocalTasks,
  purgeAllSoftDeletedRecordsNow,
  purgeExpiredSoftDeletedRecords,
} from "../db/localTasksRepo";
import {
  replaceAllLocalDataWithRemote,
  upsertRemoteBackupIntoLocal,
} from "../db/backupSyncRepo";
import { getAllWeekImages } from "../db/weekImagesRepo";
import { getAllLocalEventsForBackup } from "../db/localEventsRepo";
import { getAllNotePagesForBackup } from "../db/notePagesRepo";
import {
  getAllBucketDefinitionsForBackup,
  getAllBucketLayouts,
  getAllBucketTextEntriesForBackup,
  replaceAllBucketTextEntriesWithRemote,
  upsertRemoteBucketTextEntriesIntoLocal,
} from "../db/bucketsRepo";
import {
  getAllDateCountersForBackup,
  getAllMoodEntriesForBackup,
  replaceAllCalendarToolsWithRemote,
  upsertRemoteCalendarToolsIntoLocal,
} from "../db/calendarToolsRepo";
import { getAllCachedCalendarEvents } from "../db/googleEventsRepo";
import {
  AppSettings,
  CalendarCachePayload,
  GithubRemoteCheckResult,
  GithubSyncStatusPayload,
  LocalTask,
  PlannerBackupPayload,
} from "../types/planner";

export const GITHUB_SYNC_STATUS_EVENT = "github-sync-status";
export const CURRENT_SCHEMA_VERSION = 1;
const GITHUB_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const GITHUB_FOCUS_COOLDOWN_MS = 2 * 60 * 1000;

interface GithubPullResult {
  not_modified: boolean;
  exists: boolean;
  payload: PlannerBackupPayload | null;
}

let inFlightGithubPull: Promise<void> | null = null;
let lastGithubCheckAt = 0;

function toRustGithubConfig(settings: AppSettings) {
  return {
    storage_mode: settings.storage_mode,
    github_token: settings.github_token.trim(),
    github_owner: settings.github_owner.trim(),
    github_repo: settings.github_repo.trim(),
    github_file_path:
      settings.github_file_path.trim().replace(/^\/+/, "") || "planner-data.json",
  };
}

/**
 * Extracts `tasks` from a `PlannerBackupPayload`, supporting both the current
 * `tasks` field and any legacy `local_tasks` alias.
 */
export function extractRemoteTasks(
  payload: PlannerBackupPayload | null | undefined
): LocalTask[] {
  if (!payload) return [];
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.local_tasks)) return payload.local_tasks;
  return [];
}

/**
 * Builds the full versioned `PlannerBackupPayload` (`schema_version: 1`) snapshot
 * from local SQLite (`local_tasks` + `week_images`), including soft-deleted tombstones
 * so deletions propagate cleanly across devices.
 * Strictly excludes `google_events` and `app_settings`.
 */
export async function buildLocalBackupPayload(): Promise<PlannerBackupPayload> {
  const [
    tasks,
    images,
    localEvents,
    notePages,
    bucketDefs,
    bucketLayouts,
    bucketTextEntries,
    moodEntries,
    dateCounters,
  ] = await Promise.all([
    getAllLocalTasks(),
    getAllWeekImages(),
    getAllLocalEventsForBackup(),
    getAllNotePagesForBackup(),
    getAllBucketDefinitionsForBackup(),
    getAllBucketLayouts(),
    getAllBucketTextEntriesForBackup(),
    getAllMoodEntriesForBackup(),
    getAllDateCountersForBackup(),
  ]);

  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    tasks,
    week_images: images,
    local_events: localEvents,
    note_pages: notePages,
    bucket_definitions: bucketDefs,
    bucket_layouts: bucketLayouts,
    bucket_text_entries: bucketTextEntries,
    mood_entries: moodEntries,
    date_counters: dateCounters,
    preferences: getSyncedPreferencesForBackup(),
  };
}

/**
 * Updates the Rust backend's in-memory GitHub configuration.
 */
export async function syncConfigToRustBackend(
  settings?: AppSettings
): Promise<AppSettings> {
  const activeSettings = settings ?? (await getAppSettings());
  try {
    await invoke("configure_github_sync", {
      config: toRustGithubConfig(activeSettings),
    });
  } catch (err) {
    console.warn("[githubSyncService] configure_github_sync error:", err);
  }
  return activeSettings;
}

/**
 * Validates repository access via the Rust GitHub client (`GET /repos/{owner}/{repo}`).
 */
export async function testGithubConnection(
  settings: AppSettings
): Promise<string> {
  return await invoke<string>("test_github_connection", {
    config: toRustGithubConfig(settings),
  });
}

/**
 * Checks whether `planner-data.json` already exists in the remote GitHub repository
 * and returns its parsed payload if present.
 */
export async function checkGithubRemoteFile(
  settings: AppSettings
): Promise<GithubRemoteCheckResult> {
  return await invoke<GithubRemoteCheckResult>("check_github_remote_file", {
    config: toRustGithubConfig(settings),
  });
}

/**
 * Pulls the latest `planner-data.json` from GitHub, merges with local SQLite by `id` +
 * newest (`updated_at` vs. `deleted_at`), and commits the combined result to GitHub
 * (or overwrites remote when `overwriteRemote = true`, such as after purging deleted tasks).
 */
export async function pushLocalDataToGithubNow(
  overwriteRemote = false
): Promise<number> {
  const payload = await buildLocalBackupPayload();
  const merged = await invoke<PlannerBackupPayload>("sync_to_github_now", {
    payload,
    overwriteRemote,
  });
  if (!overwriteRemote && merged) {
    applyRemotePreferences(merged.preferences);
    await upsertRemoteBackupIntoLocal(
      extractRemoteTasks(merged),
      merged.week_images ?? [],
      merged.local_events ?? [],
      merged.note_pages ?? [],
      merged.bucket_definitions ?? [],
      merged.bucket_layouts ?? []
    );
    await upsertRemoteCalendarToolsIntoLocal(
      merged.mood_entries ?? [],
      merged.date_counters ?? []
    );
    await upsertRemoteBucketTextEntriesIntoLocal(
      merged.bucket_text_entries ?? []
    );
  }
  void pushCalendarCacheToGithub();
  const activeTasksCount = (merged?.tasks ?? payload.tasks).filter(
    (t) => !t.deleted_at || t.updated_at > t.deleted_at
  ).length;
  return activeTasksCount;
}

/**
 * Queues a 15-second debounced background push in Rust whenever any local task or
 * weekly sticker is created, edited, completed, moved, resized, or soft-deleted.
 * Before committing, the Rust worker fetches the latest `planner-data.json`, merges by
 * `id` + newest (`updated_at` vs. `deleted_at`), and pushes the combined dataset.
 */
export async function queueDebouncedGithubPush(): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (settings.storage_mode !== "github") return;
    const payload = await buildLocalBackupPayload();
    await invoke("queue_debounced_github_push", { payload });
  } catch (err) {
    console.warn("[githubSyncService] queueDebouncedGithubPush error:", err);
  }
}

/**
 * Runs on app startup (and manual refresh):
 * 1. Automatically hard-deletes any soft-deleted rows (`deleted_at IS NOT NULL`) older than 30 days.
 * 2. When `storage_mode === "github"`, pulls `planner-data.json` from GitHub, merges by `id` +
 *    newest (`updated_at` vs. `deleted_at`) into SQLite, and commits the combined result.
 */
export async function pullAndMergeFromGithub(
  runStartupPurge = false
): Promise<void> {
  if (inFlightGithubPull) {
    return inFlightGithubPull;
  }

  inFlightGithubPull = (async () => {
    let purgedCount = 0;
    if (runStartupPurge) {
      try {
        purgedCount = await purgeExpiredSoftDeletedRecords(30);
      } catch (err) {
        console.warn("[githubSyncService] purgeExpiredSoftDeletedRecords error:", err);
      }
    }

    const settings = await getAppSettings();
    await syncConfigToRustBackend(settings);
    if (settings.storage_mode !== "github") return;

    lastGithubCheckAt = Date.now();
    let pullResult: GithubPullResult | null = null;

    try {
      pullResult = await invoke<GithubPullResult>("pull_from_github");
      if (pullResult?.payload) {
        applyRemotePreferences(pullResult.payload.preferences);
        await upsertRemoteBackupIntoLocal(
          extractRemoteTasks(pullResult.payload),
          pullResult.payload.week_images ?? [],
          pullResult.payload.local_events ?? [],
          pullResult.payload.note_pages ?? [],
          pullResult.payload.bucket_definitions ?? [],
          pullResult.payload.bucket_layouts ?? []
        );
        await upsertRemoteCalendarToolsIntoLocal(
          pullResult.payload.mood_entries ?? [],
          pullResult.payload.date_counters ?? []
        );
        await upsertRemoteBucketTextEntriesIntoLocal(
          pullResult.payload.bucket_text_entries ?? []
        );
      }
    } catch (err) {
      console.warn("[githubSyncService] pull_from_github warning:", err);
    }

    // If remote returned 304 Not Modified on a periodic/focus check and nothing was purged,
    // skip the push round-trip (offline/local edits are already pushed by the 15s debounce).
    if (pullResult?.not_modified && !runStartupPurge && purgedCount === 0) {
      return;
    }

    try {
      const mergedPayload = await buildLocalBackupPayload();
      await invoke("sync_to_github_now", {
        payload: mergedPayload,
        overwriteRemote: false,
      });
    } catch (err) {
      console.warn("[githubSyncService] sync_to_github_now warning:", err);
    }
  })().finally(() => {
    inFlightGithubPull = null;
  });

  return inFlightGithubPull;
}

/**
 * Starts the independent 30-minute GitHub sync loop (immediate on launch + every 30m)
 * plus a window focus / visibility check with a 2-minute cooldown.
 * Uses ETag / 304 Not Modified and skips no-op pushes so unchanged checks are lightweight.
 */
export function startBackgroundGithubSync(
  onSyncComplete?: () => void
): () => void {
  let isDisposed = false;

  const triggerPull = async (runStartupPurge: boolean) => {
    if (isDisposed) return;
    await pullAndMergeFromGithub(runStartupPurge);
    if (!isDisposed) {
      onSyncComplete?.();
    }
  };

  void triggerPull(true);

  const intervalId = window.setInterval(() => {
    void triggerPull(false);
  }, GITHUB_SYNC_INTERVAL_MS);

  const handleFocusOrVisible = () => {
    if (isDisposed) return;
    if (document.visibilityState === "hidden") return;
    if (Date.now() - lastGithubCheckAt < GITHUB_FOCUS_COOLDOWN_MS) return;
    void triggerPull(false);
  };

  window.addEventListener("focus", handleFocusOrVisible);
  document.addEventListener("visibilitychange", handleFocusOrVisible);

  return () => {
    isDisposed = true;
    window.clearInterval(intervalId);
    window.removeEventListener("focus", handleFocusOrVisible);
    document.removeEventListener("visibilitychange", handleFocusOrVisible);
  };
}

/**
 * Immediately purges all soft-deleted rows (`deleted_at IS NOT NULL`) from `local_tasks`
 * and `week_images` in SQLite and triggers an immediate GitHub sync (`overwriteRemote = true`)
 * so the purged tombstones are also removed from `planner-data.json` on GitHub.
 */
export async function cleanAllDeletedTasksAndSync(): Promise<{
  purgedTasks: number;
  purgedImages: number;
}> {
  const result = await purgeAllSoftDeletedRecordsNow();
  const settings = await getAppSettings();
  if (settings.storage_mode === "github") {
    await pushLocalDataToGithubNow(true);
  }
  return result;
}

/**
 * Executes the user's chosen resolution when switching from "Local Only" to
 * "Local + GitHub Backup & Sync" and `planner-data.json` already exists on GitHub.
 */
export async function resolveInitialGithubMigration(
  mode: "keep_local" | "keep_remote" | "merge",
  remotePayload: PlannerBackupPayload
): Promise<string> {
  if (mode === "keep_local") {
    const count = await pushLocalDataToGithubNow(true);
    return `Transferred ${count} local task${count === 1 ? "" : "s"} to GitHub backup.`;
  }

  const remoteTasks = extractRemoteTasks(remotePayload);
  const remoteImages = remotePayload.week_images ?? [];
  const remoteLocalEvents = remotePayload.local_events ?? [];
  const remoteNotePages = remotePayload.note_pages ?? [];
  const remoteBucketDefs = remotePayload.bucket_definitions ?? [];
  const remoteBucketLayouts = remotePayload.bucket_layouts ?? [];

  if (mode === "keep_remote") {
    applyRemotePreferences(remotePayload.preferences);
    await replaceAllLocalDataWithRemote(
      remoteTasks,
      remoteImages,
      remoteLocalEvents,
      remoteNotePages,
      remoteBucketDefs,
      remoteBucketLayouts
    );
    await replaceAllCalendarToolsWithRemote(
      remotePayload.mood_entries ?? [],
      remotePayload.date_counters ?? []
    );
    await replaceAllBucketTextEntriesWithRemote(
      remotePayload.bucket_text_entries ?? []
    );
    const count = await pushLocalDataToGithubNow(true);
    return `Loaded ${count} task${count === 1 ? "" : "s"} from GitHub backup.`;
  }

  // "merge": Merge by `id` keeping newest (`updated_at` vs. `deleted_at`) and preserving unique items
  applyRemotePreferences(remotePayload.preferences);
  await upsertRemoteBackupIntoLocal(
    remoteTasks,
    remoteImages,
    remoteLocalEvents,
    remoteNotePages,
    remoteBucketDefs,
    remoteBucketLayouts
  );
  await upsertRemoteCalendarToolsIntoLocal(
    remotePayload.mood_entries ?? [],
    remotePayload.date_counters ?? []
  );
  await upsertRemoteBucketTextEntriesIntoLocal(
    remotePayload.bucket_text_entries ?? []
  );
  const totalMerged = await pushLocalDataToGithubNow(false);
  return `Merged and backed up ${totalMerged} task${totalMerged === 1 ? "" : "s"} with GitHub.`;
}

/**
 * Exports all cached `.ics` events from SQLite (`calendar_events`) to `calendar-cache.json`
 * in the configured GitHub repository so a future mobile PWA can display them.
 */
export async function pushCalendarCacheToGithub(): Promise<void> {
  try {
    const settings = await getAppSettings();
    if (settings.storage_mode !== "github") return;
    await syncConfigToRustBackend(settings);
    const events = await getAllCachedCalendarEvents();
    const payload: CalendarCachePayload = {
      schema_version: CURRENT_SCHEMA_VERSION,
      exported_at: new Date().toISOString(),
      events,
    };
    await invoke("push_calendar_cache_to_github", { payload });
  } catch (err) {
    console.warn("[githubSyncService] pushCalendarCacheToGithub error:", err);
  }
}

/**
 * Subscribes to `"github-sync-status"` events emitted by the Rust background worker.
 */
export async function onGithubSyncStatus(
  callback: (payload: GithubSyncStatusPayload) => void
): Promise<UnlistenFn> {
  try {
    return await listen<GithubSyncStatusPayload>(
      GITHUB_SYNC_STATUS_EVENT,
      (event) => {
        callback(event.payload);
      }
    );
  } catch {
    return () => {};
  }
}
