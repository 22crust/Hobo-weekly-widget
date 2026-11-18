import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, Update } from "@tauri-apps/plugin-updater";
import { pushLocalDataToGithubNow } from "./githubSyncService";

const SKIPPED_UPDATE_STORAGE_KEY = "hobo_skipped_update_version";

export interface UpdateCheckResult {
  update: Update | null;
  isSkipped: boolean;
}

export function getSkippedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(SKIPPED_UPDATE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function skipUpdateVersion(version: string): void {
  try {
    localStorage.setItem(SKIPPED_UPDATE_STORAGE_KEY, version);
  } catch {
    // Ignore storage error
  }
}

/**
 * Checks GitHub Releases (`latest.json`) for a newer signed version.
 * Silently returns `{ update: null, isSkipped: false }` if offline or running outside Tauri.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      return { update: null, isSkipped: false };
    }
    const skipped = getSkippedUpdateVersion();
    return {
      update,
      isSkipped: skipped === update.version,
    };
  } catch {
    return { update: null, isSkipped: false };
  }
}

/**
 * Safely backs up `planner.db` -> `planner.db.bak` (and flushes GitHub sync if active),
 * then downloads, verifies, installs the update, and relaunches the widget.
 */
export async function installAppUpdate(
  update: Update,
  onProgress?: (pct: number | null) => void
): Promise<void> {
  try {
    await invoke("backup_planner_db");
  } catch (err) {
    console.warn("[updaterService] Pre-update local DB backup warning:", err);
  }

  try {
    await pushLocalDataToGithubNow(false);
  } catch {
    // Ignore if GitHub sync is disabled or offline
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
      downloadedBytes = 0;
      onProgress?.(totalBytes > 0 ? 0 : null);
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      if (totalBytes > 0) {
        const pct = Math.min(
          100,
          Math.round((downloadedBytes / totalBytes) * 100)
        );
        onProgress?.(pct);
      }
    } else if (event.event === "Finished") {
      onProgress?.(100);
    }
  });

  await relaunch();
}
