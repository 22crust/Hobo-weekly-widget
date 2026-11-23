import { format, parseISO, startOfWeek, subDays } from "date-fns";
import { getDatabase, notifyDatabaseUpdated } from "./database";
import { generateUuid } from "../utils/id";
import {
  BucketScope,
  CreateLocalTaskInput,
  LocalTask,
  UpdateLocalTaskInput,
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
