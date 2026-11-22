import { getSyncedPreferencesForBackup, applyRemotePreferences } from "../../../shared/timeFormat";
import {
  getAllBucketDefinitionsForBackup,
  getAllBucketLayouts,
  getAllLocalEventsForBackup,
  getAllLocalTasks,
  getAllNotePagesForBackup,
  getAppSettings,
  getMetaValue,
  purgeAllSoftDeletedRecordsNow,
  purgeExpiredSoftDeletedRecords,
  replaceAllLocalDataWithRemote,
  replaceCachedCalendarEvents,
  setMetaValue,
  upsertRemoteBackupIntoLocal,
} from "../db/plannerRepo";
import {
  AppSettings,
  BucketDefinition,
  BucketLayoutSnapshot,
  CalendarCachePayload,
  GithubRemoteCheckResult,
  GithubSyncStatusPayload,
  LocalEvent,
  LocalTask,
  NotePage,
  PlannerBackupPayload,
} from "../types/planner";

export const CURRENT_SCHEMA_VERSION = 1;
const GITHUB_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const GITHUB_FOCUS_COOLDOWN_MS = 2 * 60 * 1000;

let inFlightGithubPull: Promise<void> | null = null;
let lastGithubCheckAt = 0;
let debounceTimer: number | null = null;

const statusListeners = new Set<(payload: GithubSyncStatusPayload) => void>();
let currentStatus: GithubSyncStatusPayload = {
  status: "disabled",
  last_synced_at: null,
  message: null,
};

function emitStatus(
  status: GithubSyncStatusPayload["status"],
  message: string | null = null,
  lastSyncedAt?: string | null
): void {
  currentStatus = {
    status,
    last_synced_at:
      lastSyncedAt !== undefined ? lastSyncedAt : currentStatus.last_synced_at,
    message,
  };
  for (const cb of statusListeners) {
    try {
      cb(currentStatus);
    } catch {
      // Ignore listener error
    }
  }
}

export function onGithubSyncStatus(
  callback: (payload: GithubSyncStatusPayload) => void
): () => void {
  statusListeners.add(callback);
  callback(currentStatus);
  return () => {
    statusListeners.delete(callback);
  };
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(base64: string): string {
  const cleaned = base64.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function normalizedFilePath(settings: AppSettings): string {
  return (
    settings.github_file_path.trim().replace(/^\/+/, "") || "planner-data.json"
  );
}

function calendarCachePath(settings: AppSettings): string {
  const p = normalizedFilePath(settings);
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? `${p.slice(0, idx)}/calendar-cache.json` : "calendar-cache.json";
}

function contentsUrl(settings: AppSettings, path: string): string {
  return `https://api.github.com/repos/${settings.github_owner.trim()}/${settings.github_repo.trim()}/contents/${path.replace(/^\/+/, "")}`;
}

function isGithubActive(settings: AppSettings): boolean {
  return (
    settings.storage_mode === "github" &&
    settings.github_token.trim().length > 0 &&
    settings.github_owner.trim().length > 0 &&
    settings.github_repo.trim().length > 0 &&
    normalizedFilePath(settings).length > 0
  );
}

export function extractRemoteTasks(
  payload: PlannerBackupPayload | null | undefined
): LocalTask[] {
  if (!payload) return [];
  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.local_tasks)) return payload.local_tasks;
  return [];
}

function parseBackupPayloadForgiving(rawJson: string): PlannerBackupPayload {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      exported_at: "",
      tasks: [],
      week_images: [],
      local_events: [],
      note_pages: [],
    };
  }
  try {
    const parsed = JSON.parse(trimmed) as PlannerBackupPayload;
    if (Array.isArray(parsed)) {
      return {
        schema_version: CURRENT_SCHEMA_VERSION,
        exported_at: "1970-01-01T00:00:00.000Z",
        tasks: parsed,
        week_images: [],
        local_events: [],
        note_pages: [],
      };
    }
    return {
      schema_version: parsed.schema_version || CURRENT_SCHEMA_VERSION,
      exported_at: parsed.exported_at || "1970-01-01T00:00:00.000Z",
      tasks: extractRemoteTasks(parsed),
      week_images: Array.isArray(parsed.week_images) ? parsed.week_images : [],
      local_events: Array.isArray(parsed.local_events)
        ? parsed.local_events
        : [],
      note_pages: Array.isArray(parsed.note_pages) ? parsed.note_pages : [],
      bucket_definitions: Array.isArray(parsed.bucket_definitions)
        ? parsed.bucket_definitions
        : [],
      bucket_layouts: Array.isArray(parsed.bucket_layouts)
        ? parsed.bucket_layouts
        : [],
      preferences: parsed.preferences,
    };
  } catch {
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      exported_at: "",
      tasks: [],
      week_images: [],
      local_events: [],
      note_pages: [],
    };
  }
}

function getEffectiveTs(item: {
  updated_at?: string | null;
  deleted_at?: string | null;
}): string {
  const u = item.updated_at || "";
  const d = item.deleted_at || "";
  return d > u ? d : u;
}

function mergePayloads(
  local: PlannerBackupPayload,
  remote: PlannerBackupPayload | null,
  preservedWeekImages: unknown[]
): PlannerBackupPayload {
  const taskMap = new Map<string, LocalTask>();
  for (const t of local.tasks) {
    const key = t.sync_id?.trim() || String(t.id);
    taskMap.set(key, { ...t, sync_id: key });
  }
  for (const rt of extractRemoteTasks(remote)) {
    const key = rt.sync_id?.trim() || String(rt.id);
    const normRt = { ...rt, sync_id: key };
    const ex = taskMap.get(key);
    if (!ex || getEffectiveTs(normRt) > getEffectiveTs(ex)) {
      taskMap.set(key, normRt);
    }
  }

  const eventMap = new Map<string, LocalEvent>();
  for (const ev of local.local_events ?? []) {
    if (ev.id) eventMap.set(ev.id, ev);
  }
  for (const rev of remote?.local_events ?? []) {
    if (!rev.id) continue;
    const ex = eventMap.get(rev.id);
    if (!ex || getEffectiveTs(rev) > getEffectiveTs(ex)) {
      eventMap.set(rev.id, rev);
    }
  }

  const noteMap = new Map<string, NotePage>();
  for (const np of local.note_pages ?? []) {
    if (np.id) noteMap.set(np.id, np);
  }
  for (const rnp of remote?.note_pages ?? []) {
    if (!rnp.id) continue;
    const ex = noteMap.get(rnp.id);
    if (!ex || getEffectiveTs(rnp) > getEffectiveTs(ex)) {
      noteMap.set(rnp.id, rnp);
    }
  }

  const bucketDefMap = new Map<string, BucketDefinition>();
  for (const bd of local.bucket_definitions ?? []) {
    if (bd.id) bucketDefMap.set(bd.id, bd);
  }
  for (const rbd of remote?.bucket_definitions ?? []) {
    if (!rbd.id) continue;
    const ex = bucketDefMap.get(rbd.id);
    if (!ex || getEffectiveTs(rbd) > getEffectiveTs(ex)) {
      bucketDefMap.set(rbd.id, rbd);
    }
  }

  const bucketLayoutMap = new Map<string, BucketLayoutSnapshot>();
  for (const bl of local.bucket_layouts ?? []) {
    if (bl.effective_from_week) {
      bucketLayoutMap.set(bl.effective_from_week, bl);
    }
  }
  for (const rbl of remote?.bucket_layouts ?? []) {
    if (!rbl.effective_from_week) continue;
    const ex = bucketLayoutMap.get(rbl.effective_from_week);
    if (!ex || (rbl.updated_at || "") > (ex.updated_at || "")) {
      bucketLayoutMap.set(rbl.effective_from_week, rbl);
    }
  }

  // Always preserve desktop week_images from remote so mobile never wipes stickers
  const weekImages =
    remote && Array.isArray(remote.week_images)
      ? remote.week_images
      : preservedWeekImages;

  const lp = local.preferences;
  const rp = remote?.preferences;
  const mergedPreferences =
    lp && rp
      ? (rp.updated_at || "") > (lp.updated_at || "")
        ? rp
        : lp
      : lp || rp;

  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: local.exported_at,
    tasks: Array.from(taskMap.values()).sort((a, b) =>
      a.sync_id.localeCompare(b.sync_id)
    ),
    week_images: weekImages,
    local_events: Array.from(eventMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    note_pages: Array.from(noteMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    bucket_definitions: Array.from(bucketDefMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    bucket_layouts: Array.from(bucketLayoutMap.values()).sort((a, b) =>
      a.effective_from_week.localeCompare(b.effective_from_week)
    ),
    preferences: mergedPreferences,
  };
}

function payloadDataEquals(
  a: PlannerBackupPayload,
  b: PlannerBackupPayload
): boolean {
  const norm = (p: PlannerBackupPayload) =>
    JSON.stringify({
      tasks: [...extractRemoteTasks(p)].sort((x, y) =>
        (x.sync_id || String(x.id)).localeCompare(y.sync_id || String(y.id))
      ),
      local_events: [...(p.local_events ?? [])].sort((x, y) =>
        x.id.localeCompare(y.id)
      ),
      note_pages: [...(p.note_pages ?? [])].sort((x, y) =>
        x.id.localeCompare(y.id)
      ),
      bucket_definitions: [...(p.bucket_definitions ?? [])].sort((x, y) =>
        x.id.localeCompare(y.id)
      ),
      bucket_layouts: [...(p.bucket_layouts ?? [])].sort((x, y) =>
        x.effective_from_week.localeCompare(y.effective_from_week)
      ),
      preferences: p.preferences ?? null,
    });
  return norm(a) === norm(b);
}

async function githubHeaders(
  settings: AppSettings,
  etag?: string | null
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${settings.github_token.trim()}`,
  };
  if (etag) {
    headers["If-None-Match"] = etag;
  }
  return headers;
}

export async function testGithubConnection(
  settings: AppSettings
): Promise<string> {
  if (
    !settings.github_owner.trim() ||
    !settings.github_repo.trim() ||
    !settings.github_token.trim()
  ) {
    throw new Error(
      "Please enter GitHub Username, Repository Name, and Personal Access Token."
    );
  }
  const resp = await fetch(
    `https://api.github.com/repos/${settings.github_owner.trim()}/${settings.github_repo.trim()}`,
    { headers: await githubHeaders(settings) }
  );
  if (resp.status === 200) return "Connected to GitHub repository.";
  if (resp.status === 401)
    throw new Error("Invalid token (401 Unauthorized). Check your Personal Access Token.");
  if (resp.status === 403)
    throw new Error("Access denied (403 Forbidden). Ensure token has Contents: Read & Write permission.");
  if (resp.status === 404)
    throw new Error("Repository not found (404). Verify owner, repository name, and token access.");
  throw new Error(`GitHub returned unexpected status ${resp.status}`);
}

async function fetchRemoteFile(
  settings: AppSettings,
  path: string,
  etag?: string | null
): Promise<{
  notModified: boolean;
  exists: boolean;
  sha: string | null;
  etag: string | null;
  rawText: string | null;
}> {
  const resp = await fetch(contentsUrl(settings, path), {
    headers: await githubHeaders(settings, etag),
    cache: "no-store",
  });

  if (resp.status === 304) {
    return {
      notModified: true,
      exists: true,
      sha: null,
      etag: etag ?? null,
      rawText: null,
    };
  }
  if (resp.status === 404) {
    return {
      notModified: false,
      exists: false,
      sha: null,
      etag: null,
      rawText: null,
    };
  }
  if (resp.status === 401) {
    throw new Error("Invalid GitHub token (401 Unauthorized).");
  }
  if (resp.status === 403) {
    throw new Error("GitHub token lacks permission (403 Forbidden).");
  }
  if (!resp.ok) {
    throw new Error(`GitHub GET contents failed with HTTP ${resp.status}`);
  }

  const newEtag = resp.headers.get("ETag");
  const body = (await resp.json()) as { sha?: string; content?: string };
  const rawText = body.content ? decodeUtf8Base64(body.content) : "";

  return {
    notModified: false,
    exists: true,
    sha: body.sha ?? null,
    etag: newEtag,
    rawText,
  };
}

export async function checkGithubRemoteFile(
  settings: AppSettings
): Promise<GithubRemoteCheckResult> {
  await testGithubConnection(settings);
  const res = await fetchRemoteFile(settings, normalizedFilePath(settings));
  if (!res.exists) {
    return { exists: false, sha: null, payload: null };
  }
  return {
    exists: true,
    sha: res.sha,
    payload: parseBackupPayloadForgiving(res.rawText || ""),
  };
}

export async function buildLocalBackupPayload(): Promise<PlannerBackupPayload> {
  const [
    tasks,
    localEvents,
    notePages,
    bucketDefs,
    bucketLayouts,
    preservedImages,
  ] = await Promise.all([
    getAllLocalTasks(),
    getAllLocalEventsForBackup(),
    getAllNotePagesForBackup(),
    getAllBucketDefinitionsForBackup(),
    getAllBucketLayouts(),
    getMetaValue<unknown[]>("preserved_week_images"),
  ]);

  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    tasks,
    week_images: Array.isArray(preservedImages) ? preservedImages : [],
    local_events: localEvents,
    note_pages: notePages,
    bucket_definitions: bucketDefs,
    bucket_layouts: bucketLayouts,
    preferences: getSyncedPreferencesForBackup(),
  };
}

async function putBackupFile(
  settings: AppSettings,
  payload: PlannerBackupPayload,
  sha: string | null
): Promise<number> {
  const resp = await fetch(contentsUrl(settings, normalizedFilePath(settings)), {
    method: "PUT",
    headers: {
      ...(await githubHeaders(settings)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "Sync local planner data (mobile PWA)",
      content: encodeUtf8Base64(JSON.stringify(payload, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
  return resp.status;
}

async function pullMergeAndPush(
  settings: AppSettings,
  localPayload: PlannerBackupPayload,
  overwriteRemote: boolean
): Promise<PlannerBackupPayload> {
  const path = normalizedFilePath(settings);
  const remote = await fetchRemoteFile(settings, path);
  const remotePayload =
    remote.exists && remote.rawText !== null
      ? parseBackupPayloadForgiving(remote.rawText)
      : null;

  if (remotePayload?.week_images) {
    await setMetaValue("preserved_week_images", remotePayload.week_images);
  }

  const preservedImages =
    (await getMetaValue<unknown[]>("preserved_week_images")) ?? [];

  const combined = overwriteRemote
    ? {
        ...localPayload,
        schema_version: CURRENT_SCHEMA_VERSION,
        week_images: remotePayload?.week_images ?? preservedImages,
      }
    : mergePayloads(localPayload, remotePayload, preservedImages);

  if (!overwriteRemote && remotePayload && payloadDataEquals(combined, remotePayload)) {
    return combined;
  }

  const status = await putBackupFile(settings, combined, remote.sha);
  if (status === 200 || status === 201) {
    await setMetaValue("cached_planner_etag", null);
    await setMetaValue("pending_push", false);
    return combined;
  }

  if (status === 409 || status === 422) {
    const retryRemote = await fetchRemoteFile(settings, path);
    const retryPayload =
      retryRemote.exists && retryRemote.rawText !== null
        ? parseBackupPayloadForgiving(retryRemote.rawText)
        : null;
    const retryCombined = overwriteRemote
      ? {
          ...localPayload,
          schema_version: CURRENT_SCHEMA_VERSION,
          week_images: retryPayload?.week_images ?? preservedImages,
        }
      : mergePayloads(localPayload, retryPayload, preservedImages);

    const retryStatus = await putBackupFile(
      settings,
      retryCombined,
      retryRemote.sha
    );
    if (retryStatus === 200 || retryStatus === 201) {
      await setMetaValue("cached_planner_etag", null);
      await setMetaValue("pending_push", false);
      return retryCombined;
    }
    throw new Error(`GitHub conflict retry failed with HTTP ${retryStatus}`);
  }

  throw new Error(`GitHub PUT contents failed with HTTP ${status}`);
}

async function pullCalendarCache(settings: AppSettings): Promise<void> {
  try {
    const cachedEtag =
      (await getMetaValue<string | null>("cached_calendar_etag")) ?? null;
    const res = await fetchRemoteFile(
      settings,
      calendarCachePath(settings),
      cachedEtag
    );
    if (res.notModified || !res.exists || !res.rawText) return;
    const parsed = JSON.parse(res.rawText) as CalendarCachePayload;
    if (Array.isArray(parsed.events)) {
      await replaceCachedCalendarEvents(parsed.events);
      await setMetaValue("cached_calendar_etag", res.etag);
    }
  } catch (err) {
    console.warn("[pwa githubSync] calendar-cache.json pull warning:", err);
  }
}

export async function pushLocalDataToGithubNow(
  overwriteRemote = false
): Promise<number> {
  const settings = await getAppSettings();
  if (!isGithubActive(settings)) {
    emitStatus("disabled", null);
    return 0;
  }

  emitStatus("syncing", null);
  try {
    const localPayload = await buildLocalBackupPayload();
    const merged = await pullMergeAndPush(
      settings,
      localPayload,
      overwriteRemote
    );
    if (!overwriteRemote) {
      applyRemotePreferences(merged.preferences);
      await upsertRemoteBackupIntoLocal(
        extractRemoteTasks(merged),
        merged.local_events ?? [],
        merged.note_pages ?? [],
        merged.bucket_definitions ?? [],
        merged.bucket_layouts ?? []
      );
    }
    emitStatus("synced", null, merged.exported_at);
    return extractRemoteTasks(merged).filter(
      (t) => !t.deleted_at || t.updated_at > t.deleted_at
    ).length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setMetaValue("pending_push", true);
    emitStatus("error", msg);
    throw err;
  }
}

export function queueDebouncedGithubPush(): void {
  void setMetaValue("pending_push", true);
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(async () => {
    debounceTimer = null;
    const settings = await getAppSettings();
    if (!isGithubActive(settings)) return;
    if (!navigator.onLine) return;
    try {
      await pushLocalDataToGithubNow(false);
    } catch {
      // Status already emitted
    }
  }, 15_000);
}

export async function pullAndMergeFromGithub(
  runStartupPurge = false
): Promise<void> {
  if (inFlightGithubPull) return inFlightGithubPull;

  inFlightGithubPull = (async () => {
    let purged = 0;
    if (runStartupPurge) {
      try {
        purged = await purgeExpiredSoftDeletedRecords(30);
      } catch {
        // Ignore purge error
      }
    }

    const settings = await getAppSettings();
    if (!isGithubActive(settings)) {
      emitStatus("disabled", null);
      return;
    }

    if (!navigator.onLine) {
      return;
    }

    lastGithubCheckAt = Date.now();
    emitStatus("syncing", null);

    try {
      const cachedEtag =
        (await getMetaValue<string | null>("cached_planner_etag")) ?? null;
      const res = await fetchRemoteFile(
        settings,
        normalizedFilePath(settings),
        cachedEtag
      );

      let remoteNotModified = res.notModified;
      if (!res.notModified && res.exists && res.rawText !== null) {
        const remotePayload = parseBackupPayloadForgiving(res.rawText);
        if (remotePayload.week_images) {
          await setMetaValue(
            "preserved_week_images",
            remotePayload.week_images
          );
        }
        applyRemotePreferences(remotePayload.preferences);
        await upsertRemoteBackupIntoLocal(
          extractRemoteTasks(remotePayload),
          remotePayload.local_events ?? [],
          remotePayload.note_pages ?? [],
          remotePayload.bucket_definitions ?? [],
          remotePayload.bucket_layouts ?? []
        );
        await setMetaValue("cached_planner_etag", res.etag);
      }

      await pullCalendarCache(settings);

      const pendingPush = Boolean(await getMetaValue<boolean>("pending_push"));
      if (remoteNotModified && !runStartupPurge && purged === 0 && !pendingPush) {
        emitStatus("synced", null, new Date().toISOString());
        return;
      }

      const localPayload = await buildLocalBackupPayload();
      const merged = await pullMergeAndPush(settings, localPayload, false);
      emitStatus("synced", null, merged.exported_at);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitStatus("error", msg);
    }
  })().finally(() => {
    inFlightGithubPull = null;
  });

  return inFlightGithubPull;
}

export function startBackgroundGithubSync(
  onSyncComplete?: () => void
): () => void {
  let isDisposed = false;

  const triggerPull = async (runStartupPurge: boolean) => {
    if (isDisposed) return;
    await pullAndMergeFromGithub(runStartupPurge);
    if (!isDisposed) onSyncComplete?.();
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

  const handleOnline = async () => {
    if (isDisposed) return;
    const pending = await getMetaValue<boolean>("pending_push");
    if (pending) {
      try {
        await pushLocalDataToGithubNow(false);
      } catch {
        // Ignore
      }
    }
    void triggerPull(false);
  };

  window.addEventListener("focus", handleFocusOrVisible);
  document.addEventListener("visibilitychange", handleFocusOrVisible);
  window.addEventListener("online", handleOnline);

  return () => {
    isDisposed = true;
    window.clearInterval(intervalId);
    window.removeEventListener("focus", handleFocusOrVisible);
    document.removeEventListener("visibilitychange", handleFocusOrVisible);
    window.removeEventListener("online", handleOnline);
  };
}

export async function cleanAllDeletedTasksAndSync(): Promise<{
  purgedTasks: number;
}> {
  const result = await purgeAllSoftDeletedRecordsNow();
  const settings = await getAppSettings();
  if (isGithubActive(settings)) {
    await pushLocalDataToGithubNow(true);
  }
  return result;
}

export async function resolveInitialGithubMigration(
  mode: "keep_local" | "keep_remote" | "merge",
  remotePayload: PlannerBackupPayload
): Promise<string> {
  if (remotePayload.week_images) {
    await setMetaValue("preserved_week_images", remotePayload.week_images);
  }

  if (mode === "keep_local") {
    const count = await pushLocalDataToGithubNow(true);
    await pullCalendarCache(await getAppSettings());
    return `Transferred ${count} local task${count === 1 ? "" : "s"} to GitHub backup.`;
  }

  const remoteTasks = extractRemoteTasks(remotePayload);
  const remoteEvents = remotePayload.local_events ?? [];
  const remoteNotes = remotePayload.note_pages ?? [];
  const remoteBucketDefs = remotePayload.bucket_definitions ?? [];
  const remoteBucketLayouts = remotePayload.bucket_layouts ?? [];

  if (mode === "keep_remote") {
    applyRemotePreferences(remotePayload.preferences);
    await replaceAllLocalDataWithRemote(
      remoteTasks,
      remoteEvents,
      remoteNotes,
      remoteBucketDefs,
      remoteBucketLayouts
    );
    const count = await pushLocalDataToGithubNow(true);
    await pullCalendarCache(await getAppSettings());
    return `Loaded ${count} task${count === 1 ? "" : "s"} from GitHub backup.`;
  }

  applyRemotePreferences(remotePayload.preferences);
  await upsertRemoteBackupIntoLocal(
    remoteTasks,
    remoteEvents,
    remoteNotes,
    remoteBucketDefs,
    remoteBucketLayouts
  );
  const totalMerged = await pushLocalDataToGithubNow(false);
  await pullCalendarCache(await getAppSettings());
  return `Merged and backed up ${totalMerged} task${totalMerged === 1 ? "" : "s"} with GitHub.`;
}
