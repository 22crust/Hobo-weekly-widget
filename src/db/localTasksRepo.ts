import { format, parseISO, startOfWeek, subDays } from "date-fns";
import { getDatabase, notifyDatabaseUpdated } from "./database";
import { getAllWeekImages } from "./weekImagesRepo";
import { getAllLocalEventsForBackup } from "./localEventsRepo";
import { getAllNotePagesForBackup } from "./notePagesRepo";
import {
  getAllBucketDefinitionsForBackup,
  getAllBucketLayouts,
} from "./bucketsRepo";
import { generateUuid } from "../utils/id";
import {
  BucketDefinition,
  BucketLayoutSnapshot,
  BucketScope,
  CreateLocalTaskInput,
  LocalEvent,
  LocalTask,
  NotePage,
  UpdateLocalTaskInput,
  WeekImage,
} from "../types/planner";

interface RawLocalTaskRow {
  id: number;
  sync_id?: string | null;
  title: string;
  notes: string | null;
  assigned_date: string | null;
  assigned_week_start: string | null;
  is_long_term: number;
  bucket_id?: string | null;
  start_time: string | null;
  end_time: string | null;
  is_completed: number;
  show_in_weekly: number;
  show_in_sidebar: number;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

function mapRowToLocalTask(row: RawLocalTaskRow): LocalTask {
  const isLongTerm = Boolean(row.is_long_term);
  return {
    ...row,
    sync_id: row.sync_id || String(row.id),
    is_long_term: isLongTerm,
    bucket_id:
      row.bucket_id && row.bucket_id.trim() !== ""
        ? row.bucket_id.trim()
        : isLongTerm
        ? "long_term"
        : "weekly",
    is_completed: Boolean(row.is_completed),
    show_in_weekly: Boolean(row.show_in_weekly),
    show_in_sidebar: Boolean(row.show_in_sidebar),
    updated_at: row.updated_at || row.created_at || "1970-01-01T00:00:00.000Z",
    deleted_at: row.deleted_at ?? null,
  };
}

import {
  getEffectiveTimestamp,
  resolveSoftDeleteWinner,
} from "../../shared/plannerCore";

export { getEffectiveTimestamp, resolveSoftDeleteWinner };

/**
 * Computes Monday YYYY-MM-DD for a given YYYY-MM-DD date string.
 */
export function getMondayWeekStart(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
  } catch {
    return dateStr;
  }
}

/**
 * Fetches all local tasks from SQLite (`local_tasks` table), including soft-deleted rows
 * (`deleted_at IS NOT NULL`) so GitHub sync can propagate deletions across devices.
 */
export async function getAllLocalTasks(): Promise<LocalTask[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalTaskRow[]>(
    `SELECT * FROM local_tasks ORDER BY id ASC`
  );
  return rows.map(mapRowToLocalTask);
}

/**
 * Fetches active (non-deleted) local tasks scheduled within a date range (YYYY-MM-DD)
 * for the 7-day weekly view or monthly calendar widget.
 * Hides items where `deleted_at` is set (`deleted_at IS NULL OR updated_at > deleted_at`).
 */
export async function getLocalTasksInRange(
  startDate: string,
  endDate: string,
  onlyWeeklyVisible = false
): Promise<LocalTask[]> {
  const db = await getDatabase();
  const visibilityClause = onlyWeeklyVisible ? "AND show_in_weekly = 1" : "";
  const rows = await db.select<RawLocalTaskRow[]>(
    `SELECT *
     FROM local_tasks
     WHERE assigned_date >= $1
       AND assigned_date <= $2
       AND (deleted_at IS NULL OR updated_at > deleted_at)
       ${visibilityClause}
     ORDER BY assigned_date ASC, is_completed ASC, sort_order ASC, start_time ASC, id ASC`,
    [startDate, endDate]
  );
  return rows.map(mapRowToLocalTask);
}

/**
 * Fetches all active sidebar tasks for a specific week (`weekStartDate`..`weekEndDate`)
 * in a single SQLite query, including both persistent (`is_long_term = 1`) and
 * week-scoped (`is_long_term = 0`) tasks.
 */
export async function getSidebarTasksForWeek(
  weekStartDate: string,
  weekEndDate: string
): Promise<LocalTask[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalTaskRow[]>(
    `SELECT *
     FROM local_tasks
     WHERE show_in_sidebar = 1
       AND (deleted_at IS NULL OR updated_at > deleted_at)
       AND (
         is_long_term = 1
         OR assigned_week_start = $1
         OR (assigned_date >= $1 AND assigned_date <= $2)
       )
     ORDER BY is_completed ASC, sort_order ASC, created_at ASC, id ASC`,
    [weekStartDate, weekEndDate]
  );
  return rows.map(mapRowToLocalTask);
}

/**
 * Fetches active persistent "Long-Term Tasks" (`is_long_term = 1` and `show_in_sidebar = 1`).
 * Hides items where `deleted_at` is set.
 */
export async function getLongTermSidebarTasks(): Promise<LocalTask[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalTaskRow[]>(
    `SELECT *
     FROM local_tasks
     WHERE show_in_sidebar = 1
       AND is_long_term = 1
       AND (deleted_at IS NULL OR updated_at > deleted_at)
     ORDER BY is_completed ASC, sort_order ASC, created_at ASC, id ASC`
  );
  return rows.map(mapRowToLocalTask);
}

/**
 * Fetches active "Weekly Tasks" for a specific week (`weekStartDate`..`weekEndDate`).
 * Hides items where `deleted_at` is set.
 */
export async function getWeeklySidebarTasks(
  weekStartDate: string,
  weekEndDate: string
): Promise<LocalTask[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalTaskRow[]>(
    `SELECT *
     FROM local_tasks
     WHERE show_in_sidebar = 1
       AND is_long_term = 0
       AND (deleted_at IS NULL OR updated_at > deleted_at)
       AND (
         assigned_week_start = $1
         OR (assigned_date >= $1 AND assigned_date <= $2)
       )
     ORDER BY is_completed ASC, sort_order ASC, created_at ASC, id ASC`,
    [weekStartDate, weekEndDate]
  );
  return rows.map(mapRowToLocalTask);
}

/**
 * Creates a new local task in SQLite with an ISO 8601 `updated_at` timestamp and `deleted_at = NULL`.
 */
export async function createLocalTask(
  input: CreateLocalTaskInput
): Promise<number> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();

  const maxOrderRows = await db.select<{ max_order: number | null }[]>(
    `SELECT MAX(sort_order) as max_order FROM local_tasks`
  );
  const nextOrder = (maxOrderRows[0]?.max_order ?? 0) + 10;

  const assignedDate = input.assigned_date ?? null;
  const assignedWeekStart =
    input.assigned_week_start !== undefined
      ? input.assigned_week_start
      : assignedDate
      ? getMondayWeekStart(assignedDate)
      : null;

  const syncId = generateUuid();
  const bucketId =
    input.bucket_id && input.bucket_id.trim() !== ""
      ? input.bucket_id.trim()
      : input.is_long_term
      ? "long_term"
      : "weekly";
  const result = await db.execute(
    `INSERT INTO local_tasks (
      sync_id, title, notes, assigned_date, assigned_week_start, is_long_term, bucket_id,
      start_time, end_time, is_completed, show_in_weekly, show_in_sidebar,
      sort_order, created_at, updated_at, deleted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12, $13, $14, NULL)`,
    [
      syncId,
      input.title.trim(),
      input.notes ?? null,
      assignedDate,
      assignedWeekStart,
      input.is_long_term ? 1 : 0,
      bucketId,
      input.start_time ?? null,
      input.end_time ?? null,
      input.show_in_weekly ? 1 : 0,
      input.show_in_sidebar ? 1 : 0,
      nextOrder,
      nowIso,
      nowIso,
    ]
  );

  await notifyDatabaseUpdated("local_tasks:create");
  return result.lastInsertId ?? 0;
}

/**
 * Updates an existing local task, bumps `updated_at` to the current ISO 8601 timestamp,
 * and clears `deleted_at` (`NULL`) since `updated_at` is now newer.
 */
export async function updateLocalTask(
  id: number,
  updates: UpdateLocalTaskInput
): Promise<void> {
  const db = await getDatabase();
  const existingRows = await db.select<RawLocalTaskRow[]>(
    `SELECT * FROM local_tasks WHERE id = $1`,
    [id]
  );
  const current = existingRows[0];
  if (!current) return;

  const nowIso = new Date().toISOString();
  const nextTitle = updates.title !== undefined ? updates.title.trim() : current.title;
  const nextNotes = updates.notes !== undefined ? updates.notes : current.notes;
  const nextAssignedDate =
    updates.assigned_date !== undefined ? updates.assigned_date : current.assigned_date;
  const nextAssignedWeekStart =
    updates.assigned_week_start !== undefined
      ? updates.assigned_week_start
      : updates.assigned_date !== undefined && updates.assigned_date !== null
      ? getMondayWeekStart(updates.assigned_date)
      : current.assigned_week_start;
  const nextIsLongTerm =
    updates.is_long_term !== undefined
      ? updates.is_long_term
        ? 1
        : 0
      : current.is_long_term;
  const nextBucketId =
    updates.bucket_id !== undefined && updates.bucket_id.trim() !== ""
      ? updates.bucket_id.trim()
      : current.bucket_id && current.bucket_id.trim() !== ""
      ? current.bucket_id.trim()
      : nextIsLongTerm
      ? "long_term"
      : "weekly";
  const nextStartTime =
    updates.start_time !== undefined ? updates.start_time : current.start_time;
  const nextEndTime =
    updates.end_time !== undefined ? updates.end_time : current.end_time;
  const nextCompleted =
    updates.is_completed !== undefined
      ? updates.is_completed
        ? 1
        : 0
      : current.is_completed;
  const nextShowWeekly =
    updates.show_in_weekly !== undefined
      ? updates.show_in_weekly
        ? 1
        : 0
      : current.show_in_weekly;
  const nextShowSidebar =
    updates.show_in_sidebar !== undefined
      ? updates.show_in_sidebar
        ? 1
        : 0
      : current.show_in_sidebar;
  const nextSortOrder =
    updates.sort_order !== undefined ? updates.sort_order : current.sort_order;

  await db.execute(
    `UPDATE local_tasks
     SET title = $1,
         notes = $2,
         assigned_date = $3,
         assigned_week_start = $4,
         is_long_term = $5,
         bucket_id = $6,
         start_time = $7,
         end_time = $8,
         is_completed = $9,
         show_in_weekly = $10,
         show_in_sidebar = $11,
         sort_order = $12,
         updated_at = $13,
         deleted_at = NULL
     WHERE id = $14`,
    [
      nextTitle,
      nextNotes,
      nextAssignedDate,
      nextAssignedWeekStart,
      nextIsLongTerm,
      nextBucketId,
      nextStartTime,
      nextEndTime,
      nextCompleted,
      nextShowWeekly,
      nextShowSidebar,
      nextSortOrder,
      nowIso,
      id,
    ]
  );

  await notifyDatabaseUpdated("local_tasks:update");
}

/**
 * Toggles the completion checkbox for a local task.
 */
export async function toggleLocalTaskCompletion(
  id: number,
  isCompleted: boolean
): Promise<void> {
  await updateLocalTask(id, { is_completed: isCompleted });
}

/**
 * Moves a local task exclusively to a specific day column (`assignedDate = YYYY-MM-DD`).
 */
export async function moveLocalTaskToDate(
  id: number,
  assignedDate: string,
  keepInSidebar = false
): Promise<void> {
  const updates: UpdateLocalTaskInput = {
    assigned_date: assignedDate,
    assigned_week_start: getMondayWeekStart(assignedDate),
    is_long_term: false,
    show_in_weekly: true,
    show_in_sidebar: keepInSidebar,
  };
  await updateLocalTask(id, updates);
}

/**
 * Moves a local task to the "Weekly Tasks" sidebar or "Long-Term Tasks" sidebar.
 */
export async function moveLocalTaskToSidebar(
  id: number,
  options: {
    weekStartDate: string | null;
    isLongTerm: boolean;
    bucketId?: string;
    keepInDayColumn?: boolean;
  }
): Promise<void> {
  const bucketId =
    options.bucketId && options.bucketId.trim() !== ""
      ? options.bucketId.trim()
      : options.isLongTerm
      ? "long_term"
      : "weekly";
  const updates: UpdateLocalTaskInput = {
    is_long_term: options.isLongTerm,
    bucket_id: bucketId,
    show_in_sidebar: true,
  };
  if (!options.isLongTerm && options.weekStartDate) {
    updates.assigned_week_start = options.weekStartDate;
  }
  if (!options.keepInDayColumn) {
    updates.show_in_weekly = false;
    updates.assigned_date = null;
  }
  await updateLocalTask(id, updates);
}

export async function clearCompletedTasksForBucket(
  bucketId: string,
  scope: BucketScope,
  weekStartDate: string,
  weekEndDate: string
): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();

  if (scope === "persistent") {
    await db.execute(
      `UPDATE local_tasks
       SET show_in_sidebar = 0,
           updated_at = $1
       WHERE is_completed = 1
         AND show_in_sidebar = 1
         AND show_in_weekly = 1
         AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $2
         AND (deleted_at IS NULL OR updated_at > deleted_at)`,
      [nowIso, bucketId]
    );
    await db.execute(
      `UPDATE local_tasks
       SET deleted_at = $1,
           updated_at = $1
       WHERE is_completed = 1
         AND show_in_sidebar = 1
         AND show_in_weekly = 0
         AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $2
         AND (deleted_at IS NULL OR updated_at > deleted_at)`,
      [nowIso, bucketId]
    );
  } else {
    await db.execute(
      `UPDATE local_tasks
       SET show_in_sidebar = 0,
           updated_at = $3
       WHERE is_completed = 1
         AND show_in_sidebar = 1
         AND show_in_weekly = 1
         AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $4
         AND (deleted_at IS NULL OR updated_at > deleted_at)
         AND (
           assigned_week_start = $1
           OR (assigned_date >= $1 AND assigned_date <= $2)
         )`,
      [weekStartDate, weekEndDate, nowIso, bucketId]
    );
    await db.execute(
      `UPDATE local_tasks
       SET deleted_at = $3,
           updated_at = $3
       WHERE is_completed = 1
         AND show_in_sidebar = 1
         AND show_in_weekly = 0
         AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $4
         AND (deleted_at IS NULL OR updated_at > deleted_at)
         AND (
           assigned_week_start = $1
           OR (assigned_date >= $1 AND assigned_date <= $2)
         )`,
      [weekStartDate, weekEndDate, nowIso, bucketId]
    );
  }

  await notifyDatabaseUpdated("local_tasks:clear_completed_bucket");
}

/**
 * Migrates a weekly task to the previous or next week (`targetWeekStartDate` Monday).
 */
export async function migrateWeeklyTaskToWeek(
  id: number,
  targetWeekStartDate: string
): Promise<void> {
  await updateLocalTask(id, {
    assigned_week_start: targetWeekStartDate,
    assigned_date: null,
    is_long_term: false,
    show_in_weekly: false,
    show_in_sidebar: true,
  });
}

/**
 * "Clear completed" action in the Tasks sidebar header:
 * Soft-deletes completed tasks from the Tasks sidebar FOR THAT WEEK ONLY.
 */
export async function clearCompletedSidebarTasksForWeek(
  weekStartDate: string,
  weekEndDate: string
): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();

  await db.execute(
    `UPDATE local_tasks
     SET show_in_sidebar = 0,
         updated_at = $3
     WHERE is_completed = 1
       AND show_in_sidebar = 1
       AND show_in_weekly = 1
       AND is_long_term = 0
       AND (deleted_at IS NULL OR updated_at > deleted_at)
       AND (
         assigned_week_start = $1
         OR (assigned_date >= $1 AND assigned_date <= $2)
       )`,
    [weekStartDate, weekEndDate, nowIso]
  );

  await db.execute(
    `UPDATE local_tasks
     SET deleted_at = $3,
         updated_at = $3
     WHERE is_completed = 1
       AND show_in_sidebar = 1
       AND show_in_weekly = 0
       AND is_long_term = 0
       AND (deleted_at IS NULL OR updated_at > deleted_at)
       AND (
         assigned_week_start = $1
         OR (assigned_date >= $1 AND assigned_date <= $2)
       )`,
    [weekStartDate, weekEndDate, nowIso]
  );

  await notifyDatabaseUpdated("local_tasks:clear_completed_week_sidebar");
}

/**
 * "Clear completed" action in the Long-Term Tasks section header (soft-delete).
 */
export async function clearCompletedLongTermSidebarTasks(): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();

  await db.execute(
    `UPDATE local_tasks
     SET show_in_sidebar = 0,
         updated_at = $1
     WHERE is_completed = 1
       AND show_in_sidebar = 1
       AND show_in_weekly = 1
       AND is_long_term = 1
       AND (deleted_at IS NULL OR updated_at > deleted_at)`,
    [nowIso]
  );

  await db.execute(
    `UPDATE local_tasks
     SET deleted_at = $1,
         updated_at = $1
     WHERE is_completed = 1
       AND show_in_sidebar = 1
       AND show_in_weekly = 0
       AND is_long_term = 1
       AND (deleted_at IS NULL OR updated_at > deleted_at)`,
    [nowIso]
  );

  await notifyDatabaseUpdated("local_tasks:clear_completed_long_term_sidebar");
}

/**
 * Soft-deletes a local task by setting `deleted_at` (and `updated_at`) to the current ISO 8601 timestamp.
 */
export async function deleteLocalTask(id: number): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  await db.execute(
    `UPDATE local_tasks
     SET deleted_at = $1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, id]
  );
  await notifyDatabaseUpdated("local_tasks:delete");
}

/**
 * Automatically hard-deletes soft-deleted rows (`deleted_at IS NOT NULL`) in `local_tasks`
 * and `week_images` where `deleted_at` is older than 30 days.
 * Runs on app startup.
 */
export async function purgeExpiredSoftDeletedRecords(daysOld = 30): Promise<number> {
  const db = await getDatabase();
  const cutoffIso = subDays(new Date(), daysOld).toISOString();

  const resTasks = await db.execute(
    `DELETE FROM local_tasks
     WHERE deleted_at IS NOT NULL
       AND deleted_at < $1
       AND (updated_at IS NULL OR updated_at <= deleted_at)`,
    [cutoffIso]
  );

  const resImages = await db.execute(
    `DELETE FROM week_images
     WHERE deleted_at IS NOT NULL
       AND deleted_at < $1
       AND (updated_at IS NULL OR updated_at <= deleted_at)`,
    [cutoffIso]
  );

  const resEvents = await db.execute(
    `DELETE FROM local_events
     WHERE deleted_at IS NOT NULL
       AND deleted_at < $1
       AND (updated_at IS NULL OR updated_at <= deleted_at)`,
    [cutoffIso]
  );

  const resNotes = await db.execute(
    `DELETE FROM note_pages
     WHERE deleted_at IS NOT NULL
       AND deleted_at < $1
       AND (updated_at IS NULL OR updated_at <= deleted_at)`,
    [cutoffIso]
  );

  const totalPurged =
    (resTasks.rowsAffected ?? 0) +
    (resImages.rowsAffected ?? 0) +
    (resEvents.rowsAffected ?? 0) +
    (resNotes.rowsAffected ?? 0);
  if (totalPurged > 0) {
    await notifyDatabaseUpdated("local_tasks:purge_expired");
  }
  return totalPurged;
}

/**
 * Immediately hard-deletes ALL soft-deleted rows (`deleted_at IS NOT NULL`) from `local_tasks`
 * and `week_images` in SQLite (triggered by the "Clean Deleted Tasks" button in Settings).
 */
export async function purgeAllSoftDeletedRecordsNow(): Promise<{
  purgedTasks: number;
  purgedImages: number;
}> {
  const db = await getDatabase();

  const resTasks = await db.execute(
    `DELETE FROM local_tasks
     WHERE deleted_at IS NOT NULL
       AND (updated_at IS NULL OR updated_at <= deleted_at)`
  );

  const resImages = await db.execute(
    `DELETE FROM week_images
     WHERE deleted_at IS NOT NULL
       AND (updated_at IS NULL OR updated_at <= deleted_at)`
  );

  await db.execute(
    `DELETE FROM local_events
     WHERE deleted_at IS NOT NULL
       AND (updated_at IS NULL OR updated_at <= deleted_at)`
  );

  await db.execute(
    `DELETE FROM note_pages
     WHERE deleted_at IS NOT NULL
       AND (updated_at IS NULL OR updated_at <= deleted_at)`
  );

  const purgedTasks = resTasks.rowsAffected ?? 0;
  const purgedImages = resImages.rowsAffected ?? 0;

  await notifyDatabaseUpdated("local_tasks:purge_all_deleted");
  return { purgedTasks, purgedImages };
}

/**
 * Upserts remote GitHub `tasks` and `week_images` into local SQLite by `id`:
 * Compares the effective newest timestamp (`max(updated_at, deleted_at)`) of the remote item
 * against the local item. Whichever timestamp (`updated_at` vs. `deleted_at`) is newest wins!
 */
export async function upsertRemoteBackupIntoLocal(
  remoteTasks: LocalTask[],
  remoteImages: WeekImage[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = []
): Promise<number> {
  const db = await getDatabase();
  const localTasks = await getAllLocalTasks();
  const localBySyncId = new Map<string, LocalTask>();
  const localById = new Map<number, LocalTask>();
  for (const lt of localTasks) {
    if (lt.sync_id && lt.sync_id.trim() !== "") {
      localBySyncId.set(lt.sync_id.trim(), lt);
    }
    localById.set(lt.id, lt);
  }

  let upsertedCount = 0;

  for (const rawRt of remoteTasks) {
    const rt = resolveSoftDeleteWinner({
      ...rawRt,
      updated_at: rawRt.updated_at || rawRt.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawRt.deleted_at ?? null,
    });

    const remoteSyncId = rt.sync_id && rt.sync_id.trim() !== "" ? rt.sync_id.trim() : null;
    const existing = remoteSyncId ? localBySyncId.get(remoteSyncId) : localById.get(rt.id);
    const remoteEffective = getEffectiveTimestamp(rt);
    const localEffective = existing ? getEffectiveTimestamp(existing) : "";

    if (!existing) {
      const resolvedSyncId = remoteSyncId || generateUuid();
      const resolvedBucketId =
        rt.bucket_id && rt.bucket_id.trim() !== ""
          ? rt.bucket_id.trim()
          : rt.is_long_term
          ? "long_term"
          : "weekly";
      await db.execute(
        `INSERT INTO local_tasks (
          sync_id, title, notes, assigned_date, assigned_week_start, is_long_term, bucket_id,
          start_time, end_time, is_completed, show_in_weekly, show_in_sidebar,
          sort_order, created_at, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          resolvedSyncId,
          rt.title,
          rt.notes,
          rt.assigned_date,
          rt.assigned_week_start,
          rt.is_long_term ? 1 : 0,
          resolvedBucketId,
          rt.start_time,
          rt.end_time,
          rt.is_completed ? 1 : 0,
          rt.show_in_weekly ? 1 : 0,
          rt.show_in_sidebar ? 1 : 0,
          rt.sort_order,
          rt.created_at || rt.updated_at,
          rt.updated_at,
          rt.deleted_at,
        ]
      );
      upsertedCount++;
    } else if (remoteEffective > localEffective) {
      // Combine remote and local timestamps and let the newest of (updated_at vs deleted_at) win
      const newestUpdated =
        rt.updated_at > existing.updated_at ? rt.updated_at : existing.updated_at;
      const candDeleted =
        (rt.deleted_at || "") > (existing.deleted_at || "")
          ? rt.deleted_at
          : existing.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;
      const resolvedSyncId = remoteSyncId || existing.sync_id || generateUuid();
      const resolvedBucketId =
        rt.bucket_id && rt.bucket_id.trim() !== ""
          ? rt.bucket_id.trim()
          : existing.bucket_id && existing.bucket_id.trim() !== ""
          ? existing.bucket_id.trim()
          : rt.is_long_term
          ? "long_term"
          : "weekly";

      await db.execute(
        `UPDATE local_tasks
         SET sync_id = $1,
             title = $2,
             notes = $3,
             assigned_date = $4,
             assigned_week_start = $5,
             is_long_term = $6,
             bucket_id = $7,
             start_time = $8,
             end_time = $9,
             is_completed = $10,
             show_in_weekly = $11,
             show_in_sidebar = $12,
             sort_order = $13,
             created_at = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          resolvedSyncId,
          rt.title,
          rt.notes,
          rt.assigned_date,
          rt.assigned_week_start,
          rt.is_long_term ? 1 : 0,
          resolvedBucketId,
          rt.start_time,
          rt.end_time,
          rt.is_completed ? 1 : 0,
          rt.show_in_weekly ? 1 : 0,
          rt.show_in_sidebar ? 1 : 0,
          rt.sort_order,
          rt.created_at || existing.created_at,
          newestUpdated,
          winningDeleted,
          existing.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localImages = await getAllWeekImages();
  const localImgMap = new Map<string, WeekImage>();
  for (const li of localImages) {
    localImgMap.set(li.id, li);
  }

  for (const rawImg of remoteImages) {
    const img = resolveSoftDeleteWinner({
      ...rawImg,
      updated_at: rawImg.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawImg.deleted_at ?? null,
    });

    const existingImg = localImgMap.get(img.id);
    const remoteEffective = getEffectiveTimestamp(img);
    const localEffective = existingImg ? getEffectiveTimestamp(existingImg) : "";

    if (!existingImg) {
      await db.execute(
        `INSERT INTO week_images (
          id, week_start, image_url, pos_x, pos_y, width, height, z_index, is_locked,
          rotation, crop_top, crop_right, crop_bottom, crop_left, opacity, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          img.id,
          img.week_start,
          img.image_url,
          img.pos_x,
          img.pos_y,
          img.width,
          img.height ?? null,
          img.z_index ?? 10,
          img.is_locked ? 1 : 0,
          img.rotation ?? 0,
          img.crop_top ?? 0,
          img.crop_right ?? 0,
          img.crop_bottom ?? 0,
          img.crop_left ?? 0,
          img.opacity ?? 10,
          img.updated_at,
          img.deleted_at,
        ]
      );
      upsertedCount++;
    } else if (remoteEffective > localEffective) {
      const newestUpdated =
        img.updated_at > existingImg.updated_at
          ? img.updated_at
          : existingImg.updated_at;
      const candDeleted =
        (img.deleted_at || "") > (existingImg.deleted_at || "")
          ? img.deleted_at
          : existingImg.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;

      await db.execute(
        `UPDATE week_images
         SET week_start = $1,
             image_url = $2,
             pos_x = $3,
             pos_y = $4,
             width = $5,
             height = $6,
             z_index = $7,
             is_locked = $8,
             rotation = $9,
             crop_top = $10,
             crop_right = $11,
             crop_bottom = $12,
             crop_left = $13,
             opacity = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          img.week_start,
          img.image_url,
          img.pos_x,
          img.pos_y,
          img.width,
          img.height ?? null,
          img.z_index ?? 10,
          img.is_locked ? 1 : 0,
          img.rotation ?? 0,
          img.crop_top ?? 0,
          img.crop_right ?? 0,
          img.crop_bottom ?? 0,
          img.crop_left ?? 0,
          img.opacity ?? 10,
          newestUpdated,
          winningDeleted,
          img.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localEvents = await getAllLocalEventsForBackup();
  const localEventMap = new Map<string, LocalEvent>();
  for (const ev of localEvents) {
    localEventMap.set(ev.id, ev);
  }

  for (const rawEv of remoteLocalEvents) {
    if (!rawEv.id) continue;
    const ev = resolveSoftDeleteWinner({
      ...rawEv,
      created_at: rawEv.created_at || rawEv.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at: rawEv.updated_at || rawEv.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawEv.deleted_at ?? null,
    });
    const existingEv = localEventMap.get(ev.id);
    const remoteEff = getEffectiveTimestamp(ev);
    const localEff = existingEv ? getEffectiveTimestamp(existingEv) : "";

    if (!existingEv) {
      await db.execute(
        `INSERT INTO local_events (
          id, title, location, event_date, start_time, end_time,
          is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
          repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          ev.id,
          ev.title,
          ev.location ?? null,
          ev.event_date,
          ev.start_time ?? null,
          ev.end_time ?? null,
          ev.is_all_day ? 1 : 0,
          ev.is_repeating ? 1 : 0,
          ev.repeat_type ?? null,
          Math.max(1, ev.repeat_interval || 1),
          ev.repeat_unit ?? null,
          ev.repeat_end_date ?? null,
          JSON.stringify(Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []),
          JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
          ev.created_at,
          ev.updated_at,
          ev.deleted_at ?? null,
        ]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const newestUpdated =
        ev.updated_at > existingEv.updated_at ? ev.updated_at : existingEv.updated_at;
      const candDeleted =
        (ev.deleted_at || "") > (existingEv.deleted_at || "")
          ? ev.deleted_at
          : existingEv.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;

      await db.execute(
        `UPDATE local_events
         SET title = $1,
             location = $2,
             event_date = $3,
             start_time = $4,
             end_time = $5,
             is_all_day = $6,
             is_repeating = $7,
             repeat_type = $8,
             repeat_interval = $9,
             repeat_unit = $10,
             repeat_end_date = $11,
             excluded_dates = $12,
             hidden_dates = $13,
             created_at = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          ev.title,
          ev.location ?? null,
          ev.event_date,
          ev.start_time ?? null,
          ev.end_time ?? null,
          ev.is_all_day ? 1 : 0,
          ev.is_repeating ? 1 : 0,
          ev.repeat_type ?? null,
          Math.max(1, ev.repeat_interval || 1),
          ev.repeat_unit ?? null,
          ev.repeat_end_date ?? null,
          JSON.stringify(Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []),
          JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
          ev.created_at || existingEv.created_at,
          newestUpdated,
          winningDeleted,
          ev.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localNotePages = await getAllNotePagesForBackup();
  const localNoteMap = new Map<string, NotePage>();
  for (const np of localNotePages) {
    localNoteMap.set(np.id, np);
  }

  for (const rawNp of remoteNotePages) {
    if (!rawNp.id) continue;
    const np = resolveSoftDeleteWinner({
      ...rawNp,
      updated_at: rawNp.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawNp.deleted_at ?? null,
    });
    const existingNp = localNoteMap.get(np.id);
    const remoteEff = getEffectiveTimestamp(np);
    const localEff = existingNp ? getEffectiveTimestamp(existingNp) : "";

    if (!existingNp) {
      await db.execute(
        `INSERT INTO note_pages (id, page_order, content, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [np.id, np.page_order, np.content ?? "", np.updated_at, np.deleted_at ?? null]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const newestUpdated =
        np.updated_at > existingNp.updated_at ? np.updated_at : existingNp.updated_at;
      const candDeleted =
        (np.deleted_at || "") > (existingNp.deleted_at || "")
          ? np.deleted_at
          : existingNp.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;

      await db.execute(
        `UPDATE note_pages
         SET page_order = $1,
             content = $2,
             updated_at = $3,
             deleted_at = $4
         WHERE id = $5`,
        [np.page_order, np.content ?? "", newestUpdated, winningDeleted, np.id]
      );
      upsertedCount++;
    }
  }

  const localBucketDefs = await getAllBucketDefinitionsForBackup();
  const localBucketDefMap = new Map<string, BucketDefinition>();
  for (const bd of localBucketDefs) {
    localBucketDefMap.set(bd.id, bd);
  }

  for (const rawBd of remoteBucketDefs) {
    if (!rawBd.id) continue;
    const bd = resolveSoftDeleteWinner({
      ...rawBd,
      scope: rawBd.scope === "persistent" ? ("persistent" as const) : ("weekly" as const),
      created_at: rawBd.created_at || rawBd.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at: rawBd.updated_at || rawBd.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawBd.deleted_at ?? null,
    });
    const existingBd = localBucketDefMap.get(bd.id);
    const remoteEff = getEffectiveTimestamp(bd);
    const localEff = existingBd ? getEffectiveTimestamp(existingBd) : "";

    if (!existingBd) {
      await db.execute(
        `INSERT INTO bucket_definitions (id, title, scope, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bd.id, bd.title, bd.scope, bd.created_at, bd.updated_at, bd.deleted_at ?? null]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const newestUpdated =
        bd.updated_at > existingBd.updated_at ? bd.updated_at : existingBd.updated_at;
      const candDeleted =
        (bd.deleted_at || "") > (existingBd.deleted_at || "")
          ? bd.deleted_at
          : existingBd.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;

      await db.execute(
        `UPDATE bucket_definitions
         SET title = $1,
             scope = $2,
             updated_at = $3,
             deleted_at = $4
         WHERE id = $5`,
        [bd.title, bd.scope, newestUpdated, winningDeleted, bd.id]
      );
      upsertedCount++;
    }
  }

  const localBucketLayouts = await getAllBucketLayouts();
  const localLayoutMap = new Map<string, BucketLayoutSnapshot>();
  for (const bl of localBucketLayouts) {
    localLayoutMap.set(bl.effective_from_week, bl);
  }

  for (const rawBl of remoteBucketLayouts) {
    if (!rawBl.effective_from_week) continue;
    const existingBl = localLayoutMap.get(rawBl.effective_from_week);
    const remoteUpdated = rawBl.updated_at || "1970-01-01T00:00:00.000Z";
    const localUpdated = existingBl?.updated_at || "";

    if (!existingBl || remoteUpdated > localUpdated) {
      await db.execute(
        `INSERT INTO bucket_layouts (effective_from_week, buckets_json, is_explicit_override, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(effective_from_week) DO UPDATE SET
           buckets_json = excluded.buckets_json,
           is_explicit_override = excluded.is_explicit_override,
           updated_at = excluded.updated_at`,
        [
          rawBl.effective_from_week,
          JSON.stringify(Array.isArray(rawBl.buckets) ? rawBl.buckets : []),
          rawBl.is_explicit_override ? 1 : 0,
          remoteUpdated,
        ]
      );
      upsertedCount++;
    }
  }

  if (upsertedCount > 0) {
    await notifyDatabaseUpdated("github_sync:pull_upsert");
  }
  return upsertedCount;
}

/**
 * Replaces the entire local `local_tasks` and `week_images` tables with the given dataset.
 */
export async function replaceAllLocalDataWithRemote(
  remoteTasks: LocalTask[],
  remoteImages: WeekImage[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = []
): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM local_tasks`);
  await db.execute(`DELETE FROM week_images WHERE COALESCE(is_local_only, 0) = 0`);
  await db.execute(`DELETE FROM local_events`);
  await db.execute(`DELETE FROM note_pages`);
  await db.execute(`DELETE FROM bucket_definitions`);
  await db.execute(`DELETE FROM bucket_layouts`);

  for (const rawRt of remoteTasks) {
    const rt = resolveSoftDeleteWinner({
      ...rawRt,
      updated_at: rawRt.updated_at || rawRt.created_at || new Date().toISOString(),
      deleted_at: rawRt.deleted_at ?? null,
    });
    const resolvedSyncId = rt.sync_id && rt.sync_id.trim() !== "" ? rt.sync_id.trim() : generateUuid();
    const resolvedBucketId =
      rt.bucket_id && rt.bucket_id.trim() !== ""
        ? rt.bucket_id.trim()
        : rt.is_long_term
        ? "long_term"
        : "weekly";
    await db.execute(
      `INSERT INTO local_tasks (
        sync_id, title, notes, assigned_date, assigned_week_start, is_long_term, bucket_id,
        start_time, end_time, is_completed, show_in_weekly, show_in_sidebar,
        sort_order, created_at, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        resolvedSyncId,
        rt.title,
        rt.notes,
        rt.assigned_date,
        rt.assigned_week_start,
        rt.is_long_term ? 1 : 0,
        resolvedBucketId,
        rt.start_time,
        rt.end_time,
        rt.is_completed ? 1 : 0,
        rt.show_in_weekly ? 1 : 0,
        rt.show_in_sidebar ? 1 : 0,
        rt.sort_order,
        rt.created_at || rt.updated_at,
        rt.updated_at,
        rt.deleted_at,
      ]
    );
  }

  for (const rawImg of remoteImages) {
    const img = resolveSoftDeleteWinner({
      ...rawImg,
      updated_at: rawImg.updated_at || new Date().toISOString(),
      deleted_at: rawImg.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO week_images (
        id, week_start, image_url, pos_x, pos_y, width, height, z_index, is_locked,
        rotation, crop_top, crop_right, crop_bottom, crop_left, opacity, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        img.id,
        img.week_start,
        img.image_url,
        img.pos_x,
        img.pos_y,
        img.width,
        img.height ?? null,
        img.z_index ?? 10,
        img.is_locked ? 1 : 0,
        img.rotation ?? 0,
        img.crop_top ?? 0,
        img.crop_right ?? 0,
        img.crop_bottom ?? 0,
        img.crop_left ?? 0,
        img.opacity ?? 10,
        img.updated_at,
        img.deleted_at,
      ]
    );
  }

  for (const rawEv of remoteLocalEvents) {
    if (!rawEv.id) continue;
    const ev = resolveSoftDeleteWinner({
      ...rawEv,
      created_at: rawEv.created_at || rawEv.updated_at || new Date().toISOString(),
      updated_at: rawEv.updated_at || rawEv.created_at || new Date().toISOString(),
      deleted_at: rawEv.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO local_events (
        id, title, location, event_date, start_time, end_time,
        is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
        repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        ev.id,
        ev.title,
        ev.location ?? null,
        ev.event_date,
        ev.start_time ?? null,
        ev.end_time ?? null,
        ev.is_all_day ? 1 : 0,
        ev.is_repeating ? 1 : 0,
        ev.repeat_type ?? null,
        Math.max(1, ev.repeat_interval || 1),
        ev.repeat_unit ?? null,
        ev.repeat_end_date ?? null,
        JSON.stringify(Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []),
        JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
        ev.created_at,
        ev.updated_at,
        ev.deleted_at ?? null,
      ]
    );
  }

  for (const rawNp of remoteNotePages) {
    if (!rawNp.id) continue;
    const np = resolveSoftDeleteWinner({
      ...rawNp,
      updated_at: rawNp.updated_at || new Date().toISOString(),
      deleted_at: rawNp.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO note_pages (id, page_order, content, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [np.id, np.page_order, np.content ?? "", np.updated_at, np.deleted_at ?? null]
    );
  }

  for (const rawBd of remoteBucketDefs) {
    if (!rawBd.id) continue;
    const bd = resolveSoftDeleteWinner({
      ...rawBd,
      scope: rawBd.scope === "persistent" ? ("persistent" as const) : ("weekly" as const),
      created_at: rawBd.created_at || rawBd.updated_at || new Date().toISOString(),
      updated_at: rawBd.updated_at || rawBd.created_at || new Date().toISOString(),
      deleted_at: rawBd.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO bucket_definitions (id, title, scope, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bd.id, bd.title, bd.scope, bd.created_at, bd.updated_at, bd.deleted_at ?? null]
    );
  }

  // Ensure built-in weekly/long_term exist if remote payload came from an older version without bucket_definitions
  await getAllBucketDefinitionsForBackup();

  for (const rawBl of remoteBucketLayouts) {
    if (!rawBl.effective_from_week) continue;
    await db.execute(
      `INSERT INTO bucket_layouts (effective_from_week, buckets_json, is_explicit_override, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [
        rawBl.effective_from_week,
        JSON.stringify(Array.isArray(rawBl.buckets) ? rawBl.buckets : []),
        rawBl.is_explicit_override ? 1 : 0,
        rawBl.updated_at || new Date().toISOString(),
      ]
    );
  }

  await notifyDatabaseUpdated("github_sync:replace_all");
}
