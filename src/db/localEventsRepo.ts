import {
  format,
  parseISO,
  subDays,
} from "date-fns";
import { getDatabase, notifyDatabaseUpdated } from "./database";
import { generateUuid } from "../utils/id";
import { expandLocalEventsInRange } from "../../shared/plannerCore";
import {
  CreateLocalEventInput,
  GoogleEvent,
  LocalEvent,
  RepeatType,
  RepeatUnit,
  UpdateLocalEventInput,
} from "../types/planner";

interface RawLocalEventRow {
  id: string;
  title: string;
  location: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: number;
  is_repeating: number;
  repeat_type: string | null;
  repeat_interval: number;
  repeat_unit: string | null;
  repeat_end_date: string | null;
  excluded_dates: string;
  hidden_dates: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}


function mapRowToLocalEvent(row: RawLocalEventRow): LocalEvent {
  return {
    id: row.id,
    title: row.title,
    location: row.location ?? null,
    event_date: row.event_date,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    is_all_day: Boolean(row.is_all_day),
    is_repeating: Boolean(row.is_repeating),
    repeat_type: (row.repeat_type as RepeatType | null) ?? null,
    repeat_interval: Math.max(1, row.repeat_interval || 1),
    repeat_unit: (row.repeat_unit as RepeatUnit | null) ?? null,
    repeat_end_date: row.repeat_end_date ?? null,
    excluded_dates: parseJsonStringArray(row.excluded_dates),
    hidden_dates: parseJsonStringArray(row.hidden_dates),
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * Fetches all `local_events` rows (including soft-deleted tombstones) for GitHub backup sync.
 */
export async function getAllLocalEventsForBackup(): Promise<LocalEvent[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events ORDER BY event_date ASC, created_at ASC`
  );
  return rows.map(mapRowToLocalEvent);
}

/**
 * Queries and expands all `local_events` (including repeating series)
 * within `[rangeStart, rangeEnd]` (inclusive `YYYY-MM-DD`).
 */
export async function getExpandedLocalEventsInRange(
  rangeStart: string,
  rangeEnd: string
): Promise<GoogleEvent[]> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT *
     FROM local_events
     WHERE (deleted_at IS NULL OR updated_at > deleted_at)
       AND event_date <= $1
       AND (is_repeating = 1 OR event_date >= $2)
       AND (repeat_end_date IS NULL OR repeat_end_date >= $2)`,
    [rangeEnd, rangeStart]
  );

  return expandLocalEventsInRange(
    rows.map(mapRowToLocalEvent),
    rangeStart,
    rangeEnd
  );
}

export async function createLocalEvent(
  input: CreateLocalEventInput
): Promise<LocalEvent> {
  const db = await getDatabase();
  const id = generateUuid();
  const now = new Date().toISOString();
  const cleanTitle = input.title.trim();
  const cleanLocation = input.location?.trim() || null;
  const interval = Math.max(1, input.repeat_interval || 1);

  await db.execute(
    `INSERT INTO local_events (
      id, title, location, event_date, start_time, end_time,
      is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
      repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, '[]', '[]', $12, $12)`,
    [
      id,
      cleanTitle,
      cleanLocation,
      input.event_date,
      input.is_all_day ? null : input.start_time ?? "09:00",
      input.is_all_day ? null : input.end_time ?? "10:00",
      input.is_all_day ? 1 : 0,
      input.is_repeating ? 1 : 0,
      input.is_repeating ? input.repeat_type ?? "monthly" : null,
      interval,
      input.is_repeating && input.repeat_type === "custom"
        ? input.repeat_unit ?? "weeks"
        : null,
      now,
    ]
  );

  await notifyDatabaseUpdated("local_events:create");
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [id]
  );
  return mapRowToLocalEvent(rows[0]);
}

export async function updateLocalEventSingle(
  id: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return;

  const current = mapRowToLocalEvent(rows[0]);
  const now = new Date().toISOString();
  const nextIsAllDay =
    updates.is_all_day !== undefined ? updates.is_all_day : current.is_all_day;
  const nextIsRepeating =
    updates.is_repeating !== undefined
      ? updates.is_repeating
      : current.is_repeating;
  const nextRepeatType = nextIsRepeating
    ? updates.repeat_type !== undefined
      ? updates.repeat_type
      : current.repeat_type ?? "monthly"
    : null;
  const nextRepeatUnit =
    nextIsRepeating && nextRepeatType === "custom"
      ? updates.repeat_unit !== undefined
        ? updates.repeat_unit
        : current.repeat_unit ?? "weeks"
      : null;

  await db.execute(
    `UPDATE local_events
     SET title = $1,
         location = $2,
         start_time = $3,
         end_time = $4,
         is_all_day = $5,
         is_repeating = $6,
         repeat_type = $7,
         repeat_interval = $8,
         repeat_unit = $9,
         updated_at = $10,
         deleted_at = NULL
     WHERE id = $11`,
    [
      updates.title !== undefined ? updates.title.trim() : current.title,
      updates.location !== undefined
        ? updates.location?.trim() || null
        : current.location,
      nextIsAllDay
        ? null
        : updates.start_time !== undefined
        ? updates.start_time
        : current.start_time,
      nextIsAllDay
        ? null
        : updates.end_time !== undefined
        ? updates.end_time
        : current.end_time,
      nextIsAllDay ? 1 : 0,
      nextIsRepeating ? 1 : 0,
      nextRepeatType,
      Math.max(1, updates.repeat_interval ?? current.repeat_interval),
      nextRepeatUnit,
      now,
      id,
    ]
  );

  await notifyDatabaseUpdated("local_events:update");
}

/**
 * "Save this event only" on a repeating event:
 * Excludes `occurrenceDate` from the parent series and creates a standalone non-repeating event on `occurrenceDate`.
 */
export async function saveLocalEventThisOnly(
  seriesId: string,
  occurrenceDate: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [seriesId]
  );
  if (rows.length === 0) return;

  const series = mapRowToLocalEvent(rows[0]);
  const now = new Date().toISOString();

  // Exclude occurrenceDate from parent series
  const nextExcluded = Array.from(
    new Set([...series.excluded_dates, occurrenceDate])
  );
  await db.execute(
    `UPDATE local_events SET excluded_dates = $1, updated_at = $2, deleted_at = NULL WHERE id = $3`,
    [JSON.stringify(nextExcluded), now, seriesId]
  );

  // Create standalone single occurrence with the edited values
  const nextIsAllDay =
    updates.is_all_day !== undefined ? updates.is_all_day : series.is_all_day;
  const newId = generateUuid();
  await db.execute(
    `INSERT INTO local_events (
      id, title, location, event_date, start_time, end_time,
      is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
      repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL, 1, NULL, NULL, '[]', '[]', $8, $8)`,
    [
      newId,
      updates.title !== undefined ? updates.title.trim() : series.title,
      updates.location !== undefined
        ? updates.location?.trim() || null
        : series.location,
      occurrenceDate,
      nextIsAllDay ? null : updates.start_time ?? series.start_time ?? "09:00",
      nextIsAllDay ? null : updates.end_time ?? series.end_time ?? "10:00",
      nextIsAllDay ? 1 : 0,
      now,
    ]
  );

  await notifyDatabaseUpdated("local_events:save_this_only");
}

/**
 * "Save all future events" on a repeating event:
 * - If editing the very first occurrence (`occurrenceDate === series.event_date`), updates the series directly.
 * - Otherwise ends the old series the day before `occurrenceDate` and starts a new repeating series on `occurrenceDate`.
 */
export async function saveLocalEventAllFuture(
  seriesId: string,
  occurrenceDate: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [seriesId]
  );
  if (rows.length === 0) return;

  const series = mapRowToLocalEvent(rows[0]);
  if (occurrenceDate <= series.event_date) {
    await updateLocalEventSingle(seriesId, updates);
    return;
  }

  const now = new Date().toISOString();
  const prevDayStr = format(subDays(parseISO(occurrenceDate), 1), "yyyy-MM-dd");
  const remainingExcluded = series.excluded_dates.filter(
    (d) => d < occurrenceDate
  );

  await db.execute(
    `UPDATE local_events
     SET repeat_end_date = $1,
         excluded_dates = $2,
         updated_at = $3,
         deleted_at = NULL
     WHERE id = $4`,
    [prevDayStr, JSON.stringify(remainingExcluded), now, seriesId]
  );

  const nextIsAllDay =
    updates.is_all_day !== undefined ? updates.is_all_day : series.is_all_day;
  const nextIsRepeating =
    updates.is_repeating !== undefined ? updates.is_repeating : true;
  const nextRepeatType = nextIsRepeating
    ? updates.repeat_type !== undefined
      ? updates.repeat_type
      : series.repeat_type ?? "monthly"
    : null;
  const nextRepeatUnit =
    nextIsRepeating && nextRepeatType === "custom"
      ? updates.repeat_unit !== undefined
        ? updates.repeat_unit
        : series.repeat_unit ?? "weeks"
      : null;

  const newId = generateUuid();
  await db.execute(
    `INSERT INTO local_events (
      id, title, location, event_date, start_time, end_time,
      is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
      repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '[]', '[]', $13, $13)`,
    [
      newId,
      updates.title !== undefined ? updates.title.trim() : series.title,
      updates.location !== undefined
        ? updates.location?.trim() || null
        : series.location,
      occurrenceDate,
      nextIsAllDay ? null : updates.start_time ?? series.start_time ?? "09:00",
      nextIsAllDay ? null : updates.end_time ?? series.end_time ?? "10:00",
      nextIsAllDay ? 1 : 0,
      nextIsRepeating ? 1 : 0,
      nextRepeatType,
      Math.max(1, updates.repeat_interval ?? series.repeat_interval),
      nextRepeatUnit,
      series.repeat_end_date,
      now,
    ]
  );

  await notifyDatabaseUpdated("local_events:save_all_future");
}

export async function deleteLocalEventAll(id: string): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  await db.execute(
    `UPDATE local_events SET deleted_at = $1, updated_at = $1 WHERE id = $2`,
    [nowIso, id]
  );
  await notifyDatabaseUpdated("local_events:delete");
}

export async function deleteLocalEventThisOnly(
  seriesId: string,
  occurrenceDate: string
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [seriesId]
  );
  if (rows.length === 0) return;
  const series = mapRowToLocalEvent(rows[0]);
  if (!series.is_repeating) {
    await deleteLocalEventAll(seriesId);
    return;
  }

  const nextExcluded = Array.from(
    new Set([...series.excluded_dates, occurrenceDate])
  );
  await db.execute(
    `UPDATE local_events SET excluded_dates = $1, updated_at = $2, deleted_at = NULL WHERE id = $3`,
    [JSON.stringify(nextExcluded), new Date().toISOString(), seriesId]
  );
  await notifyDatabaseUpdated("local_events:delete_this_only");
}

export async function deleteLocalEventAllFuture(
  seriesId: string,
  occurrenceDate: string
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [seriesId]
  );
  if (rows.length === 0) return;
  const series = mapRowToLocalEvent(rows[0]);

  if (!series.is_repeating || occurrenceDate <= series.event_date) {
    await deleteLocalEventAll(seriesId);
    return;
  }

  const prevDayStr = format(subDays(parseISO(occurrenceDate), 1), "yyyy-MM-dd");
  await db.execute(
    `UPDATE local_events SET repeat_end_date = $1, updated_at = $2, deleted_at = NULL WHERE id = $3`,
    [prevDayStr, new Date().toISOString(), seriesId]
  );
  await notifyDatabaseUpdated("local_events:delete_all_future");
}

export async function setLocalEventOccurrenceHidden(
  id: string,
  occurrenceDate: string,
  isHidden: boolean
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return;

  const ev = mapRowToLocalEvent(rows[0]);
  const nextHidden = isHidden
    ? Array.from(new Set([...ev.hidden_dates, occurrenceDate]))
    : ev.hidden_dates.filter((d) => d !== occurrenceDate);

  await db.execute(
    `UPDATE local_events SET hidden_dates = $1, updated_at = $2, deleted_at = NULL WHERE id = $3`,
    [JSON.stringify(nextHidden), new Date().toISOString(), id]
  );
  await notifyDatabaseUpdated("local_events:toggle_hidden");
}

export async function unhideAllLocalEventsInRange(
  startDate: string,
  endDate: string
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawLocalEventRow[]>(
    `SELECT * FROM local_events WHERE hidden_dates != '[]' AND (deleted_at IS NULL OR updated_at > deleted_at)`
  );

  for (const row of rows) {
    const ev = mapRowToLocalEvent(row);
    const filtered = ev.hidden_dates.filter(
      (d) => d < startDate || d > endDate
    );
    if (filtered.length !== ev.hidden_dates.length) {
      await db.execute(
        `UPDATE local_events SET hidden_dates = $1, updated_at = $2, deleted_at = NULL WHERE id = $3`,
        [JSON.stringify(filtered), new Date().toISOString(), ev.id]
      );
    }
  }
}
