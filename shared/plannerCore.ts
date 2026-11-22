import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  parseISO,
} from "date-fns";

export type SharedRepeatType = "monthly" | "annual" | "custom";
export type SharedRepeatUnit = "days" | "weeks" | "months";

export interface SharedLocalEvent {
  id: string;
  title: string;
  location: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  is_repeating: boolean;
  repeat_type: SharedRepeatType | null;
  repeat_interval: number;
  repeat_unit: SharedRepeatUnit | null;
  repeat_end_date: string | null;
  excluded_dates: string[];
  hidden_dates: string[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface SharedExpandedEventOccurrence {
  id: number;
  instance_key: string;
  uid: string;
  source_url: string;
  calendar_name: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  event_date: string;
  is_all_day: boolean;
  is_hidden: boolean;
  last_synced: string;
  is_local?: boolean;
  local_event_id?: string;
  is_repeating?: boolean;
  repeat_type?: SharedRepeatType | null;
  repeat_interval?: number;
  repeat_unit?: SharedRepeatUnit | null;
  local_start_hhmm?: string | null;
  local_end_hhmm?: string | null;
}

export function isRecordActive(item: {
  updated_at: string;
  deleted_at?: string | null;
}): boolean {
  return !item.deleted_at || item.updated_at > item.deleted_at;
}

export function getEffectiveTimestamp(item: {
  updated_at?: string | null;
  deleted_at?: string | null;
  created_at?: string | null;
}): string {
  const upd = item.updated_at || item.created_at || "1970-01-01T00:00:00.000Z";
  const del = item.deleted_at || "";
  return del > upd ? del : upd;
}

export function resolveSoftDeleteWinner<
  T extends { updated_at: string; deleted_at?: string | null }
>(item: T): T {
  if (item.deleted_at && item.updated_at > item.deleted_at) {
    return { ...item, deleted_at: null };
  }
  return item;
}

export function deterministicNegativeId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return -(Math.abs(hash) || 1);
}

function buildOccurrenceIso(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0).toISOString();
}

export function computeOccurrenceDate(
  startObj: Date,
  stepIndex: number,
  repeatType: SharedRepeatType | null,
  interval: number,
  repeatUnit: SharedRepeatUnit | null
): Date {
  if (stepIndex === 0) return startObj;
  if (repeatType === "monthly") return addMonths(startObj, stepIndex);
  if (repeatType === "annual") return addYears(startObj, stepIndex);
  if (repeatUnit === "weeks") return addWeeks(startObj, stepIndex * interval);
  if (repeatUnit === "months") return addMonths(startObj, stepIndex * interval);
  return addDays(startObj, stepIndex * interval);
}

export function toCalendarEventOccurrence(
  ev: SharedLocalEvent,
  occurrenceDate: string
): SharedExpandedEventOccurrence {
  const instanceKey = `local::${ev.id}::${occurrenceDate}`;
  const startIso = ev.is_all_day
    ? `${occurrenceDate}T00:00:00`
    : buildOccurrenceIso(occurrenceDate, ev.start_time || "09:00");
  const endIso = ev.is_all_day
    ? `${occurrenceDate}T23:59:59`
    : buildOccurrenceIso(occurrenceDate, ev.end_time || "10:00");

  return {
    id: deterministicNegativeId(instanceKey),
    instance_key: instanceKey,
    uid: ev.id,
    source_url: "local",
    calendar_name: "Local",
    title: ev.title,
    description: null,
    location: ev.location,
    start_time: startIso,
    end_time: endIso,
    event_date: occurrenceDate,
    is_all_day: ev.is_all_day,
    is_hidden: ev.hidden_dates.includes(occurrenceDate),
    last_synced: ev.updated_at,
    is_local: true,
    local_event_id: ev.id,
    is_repeating: ev.is_repeating,
    repeat_type: ev.repeat_type,
    repeat_interval: ev.repeat_interval,
    repeat_unit: ev.repeat_unit,
    local_start_hhmm: ev.start_time,
    local_end_hhmm: ev.end_time,
  };
}

export function expandLocalEventsInRange(
  events: SharedLocalEvent[],
  rangeStart: string,
  rangeEnd: string
): SharedExpandedEventOccurrence[] {
  const occurrences: SharedExpandedEventOccurrence[] = [];

  for (const ev of events) {
    if (!isRecordActive(ev)) continue;
    if (ev.event_date > rangeEnd) continue;
    if (!ev.is_repeating && ev.event_date < rangeStart) continue;
    if (ev.repeat_end_date && ev.repeat_end_date < rangeStart) continue;

    const excludedSet = new Set(ev.excluded_dates);
    if (!ev.is_repeating) {
      if (
        ev.event_date >= rangeStart &&
        ev.event_date <= rangeEnd &&
        !excludedSet.has(ev.event_date)
      ) {
        occurrences.push(toCalendarEventOccurrence(ev, ev.event_date));
      }
      continue;
    }

    const effectiveEnd =
      ev.repeat_end_date && ev.repeat_end_date < rangeEnd
        ? ev.repeat_end_date
        : rangeEnd;
    if (ev.event_date > effectiveEnd) continue;

    const startObj = parseISO(ev.event_date);
    for (let step = 0; step < 5000; step++) {
      const occDate = computeOccurrenceDate(
        startObj,
        step,
        ev.repeat_type,
        Math.max(1, ev.repeat_interval || 1),
        ev.repeat_unit
      );
      const occDateStr = format(occDate, "yyyy-MM-dd");
      if (occDateStr > effectiveEnd) break;
      if (occDateStr >= rangeStart && !excludedSet.has(occDateStr)) {
        occurrences.push(toCalendarEventOccurrence(ev, occDateStr));
      }
    }
  }

  return occurrences;
}
