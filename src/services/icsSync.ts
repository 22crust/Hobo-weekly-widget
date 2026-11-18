import ICAL from "ical.js";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { addDays, format, subDays } from "date-fns";
import { getAppSettings } from "../db/appSettingsRepo";
import { upsertGoogleEventsBatch } from "../db/googleEventsRepo";
import {
  CalendarFeedSyncResult,
  SyncStatus,
  UpsertGoogleEventInput,
} from "../types/planner";

const DAYS_BACK = 30;
const DAYS_FORWARD = 90;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

interface RustFetchedCalendarFeed {
  original_url: string;
  normalized_url: string;
  provider: string;
  calendar_name: string;
  ics_text: string;
}

let latestFeedResults: Record<string, CalendarFeedSyncResult> = {};
let inFlightCalendarSync: Promise<SyncStatus> | null = null;
const feedResultsListeners = new Set<
  (results: Record<string, CalendarFeedSyncResult>) => void
>();

export function getLatestCalendarFeedResults(): Record<
  string,
  CalendarFeedSyncResult
> {
  return latestFeedResults;
}

export function onCalendarFeedResultsUpdated(
  listener: (results: Record<string, CalendarFeedSyncResult>) => void
): () => void {
  feedResultsListeners.add(listener);
  return () => {
    feedResultsListeners.delete(listener);
  };
}

function broadcastFeedResults(
  results: Record<string, CalendarFeedSyncResult>
): void {
  latestFeedResults = results;
  for (const listener of feedResultsListeners) {
    listener(results);
  }
}

/**
 * Formats a JS Date as local YYYY-MM-DD.
 */
export function toLocalDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Formats an `ICAL.Time` date directly when `isDate` is true (all-day events),
 * avoiding any UTC/local timezone boundary shift.
 */
function icalTimeToLocalDateString(icalTime: ICAL.Time, fallbackJsDate: Date): string {
  if (
    icalTime &&
    icalTime.isDate &&
    typeof icalTime.year === "number" &&
    typeof icalTime.month === "number" &&
    typeof icalTime.day === "number"
  ) {
    const y = String(icalTime.year).padStart(4, "0");
    const m = String(icalTime.month).padStart(2, "0");
    const d = String(icalTime.day).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return toLocalDateString(fallbackJsDate);
}

/**
 * Normalizes a calendar URL:
 * Converts Apple iCloud's `webcal://` (and `webcals://`) to `https://`.
 */
export function normalizeCalendarUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^webcal:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice("webcal://".length)}`;
  }
  if (/^webcals:\/\//i.test(trimmed)) {
    return `https://${trimmed.slice("webcals://".length)}`;
  }
  return trimmed;
}

/**
 * Automatically detects the calendar provider from a URL string.
 */
export function detectCalendarProvider(rawUrl: string): string {
  const lower = rawUrl.trim().toLowerCase();
  if (!lower) return "Calendar Feed";
  if (
    lower.includes("icloud.com") ||
    lower.includes("apple.com") ||
    lower.startsWith("webcal://") ||
    lower.startsWith("webcals://")
  ) {
    return "Apple iCloud";
  }
  if (
    lower.includes("google.com") ||
    lower.includes("googleusercontent.com")
  ) {
    return "Google Calendar";
  }
  if (
    lower.includes("outlook.live.com") ||
    lower.includes("outlook.office365.com") ||
    lower.includes("office.com") ||
    lower.includes("microsoft.com")
  ) {
    return "Outlook";
  }
  return "iCal (.ics)";
}

/**
 * Checks whether a raw URL string has a valid calendar scheme (`https://`, `http://`, `webcal://`, `webcals://`).
 */
export function isValidCalendarUrlFormat(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (
    trimmed.includes("your_email%40gmail.com") ||
    trimmed.includes("your_secret_token")
  ) {
    return false;
  }
  return /^(https?|webcals?):\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed);
}

/**
 * Splits a newline- or comma-separated string of calendar URLs into individual non-empty entries.
 */
export function splitCalendarUrlEntries(rawUrls: string): string[] {
  return rawUrls
    .split(/[\r\n,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

/**
 * Parses a newline- or comma-separated string of iCal URLs into a clean array of valid URLs.
 */
export function parseIcalUrlsList(rawUrls: string): string[] {
  return splitCalendarUrlEntries(rawUrls).filter(isValidCalendarUrlFormat);
}

/**
 * Reads the configured calendar `.ics` URLs from `app_settings` in SQLite.
 */
export async function getConfiguredIcalUrls(): Promise<string[]> {
  const settings = await getAppSettings();
  const raw = settings.calendar_urls || settings.google_ical_urls || "";
  return splitCalendarUrlEntries(raw);
}

/**
 * Fetches raw `.ics` content via the Rust backend (`fetch_calendar_ics_feed` in `src-tauri/src/calendar_sync.rs`),
 * which converts `webcal://` -> `https://` and fetches via `reqwest`.
 * Falls back to `@tauri-apps/plugin-http` if running outside the Rust command context.
 */
async function fetchCalendarFeed(
  rawUrl: string
): Promise<RustFetchedCalendarFeed> {
  const provider = detectCalendarProvider(rawUrl);
  const normalizedUrl = normalizeCalendarUrl(rawUrl);

  if (!isValidCalendarUrlFormat(rawUrl)) {
    throw new Error("Invalid URL format");
  }

  try {
    return await invoke<RustFetchedCalendarFeed>("fetch_calendar_ics_feed", {
      rawUrl: rawUrl.trim(),
    });
  } catch (rustErr) {
    const errMsg = rustErr instanceof Error ? rustErr.message : String(rustErr);
    // If the error came from the Rust HTTP fetcher itself, rethrow it directly
    if (
      errMsg.includes("Fetch Error") ||
      errMsg.includes("Invalid") ||
      errMsg.includes("HTTP")
    ) {
      throw new Error(errMsg);
    }

    // Fallback to Tauri HTTP plugin
    const response = await tauriFetch(normalizedUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Local-Planner-Desktop/1.0",
        Accept: "text/calendar, text/plain, */*",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Fetch Error (HTTP ${response.status} ${response.statusText})`
      );
    }

    const icsText = await response.text();
    if (!icsText.includes("BEGIN:VCALENDAR")) {
      throw new Error("Invalid .ics feed (missing BEGIN:VCALENDAR)");
    }

    return {
      original_url: rawUrl.trim(),
      normalized_url: normalizedUrl,
      provider,
      calendar_name: provider,
      ics_text: icsText,
    };
  }
}

/**
 * Parses a raw `.ics` string and expands all single and recurring (`RRULE`) events
 * within the rolling window `[now - 30 days, now + 90 days]`.
 *
 * Compatible with Google Calendar, Apple iCloud (`VTIMEZONE` / `TZID` / `RRULE`), and Outlook feeds.
 */
export function parseAndExpandIcsEvents(
  icsText: string,
  windowStart: Date,
  windowEnd: Date,
  sourceUrl = "",
  calendarName = "Calendar"
): UpsertGoogleEventInput[] {
  const jcalData = ICAL.parse(icsText);
  const vcalendar = new ICAL.Component(jcalData);

  // Register any custom VTIMEZONE definitions included in the feed (Apple iCloud / Exchange / Google)
  const vtimezones = vcalendar.getAllSubcomponents("vtimezone");
  for (const vtz of vtimezones) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz);
      }
    } catch {
      // Ignore non-standard VTIMEZONE registration errors so events still parse cleanly
    }
  }

  const vevents = vcalendar.getAllSubcomponents("vevent");
  const masterEvents: ICAL.Event[] = [];
  const exceptionEvents: ICAL.Event[] = [];

  for (const veventComp of vevents) {
    try {
      const event = new ICAL.Event(veventComp);
      if (!event.startDate) continue;
      if (event.isRecurrenceException()) {
        exceptionEvents.push(event);
      } else {
        masterEvents.push(event);
      }
    } catch {
      // Skip malformed VEVENT component without aborting the feed
    }
  }

  const masterByUid = new Map<string, ICAL.Event>();
  for (const master of masterEvents) {
    if (master.uid) {
      masterByUid.set(master.uid, master);
    }
  }
  for (const ex of exceptionEvents) {
    try {
      const parent = masterByUid.get(ex.uid);
      if (parent) {
        parent.relateException(ex);
      } else {
        masterEvents.push(ex);
      }
    } catch {
      masterEvents.push(ex);
    }
  }

  const resultsByKey = new Map<string, UpsertGoogleEventInput>();
  const windowStartMs = windowStart.getTime();
  const windowEndMs = windowEnd.getTime();
  const keyPrefix = sourceUrl ? `${sourceUrl}::` : "";

  for (const event of masterEvents) {
    try {
      const status = String(
        event.component.getFirstPropertyValue("status") ?? ""
      ).toUpperCase();
      if (status === "CANCELLED") {
        continue;
      }

      if (!event.isRecurring()) {
        const startJs = event.startDate.toJSDate();
        const endJs = event.endDate ? event.endDate.toJSDate() : startJs;

        if (endJs.getTime() < windowStartMs || startJs.getTime() > windowEndMs) {
          continue;
        }

        const isAllDay = Boolean(event.startDate.isDate);
        const startIso = startJs.toISOString();
        const endIso = endJs.toISOString();
        const eventDate = icalTimeToLocalDateString(event.startDate, startJs);
        const instanceKey = `${keyPrefix}${event.uid}_${startIso}`;

        resultsByKey.set(instanceKey, {
          instance_key: instanceKey,
          uid: event.uid || instanceKey,
          source_url: sourceUrl,
          calendar_name: calendarName,
          title: event.summary || "(No Title)",
          description: event.description || null,
          location: event.location || null,
          start_time: startIso,
          end_time: endIso,
          event_date: eventDate,
          is_all_day: isAllDay,
        });
      } else {
        const iterator = event.iterator();
        let nextTime: ICAL.Time | null = null;
        let safetyCounter = 0;
        const MAX_ITERATIONS = 3000;

        while (
          (nextTime = iterator.next()) &&
          safetyCounter < MAX_ITERATIONS
        ) {
          safetyCounter++;
          const occJs = nextTime.toJSDate();

          if (occJs.getTime() > windowEndMs) {
            break;
          }

          const details = event.getOccurrenceDetails(nextTime);
          const startJs = details.startDate.toJSDate();
          const endJs = details.endDate
            ? details.endDate.toJSDate()
            : startJs;

          if (endJs.getTime() < windowStartMs) {
            continue;
          }

          const itemStatus = String(
            details.item.component.getFirstPropertyValue("status") ?? ""
          ).toUpperCase();
          if (itemStatus === "CANCELLED") {
            continue;
          }

          const isAllDay = Boolean(details.startDate.isDate);
          const startIso = startJs.toISOString();
          const endIso = endJs.toISOString();
          const eventDate = icalTimeToLocalDateString(
            details.startDate,
            startJs
          );
          const instanceKey = `${keyPrefix}${event.uid}_${startIso}`;

          resultsByKey.set(instanceKey, {
            instance_key: instanceKey,
            uid: event.uid || instanceKey,
            source_url: sourceUrl,
            calendar_name: calendarName,
            title: details.item.summary || event.summary || "(No Title)",
            description:
              details.item.description || event.description || null,
            location: details.item.location || event.location || null,
            start_time: startIso,
            end_time: endIso,
            event_date: eventDate,
            is_all_day: isAllDay,
          });
        }
      }
    } catch (eventErr) {
      console.warn("[icsSync] Skipped malformed VEVENT in feed:", eventErr);
    }
  }

  return Array.from(resultsByKey.values());
}

/**
 * Runs a full read-only sync across all configured calendar `.ics` URLs
 * (Google Calendar, Apple iCloud `webcal://`, Outlook, etc.) and upserts occurrences
 * into the local `calendar_events` SQLite table while tracking per-link sync status.
 */
export async function syncGoogleCalendarIcs(
  explicitRawUrls?: string[]
): Promise<SyncStatus> {
  if (!explicitRawUrls && inFlightCalendarSync) {
    return inFlightCalendarSync;
  }

  const runPromise = runCalendarSyncInternal(explicitRawUrls);
  if (!explicitRawUrls) {
    inFlightCalendarSync = runPromise;
  }
  try {
    return await runPromise;
  } finally {
    if (!explicitRawUrls && inFlightCalendarSync === runPromise) {
      inFlightCalendarSync = null;
    }
  }
}

async function runCalendarSyncInternal(
  explicitRawUrls?: string[]
): Promise<SyncStatus> {
  const rawEntries = explicitRawUrls ?? (await getConfiguredIcalUrls());
  const nonEmptyUrls = rawEntries
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  if (nonEmptyUrls.length === 0) {
    await upsertGoogleEventsBatch(
      [],
      toLocalDateString(subDays(new Date(), DAYS_BACK)),
      toLocalDateString(addDays(new Date(), DAYS_FORWARD)),
      [],
      []
    );
    broadcastFeedResults({});
    return {
      isSyncing: false,
      lastSyncedAt: null,
      lastError: null,
      upsertedCount: 0,
      hasConfiguredUrl: false,
      feedResults: {},
    };
  }

  const now = new Date();
  const windowStart = subDays(now, DAYS_BACK);
  const windowEnd = addDays(now, DAYS_FORWARD);

  const combinedByKey = new Map<string, UpsertGoogleEventInput>();
  const feedResults: Record<string, CalendarFeedSyncResult> = {};
  const succeededSourceUrls: string[] = [];
  const activeSourceUrls: string[] = [];
  const errors: string[] = [];

  for (const rawUrl of nonEmptyUrls) {
    const provider = detectCalendarProvider(rawUrl);
    const normalizedSourceUrl = normalizeCalendarUrl(rawUrl);
    activeSourceUrls.push(normalizedSourceUrl);

    try {
      const fetched = await fetchCalendarFeed(rawUrl);
      const expandedEvents = parseAndExpandIcsEvents(
        fetched.ics_text,
        windowStart,
        windowEnd,
        fetched.normalized_url,
        fetched.calendar_name || provider
      );

      for (const ev of expandedEvents) {
        combinedByKey.set(ev.instance_key, ev);
      }

      succeededSourceUrls.push(fetched.normalized_url);
      feedResults[rawUrl] = {
        url: rawUrl,
        provider,
        calendarName: fetched.calendar_name || provider,
        ok: true,
        eventCount: expandedEvents.length,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider}: ${message}`);
      feedResults[rawUrl] = {
        url: rawUrl,
        provider,
        calendarName: provider,
        ok: false,
        eventCount: 0,
        error: message,
      };
    }
  }

  const allEvents = Array.from(combinedByKey.values());
  const upsertedCount = await upsertGoogleEventsBatch(
    allEvents,
    toLocalDateString(windowStart),
    toLocalDateString(windowEnd),
    succeededSourceUrls,
    activeSourceUrls
  );

  broadcastFeedResults(feedResults);

  return {
    isSyncing: false,
    lastSyncedAt: new Date().toISOString(),
    lastError: errors.length > 0 ? errors.join(" | ") : null,
    upsertedCount,
    hasConfiguredUrl: true,
    feedResults,
  };
}

/**
 * Starts the background 30-minute `.ics` sync loop (runs immediately on launch + every 30m).
 */
export function startBackgroundIcsSync(
  onStatusChange?: (status: SyncStatus) => void
): () => void {
  let isDisposed = false;

  const triggerSync = async () => {
    if (isDisposed) return;
    onStatusChange?.({
      isSyncing: true,
      lastSyncedAt: null,
      lastError: null,
      upsertedCount: 0,
      hasConfiguredUrl: true,
      feedResults: latestFeedResults,
    });

    const result = await syncGoogleCalendarIcs();
    if (!isDisposed) {
      onStatusChange?.(result);
    }
  };

  void triggerSync();

  const intervalId = window.setInterval(() => {
    void triggerSync();
  }, THIRTY_MINUTES_MS);

  return () => {
    isDisposed = true;
    window.clearInterval(intervalId);
  };
}
