import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getAppSettings } from "../db/appSettingsRepo";
import {
  getAllLocalTasks,
  purgeAllSoftDeletedRecordsNow,
  purgeExpiredSoftDeletedRecords,
  replaceAllLocalDataWithRemote,
  upsertRemoteBackupIntoLocal,
} from "../db/localTasksRepo";
import { getAllWeekImages } from "../db/weekImagesRepo";
import {
  AppSettings,
  GithubRemoteCheckResult,
  GithubSyncStatusPayload,
  LocalTask,
  PlannerBackupPayload,
} from "../types/planner";

export const GITHUB_SYNC_STATUS_EVENT = "github-sync-status";
export const CURRENT_SCHEMA_VERSION = 1;

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
  const [tasks, images] = await Promise.all([
    getAllLocalTasks(),
    getAllWeekImages(),
  ]);

  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    tasks,
    week_images: images,
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
    await upsertRemoteBackupIntoLocal(
      extractRemoteTasks(merged),
      merged.week_images ?? []
    );
  }
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
  if (runStartupPurge) {
    try {
      await purgeExpiredSoftDeletedRecords(30);
    } catch (err) {
      console.warn("[githubSyncService] purgeExpiredSoftDeletedRecords error:", err);
    }
  }

  const settings = await getAppSettings();
  await syncConfigToRustBackend(settings);
  if (settings.storage_mode !== "github") return;

  try {
    const remotePayload = await invoke<PlannerBackupPayload | null>(
      "pull_from_github"
    );
    if (remotePayload) {
      await upsertRemoteBackupIntoLocal(
        extractRemoteTasks(remotePayload),
        remotePayload.week_images ?? []
      );
    }
  } catch (err) {
    console.warn("[githubSyncService] pull_from_github warning:", err);
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

  if (mode === "keep_remote") {
    await replaceAllLocalDataWithRemote(remoteTasks, remoteImages);
    const count = await pushLocalDataToGithubNow(true);
    return `Loaded ${count} task${count === 1 ? "" : "s"} from GitHub backup.`;
  }

  // "merge": Merge by `id` keeping newest (`updated_at` vs. `deleted_at`) and preserving unique items
  await upsertRemoteBackupIntoLocal(remoteTasks, remoteImages);
  const totalMerged = await pushLocalDataToGithubNow(false);
  return `Merged and backed up ${totalMerged} task${totalMerged === 1 ? "" : "s"} with GitHub.`;
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
