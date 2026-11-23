import { getDatabase, notifyDatabaseUpdated } from "./database";
import { getEffectiveTimestamp, resolveSoftDeleteWinner } from "../../shared/plannerCore";
import type { MoodColorKey } from "../../shared/calendarTools";
import type { DateCounter, MoodEntry } from "../types/planner";
import { generateUuid } from "../utils/id";

const VALID_MOOD_COLORS = new Set<string>([
  "grey",
  "red",
  "orange",
  "yellow",
  "green",
]);

function normalizeMoodColor(raw: string): MoodColorKey {
  return VALID_MOOD_COLORS.has(raw) ? (raw as MoodColorKey) : "grey";
}

export async function getAllMoodEntriesForBackup(): Promise<MoodEntry[]> {
  const db = await getDatabase();
  const rows = await db.select<MoodEntry[]>(
    `SELECT date, color_key, updated_at, deleted_at FROM mood_entries ORDER BY date ASC`
  );
  return rows.map((r) =>
    resolveSoftDeleteWinner({
      date: r.date,
      color_key: normalizeMoodColor(r.color_key),
      updated_at: r.updated_at,
      deleted_at: r.deleted_at ?? null,
    })
  );
}

export async function getMoodEntriesForYear(
  year: number
): Promise<Record<string, MoodColorKey>> {
  const db = await getDatabase();
  const prefix = `${year}-%`;
  const rows = await db.select<MoodEntry[]>(
    `SELECT date, color_key, updated_at, deleted_at
     FROM mood_entries
     WHERE date LIKE $1
       AND (deleted_at IS NULL OR updated_at > deleted_at)`,
    [prefix]
  );
  const map: Record<string, MoodColorKey> = {};
  for (const r of rows) {
    map[r.date] = normalizeMoodColor(r.color_key);
  }
  return map;
}

export async function setMoodEntry(
  date: string,
  colorKey: MoodColorKey | null
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  if (colorKey === null) {
    await db.execute(
      `INSERT INTO mood_entries (date, color_key, updated_at, deleted_at)
       VALUES ($1, 'grey', $2, $2)
       ON CONFLICT(date) DO UPDATE SET
         updated_at = $2,
         deleted_at = $2`,
      [date, now]
    );
  } else {
    await db.execute(
      `INSERT INTO mood_entries (date, color_key, updated_at, deleted_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT(date) DO UPDATE SET
         color_key = excluded.color_key,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
      [date, colorKey, now]
    );
  }

  await notifyDatabaseUpdated("mood_entries:update");
}

export async function getAllDateCountersForBackup(): Promise<DateCounter[]> {
  const db = await getDatabase();
  const rows = await db.select<DateCounter[]>(
    `SELECT id, title, target_date, created_at, updated_at, deleted_at
     FROM date_counters
     ORDER BY target_date ASC, created_at ASC`
  );
  return rows.map((r) =>
    resolveSoftDeleteWinner({
      ...r,
      deleted_at: r.deleted_at ?? null,
    })
  );
}

export async function getActiveDateCounters(): Promise<DateCounter[]> {
  const db = await getDatabase();
  const rows = await db.select<DateCounter[]>(
    `SELECT id, title, target_date, created_at, updated_at, deleted_at
     FROM date_counters
     WHERE deleted_at IS NULL OR updated_at > deleted_at
     ORDER BY target_date ASC, created_at ASC`
  );
  return rows.map((r) => ({
    ...r,
    deleted_at: null,
  }));
}

export async function createDateCounter(
  title: string,
  targetDate: string
): Promise<DateCounter> {
  const db = await getDatabase();
  const id = generateUuid();
  const now = new Date().toISOString();
  const trimmed = title.trim();

  await db.execute(
    `INSERT INTO date_counters (id, title, target_date, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $4, NULL)`,
    [id, trimmed, targetDate, now]
  );

  await notifyDatabaseUpdated("date_counters:create");
  return {
    id,
    title: trimmed,
    target_date: targetDate,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

export async function updateDateCounter(
  id: string,
  title: string,
  targetDate: string
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE date_counters
     SET title = $1, target_date = $2, updated_at = $3, deleted_at = NULL
     WHERE id = $4`,
    [title.trim(), targetDate, now, id]
  );
  await notifyDatabaseUpdated("date_counters:update");
}

export async function deleteDateCounter(id: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE date_counters SET deleted_at = $1, updated_at = $1 WHERE id = $2`,
    [now, id]
  );
  await notifyDatabaseUpdated("date_counters:delete");
}

export async function upsertRemoteCalendarToolsIntoLocal(
  remoteMoods: MoodEntry[] = [],
  remoteCounters: DateCounter[] = []
): Promise<void> {
  if (remoteMoods.length === 0 && remoteCounters.length === 0) return;
  const db = await getDatabase();

  if (remoteMoods.length > 0) {
    const localMoods = await getAllMoodEntriesForBackup();
    const localMap = new Map(localMoods.map((m) => [m.date, m]));
    for (const raw of remoteMoods) {
      if (!raw.date) continue;
      const r = resolveSoftDeleteWinner({
        date: raw.date,
        color_key: normalizeMoodColor(raw.color_key),
        updated_at: raw.updated_at || "1970-01-01T00:00:00.000Z",
        deleted_at: raw.deleted_at ?? null,
      });
      const existing = localMap.get(r.date);
      if (
        !existing ||
        getEffectiveTimestamp(r) > getEffectiveTimestamp(existing)
      ) {
        await db.execute(
          `INSERT INTO mood_entries (date, color_key, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT(date) DO UPDATE SET
             color_key = excluded.color_key,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [r.date, r.color_key, r.updated_at, r.deleted_at]
        );
      }
    }
  }

  if (remoteCounters.length > 0) {
    const localCounters = await getAllDateCountersForBackup();
    const localMap = new Map(localCounters.map((c) => [c.id, c]));
    for (const raw of remoteCounters) {
      if (!raw.id) continue;
      const r = resolveSoftDeleteWinner({
        ...raw,
        updated_at: raw.updated_at || "1970-01-01T00:00:00.000Z",
        deleted_at: raw.deleted_at ?? null,
      });
      const existing = localMap.get(r.id);
      if (
        !existing ||
        getEffectiveTimestamp(r) > getEffectiveTimestamp(existing)
      ) {
        await db.execute(
          `INSERT INTO date_counters (id, title, target_date, created_at, updated_at, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             target_date = excluded.target_date,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
          [
            r.id,
            r.title,
            r.target_date,
            r.created_at || r.updated_at,
            r.updated_at,
            r.deleted_at,
          ]
        );
      }
    }
  }

  await notifyDatabaseUpdated("calendar_tools:sync");
}

export async function replaceAllCalendarToolsWithRemote(
  remoteMoods: MoodEntry[] = [],
  remoteCounters: DateCounter[] = []
): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM mood_entries`);
  await db.execute(`DELETE FROM date_counters`);

  for (const raw of remoteMoods) {
    if (!raw.date) continue;
    const r = resolveSoftDeleteWinner({
      date: raw.date,
      color_key: normalizeMoodColor(raw.color_key),
      updated_at: raw.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: raw.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO mood_entries (date, color_key, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4)`,
      [r.date, r.color_key, r.updated_at, r.deleted_at]
    );
  }

  for (const raw of remoteCounters) {
    if (!raw.id) continue;
    const r = resolveSoftDeleteWinner({
      ...raw,
      updated_at: raw.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: raw.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO date_counters (id, title, target_date, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        r.id,
        r.title,
        r.target_date,
        r.created_at || r.updated_at,
        r.updated_at,
        r.deleted_at,
      ]
    );
  }

  await notifyDatabaseUpdated("calendar_tools:sync");
}
