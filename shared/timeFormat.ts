import { format, parseISO } from "date-fns";
import {
  applyRemoteCalendarTools,
  getSavedCalendarTools,
  getSavedCalendarToolsUpdatedAt,
} from "./calendarTools";

export type TimeFormat = "24h" | "12h";

export interface SyncedPreferences {
  time_format?: TimeFormat;
  updated_at?: string;
  calendar_tools?: string[];
  calendar_tools_updated_at?: string;
}

const TIME_FORMAT_KEY = "hobo_time_format_v1";
const TIME_FORMAT_UPDATED_AT_KEY = "hobo_time_format_updated_at_v1";
const TIME_FORMAT_EVENT = "hobo-time-format-changed";

export function normalizeTimeFormat(val: unknown): TimeFormat {
  return val === "12h" ? "12h" : "24h";
}

export function getSavedTimeFormat(): TimeFormat {
  try {
    return normalizeTimeFormat(localStorage.getItem(TIME_FORMAT_KEY));
  } catch {
    return "24h";
  }
}

export function getSavedTimeFormatUpdatedAt(): string {
  try {
    return (
      localStorage.getItem(TIME_FORMAT_UPDATED_AT_KEY) ||
      "1970-01-01T00:00:00.000Z"
    );
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export function saveTimeFormat(
  nextFormat: TimeFormat,
  updatedAt: string = new Date().toISOString()
): void {
  const normalized = normalizeTimeFormat(nextFormat);
  try {
    localStorage.setItem(TIME_FORMAT_KEY, normalized);
    localStorage.setItem(TIME_FORMAT_UPDATED_AT_KEY, updatedAt);
  } catch {
    // Ignore storage errors
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(TIME_FORMAT_EVENT, { detail: normalized })
    );
  }
}

export function getSyncedPreferencesForBackup(): SyncedPreferences {
  return {
    time_format: getSavedTimeFormat(),
    updated_at: getSavedTimeFormatUpdatedAt(),
    calendar_tools: getSavedCalendarTools(),
    calendar_tools_updated_at: getSavedCalendarToolsUpdatedAt(),
  };
}

export function applyRemotePreferences(
  remote?: SyncedPreferences | null
): boolean {
  if (!remote) return false;
  let changed = false;
  if (remote.time_format === "12h" || remote.time_format === "24h") {
    const remoteTs = remote.updated_at || "1970-01-01T00:00:00.000Z";
    const localTs = getSavedTimeFormatUpdatedAt();
    if (remoteTs > localTs) {
      saveTimeFormat(remote.time_format, remoteTs);
      changed = true;
    }
  }
  if (
    applyRemoteCalendarTools(
      remote.calendar_tools,
      remote.calendar_tools_updated_at
    )
  ) {
    changed = true;
  }
  return changed;
}

export function subscribeTimeFormat(
  callback: (fmt: TimeFormat) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const custom = e as CustomEvent<TimeFormat>;
    callback(normalizeTimeFormat(custom.detail ?? getSavedTimeFormat()));
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === TIME_FORMAT_KEY) {
      callback(getSavedTimeFormat());
    }
  };
  window.addEventListener(TIME_FORMAT_EVENT, onEvent);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TIME_FORMAT_EVENT, onEvent);
    window.removeEventListener("storage", onStorage);
  };
}

export function formatHHmm(hhmm: string, timeFormat: TimeFormat): string {
  if (timeFormat === "24h") return hhmm;
  const [hRaw, mRaw] = hhmm.split(":").map(Number);
  if (Number.isNaN(hRaw) || Number.isNaN(mRaw)) return hhmm;
  const period = hRaw >= 12 ? "PM" : "AM";
  const hour12 = hRaw % 12 === 0 ? 12 : hRaw % 12;
  return `${hour12}:${String(mRaw).padStart(2, "0")} ${period}`;
}

export function formatEventTimeRange(
  ev: {
    is_all_day: boolean;
    start_time: string;
    end_time: string;
    local_start_hhmm?: string | null;
    local_end_hhmm?: string | null;
  },
  timeFormat: TimeFormat
): string {
  if (ev.is_all_day) return "All Day";
  if (ev.local_start_hhmm && ev.local_end_hhmm) {
    return `${formatHHmm(ev.local_start_hhmm, timeFormat)} – ${formatHHmm(
      ev.local_end_hhmm,
      timeFormat
    )}`;
  }
  try {
    const start = parseISO(ev.start_time);
    const end = parseISO(ev.end_time);
    const fmtStr = timeFormat === "12h" ? "h:mm a" : "HH:mm";
    return `${format(start, fmtStr)} – ${format(end, fmtStr)}`;
  } catch {
    return "";
  }
}
