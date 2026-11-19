import { getDatabase, notifyDatabaseUpdated } from "./database";
import { GoogleEvent, UpsertGoogleEventInput } from "../types/planner";

interface RawCalendarEventRow {
  id: number;
  instance_key: string;
  uid: string;
  source_url?: string;
  calendar_name?: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  event_date: string;
  is_all_day: number;
  is_hidden: number;
  last_synced: string;
}

function mapRowToCalendarEvent(row: RawCalendarEventRow): GoogleEvent {
  return {
    ...row,
    source_url: row.source_url ?? "",
    calendar_name: row.calendar_name ?? "Calendar",
    is_all_day: Boolean(row.is_all_day),
    is_hidden: Boolean(row.is_hidden),
  };
}

/**
 * Queries all cached Calendar events (`calendar_events`) within an inclusive date range (YYYY-MM-DD).
 * Ordered chronologically: all-day events first, then by start_time ascending.
 */
export async function getGoogleEventsInRange(
  startDate: string,
  endDate: string
): Promise<GoogleEvent[]> {
  const db = await getDatabase();
  const rows = await db.select<RawCalendarEventRow[]>(
    `SELECT *
     FROM calendar_events
     WHERE event_date >= $1 AND event_date <= $2
     ORDER BY event_date ASC, is_all_day DESC, start_time ASC`,
    [startDate, endDate]
  );
  return rows.map(mapRowToCalendarEvent);
}

/**
 * Queries all cached Calendar events for a single date (YYYY-MM-DD).
 */
export async function getGoogleEventsForDate(dateStr: string): Promise<GoogleEvent[]> {
  return getGoogleEventsInRange(dateStr, dateStr);
}

/**
 * Fetches all cached `.ics` calendar events from `calendar_events` for exporting `calendar-cache.json`.
 */
export async function getAllCachedCalendarEvents(): Promise<GoogleEvent[]> {
  const db = await getDatabase();
  const rows = await db.select<RawCalendarEventRow[]>(
    `SELECT *
     FROM calendar_events
     ORDER BY event_date ASC, is_all_day DESC, start_time ASC`
  );
  return rows.map(mapRowToCalendarEvent);
}

/**
 * Hides or unhides a specific Calendar event occurrence in the weekly view.
 * This preference persists across background .ics syncs.
 */
export async function setGoogleEventHidden(
  id: number,
  isHidden: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE calendar_events SET is_hidden = $1 WHERE id = $2`,
    [isHidden ? 1 : 0, id]
  );
  await notifyDatabaseUpdated("calendar_events:toggle_hidden");
}

/**
 * Unhides all hidden Calendar events for a specific date (YYYY-MM-DD)
 * or across a date range.
 */
export async function unhideAllGoogleEventsInRange(
  startDate: string,
  endDate: string
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE calendar_events
     SET is_hidden = 0
     WHERE event_date >= $1 AND event_date <= $2 AND is_hidden = 1`,
    [startDate, endDate]
  );
  await notifyDatabaseUpdated("calendar_events:unhide_range");
}

/**
 * Upserts a batch of expanded Calendar event occurrences across multiple feeds (`calendar_events`)
 * within the rolling window (`windowStartDate` to `windowEndDate`, YYYY-MM-DD)
 * without duplicating rows or resetting `is_hidden`.
 *
 * - Events from each successfully synced feed (`succeededSourceUrls`) have stale occurrences
 *   pruned within the active window.
 * - Events belonging to removed calendar URLs (not in `activeSourceUrls`) are removed.
 */
export async function upsertGoogleEventsBatch(
  events: UpsertGoogleEventInput[],
  windowStartDate: string,
  windowEndDate: string,
  succeededSourceUrls: string[] = [],
  activeSourceUrls: string[] = []
): Promise<number> {
  const db = await getDatabase();
  const syncTimestamp = new Date().toISOString();

  const CHUNK_SIZE = 50;
  for (let i = 0; i < events.length; i += CHUNK_SIZE) {
    const chunk = events.slice(i, i + CHUNK_SIZE);
    const placeholders: string[] = [];
    const params: unknown[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const ev = chunk[j];
      const base = j * 12;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, 0, $${base + 12})`
      );
      params.push(
        ev.instance_key,
        ev.uid,
        ev.source_url,
        ev.calendar_name,
        ev.title,
        ev.description,
        ev.location,
        ev.start_time,
        ev.end_time,
        ev.event_date,
        ev.is_all_day ? 1 : 0,
        syncTimestamp
      );
    }

    await db.execute(
      `INSERT INTO calendar_events (
        instance_key, uid, source_url, calendar_name, title, description, location,
        start_time, end_time, event_date, is_all_day, is_hidden, last_synced
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT(instance_key) DO UPDATE SET
        source_url = excluded.source_url,
        calendar_name = excluded.calendar_name,
        title = excluded.title,
        description = excluded.description,
        location = excluded.location,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        event_date = excluded.event_date,
        is_all_day = excluded.is_all_day,
        last_synced = excluded.last_synced`,
      params
    );
  }

  // Prune stale occurrences for each feed that synced successfully in this run
  for (const sourceUrl of succeededSourceUrls) {
    await db.execute(
      `DELETE FROM calendar_events
       WHERE source_url = $1
         AND event_date >= $2
         AND event_date <= $3
         AND last_synced < $4`,
      [sourceUrl, windowStartDate, windowEndDate, syncTimestamp]
    );
  }

  // Remove any legacy or removed feed events not in activeSourceUrls
  if (activeSourceUrls.length === 0) {
    await db.execute(`DELETE FROM calendar_events`);
  } else {
    const existingSources = await db.select<{ source_url: string }[]>(
      `SELECT DISTINCT source_url FROM calendar_events`
    );
    const activeSet = new Set(activeSourceUrls);
    for (const row of existingSources) {
      if (!activeSet.has(row.source_url)) {
        await db.execute(
          `DELETE FROM calendar_events WHERE source_url = $1`,
          [row.source_url]
        );
      }
    }
  }

  await notifyDatabaseUpdated("calendar_events:sync_upsert");
  return events.length;
}
