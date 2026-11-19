import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  AppSettings,
  CreateLocalEventInput,
  CreateLocalTaskInput,
  GoogleEvent,
  LocalEvent,
  LocalTask,
  NotePage,
  RepeatType,
  RepeatUnit,
  UpdateLocalEventInput,
  UpdateLocalTaskInput,
} from "../types/planner";
import { DEFAULT_ACCENT_COLOR, normalizeHexColor } from "../utils/accentColor";
import { generateUuid } from "../utils/id";
import {
  deleteFromStore,
  getAllFromStore,
  getByKeyFromStore,
  notifyDatabaseUpdated,
  putInStore,
  replaceStoreContents,
} from "./indexedDb";

const DEFAULT_SETTINGS: AppSettings = {
  storage_mode: "local",
  github_token: "",
  github_owner: "",
  github_repo: "",
  github_file_path: "planner-data.json",
  accent_color: DEFAULT_ACCENT_COLOR,
};

interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const rec = await getByKeyFromStore<MetaRecord<T>>("meta", key);
  return rec?.value;
}

export async function setMetaValue<T>(key: string, value: T): Promise<void> {
  await putInStore("meta", { key, value });
}

export async function getAppSettings(): Promise<AppSettings> {
  const saved = await getMetaValue<Partial<AppSettings>>("app_settings");
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    github_file_path:
      (saved?.github_file_path || "planner-data.json")
        .trim()
        .replace(/^\/+/, "") || "planner-data.json",
    accent_color: normalizeHexColor(saved?.accent_color),
  };
}

export async function saveAppSettings(
  updates: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = {
    ...current,
    ...updates,
    github_file_path:
      (updates.github_file_path ?? current.github_file_path)
        .trim()
        .replace(/^\/+/, "") || "planner-data.json",
    accent_color: normalizeHexColor(
      updates.accent_color ?? current.accent_color
    ),
  };
  await setMetaValue("app_settings", next);
  notifyDatabaseUpdated("app_settings:update");
  return next;
}

function isRecordActive(item: {
  updated_at: string;
  deleted_at?: string | null;
}): boolean {
  return !item.deleted_at || item.updated_at > item.deleted_at;
}

function getEffectiveTimestamp(item: {
  updated_at?: string | null;
  deleted_at?: string | null;
}): string {
  const upd = item.updated_at || "";
  const del = item.deleted_at || "";
  return del > upd ? del : upd;
}

function resolveSoftDeleteWinner<
  T extends { updated_at: string; deleted_at?: string | null }
>(item: T): T {
  if (item.deleted_at && item.updated_at > item.deleted_at) {
    return { ...item, deleted_at: null };
  }
  return item;
}

function getMondayWeekStart(dateStr: string): string {
  const d = parseISO(dateStr);
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function nextNumericId(): number {
  return Date.now() * 100 + Math.floor(Math.random() * 100);
}

// ==========================================
// Local Tasks
// ==========================================

export async function getAllLocalTasks(): Promise<LocalTask[]> {
  const tasks = await getAllFromStore<LocalTask>("tasks");
  return tasks.map((t) => ({
    ...t,
    sync_id: t.sync_id || String(t.id),
    deleted_at: t.deleted_at ?? null,
  }));
}

export async function getTasksForWeekRange(
  startDate: string,
  endDate: string
): Promise<LocalTask[]> {
  const all = await getAllLocalTasks();
  return all
    .filter(
      (t) =>
        isRecordActive(t) &&
        t.show_in_weekly &&
        t.assigned_date !== null &&
        t.assigned_date >= startDate &&
        t.assigned_date <= endDate
    )
    .sort((a, b) => {
      if ((a.assigned_date || "") !== (b.assigned_date || "")) {
        return (a.assigned_date || "").localeCompare(b.assigned_date || "");
      }
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
}

export async function getWeeklySidebarTasks(
  weekStart: string
): Promise<LocalTask[]> {
  const all = await getAllLocalTasks();
  return all
    .filter(
      (t) =>
        isRecordActive(t) &&
        t.show_in_sidebar &&
        !t.is_long_term &&
        t.assigned_week_start === weekStart
    )
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
}

export async function getLongTermSidebarTasks(): Promise<LocalTask[]> {
  const all = await getAllLocalTasks();
  return all
    .filter((t) => isRecordActive(t) && t.show_in_sidebar && t.is_long_term)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
}

export async function createLocalTask(
  input: CreateLocalTaskInput
): Promise<LocalTask> {
  const nowIso = new Date().toISOString();
  const assignedDate = input.assigned_date ?? null;
  const assignedWeekStart =
    input.assigned_week_start !== undefined
      ? input.assigned_week_start
      : assignedDate
      ? getMondayWeekStart(assignedDate)
      : null;

  const all = await getAllLocalTasks();
  const maxOrder = all.reduce((max, t) => Math.max(max, t.sort_order || 0), 0);

  const task: LocalTask = {
    id: nextNumericId(),
    sync_id: generateUuid(),
    title: input.title.trim(),
    notes: input.notes ?? null,
    assigned_date: assignedDate,
    assigned_week_start: assignedWeekStart,
    is_long_term: Boolean(input.is_long_term),
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    is_completed: false,
    show_in_weekly: input.show_in_weekly,
    show_in_sidebar: input.show_in_sidebar,
    sort_order: maxOrder + 1,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
  };

  await putInStore("tasks", task);
  notifyDatabaseUpdated("local_tasks:create");
  return task;
}

export async function updateLocalTask(
  syncId: string,
  updates: UpdateLocalTaskInput
): Promise<void> {
  const existing = await getByKeyFromStore<LocalTask>("tasks", syncId);
  if (!existing) return;

  const nowIso = new Date().toISOString();
  const nextTask: LocalTask = {
    ...existing,
    ...updates,
    title: updates.title !== undefined ? updates.title.trim() : existing.title,
    updated_at: nowIso,
    deleted_at: null,
  };

  await putInStore("tasks", nextTask);
  notifyDatabaseUpdated("local_tasks:update");
}

export async function deleteLocalTask(syncId: string): Promise<void> {
  const existing = await getByKeyFromStore<LocalTask>("tasks", syncId);
  if (!existing) return;

  const nowIso = new Date().toISOString();
  await putInStore("tasks", {
    ...existing,
    deleted_at: nowIso,
    updated_at: nowIso,
  });
  notifyDatabaseUpdated("local_tasks:delete");
}

export async function clearCompletedWeeklySidebarTasks(
  weekStart: string
): Promise<void> {
  const all = await getAllLocalTasks();
  const nowIso = new Date().toISOString();
  for (const t of all) {
    if (
      isRecordActive(t) &&
      t.show_in_sidebar &&
      !t.is_long_term &&
      t.assigned_week_start === weekStart &&
      t.is_completed
    ) {
      await putInStore("tasks", {
        ...t,
        deleted_at: nowIso,
        updated_at: nowIso,
      });
    }
  }
  notifyDatabaseUpdated("local_tasks:clear_completed");
}

export async function clearCompletedLongTermSidebarTasks(): Promise<void> {
  const all = await getAllLocalTasks();
  const nowIso = new Date().toISOString();
  for (const t of all) {
    if (
      isRecordActive(t) &&
      t.show_in_sidebar &&
      t.is_long_term &&
      t.is_completed
    ) {
      await putInStore("tasks", {
        ...t,
        deleted_at: nowIso,
        updated_at: nowIso,
      });
    }
  }
  notifyDatabaseUpdated("local_tasks:clear_completed");
}

// ==========================================
// Local Events + Repeating Expansion
// ==========================================

function deterministicNegativeId(key: string): number {
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

function computeOccurrenceDate(
  startObj: Date,
  stepIndex: number,
  repeatType: RepeatType | null,
  interval: number,
  repeatUnit: RepeatUnit | null
): Date {
  if (stepIndex === 0) return startObj;
  if (repeatType === "monthly") return addMonths(startObj, stepIndex);
  if (repeatType === "annual") return addYears(startObj, stepIndex);
  if (repeatUnit === "weeks") return addWeeks(startObj, stepIndex * interval);
  if (repeatUnit === "months") return addMonths(startObj, stepIndex * interval);
  return addDays(startObj, stepIndex * interval);
}

function toCalendarEventOccurrence(
  ev: LocalEvent,
  occurrenceDate: string
): GoogleEvent {
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

export async function getAllLocalEventsForBackup(): Promise<LocalEvent[]> {
  const all = await getAllFromStore<LocalEvent>("local_events");
  return all.map((ev) => ({
    ...ev,
    excluded_dates: Array.isArray(ev.excluded_dates) ? ev.excluded_dates : [],
    hidden_dates: Array.isArray(ev.hidden_dates) ? ev.hidden_dates : [],
    deleted_at: ev.deleted_at ?? null,
  }));
}

export async function getExpandedLocalEventsInRange(
  rangeStart: string,
  rangeEnd: string
): Promise<GoogleEvent[]> {
  const all = await getAllLocalEventsForBackup();
  const occurrences: GoogleEvent[] = [];

  for (const ev of all) {
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

export async function createLocalEvent(
  input: CreateLocalEventInput
): Promise<LocalEvent> {
  const now = new Date().toISOString();
  const ev: LocalEvent = {
    id: generateUuid(),
    title: input.title.trim(),
    location: input.location?.trim() || null,
    event_date: input.event_date,
    start_time: input.is_all_day ? null : input.start_time ?? "09:00",
    end_time: input.is_all_day ? null : input.end_time ?? "10:00",
    is_all_day: input.is_all_day,
    is_repeating: input.is_repeating,
    repeat_type: input.is_repeating ? input.repeat_type ?? "monthly" : null,
    repeat_interval: Math.max(1, input.repeat_interval ?? 1),
    repeat_unit:
      input.is_repeating && input.repeat_type === "custom"
        ? input.repeat_unit ?? "weeks"
        : null,
    repeat_end_date: null,
    excluded_dates: [],
    hidden_dates: [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await putInStore("local_events", ev);
  notifyDatabaseUpdated("local_events:create");
  return ev;
}

export async function updateLocalEventSingle(
  id: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const current = await getByKeyFromStore<LocalEvent>("local_events", id);
  if (!current) return;

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

  await putInStore("local_events", {
    ...current,
    title: updates.title !== undefined ? updates.title.trim() : current.title,
    location:
      updates.location !== undefined
        ? updates.location?.trim() || null
        : current.location,
    start_time: nextIsAllDay
      ? null
      : updates.start_time !== undefined
      ? updates.start_time
      : current.start_time,
    end_time: nextIsAllDay
      ? null
      : updates.end_time !== undefined
      ? updates.end_time
      : current.end_time,
    is_all_day: nextIsAllDay,
    is_repeating: nextIsRepeating,
    repeat_type: nextRepeatType,
    repeat_interval: Math.max(
      1,
      updates.repeat_interval ?? current.repeat_interval
    ),
    repeat_unit: nextRepeatUnit,
    updated_at: now,
    deleted_at: null,
  });

  notifyDatabaseUpdated("local_events:update");
}

export async function saveLocalEventThisOnly(
  seriesId: string,
  occurrenceDate: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const series = await getByKeyFromStore<LocalEvent>("local_events", seriesId);
  if (!series) return;

  const now = new Date().toISOString();
  await putInStore("local_events", {
    ...series,
    excluded_dates: Array.from(
      new Set([...series.excluded_dates, occurrenceDate])
    ),
    updated_at: now,
    deleted_at: null,
  });

  const nextIsAllDay =
    updates.is_all_day !== undefined ? updates.is_all_day : series.is_all_day;
  await putInStore("local_events", {
    id: generateUuid(),
    title: updates.title !== undefined ? updates.title.trim() : series.title,
    location:
      updates.location !== undefined
        ? updates.location?.trim() || null
        : series.location,
    event_date: occurrenceDate,
    start_time: nextIsAllDay
      ? null
      : updates.start_time ?? series.start_time ?? "09:00",
    end_time: nextIsAllDay
      ? null
      : updates.end_time ?? series.end_time ?? "10:00",
    is_all_day: nextIsAllDay,
    is_repeating: false,
    repeat_type: null,
    repeat_interval: 1,
    repeat_unit: null,
    repeat_end_date: null,
    excluded_dates: [],
    hidden_dates: [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  notifyDatabaseUpdated("local_events:save_this_only");
}

export async function saveLocalEventAllFuture(
  seriesId: string,
  occurrenceDate: string,
  updates: UpdateLocalEventInput
): Promise<void> {
  const series = await getByKeyFromStore<LocalEvent>("local_events", seriesId);
  if (!series) return;
  if (occurrenceDate <= series.event_date) {
    await updateLocalEventSingle(seriesId, updates);
    return;
  }

  const now = new Date().toISOString();
  const prevDayStr = format(subDays(parseISO(occurrenceDate), 1), "yyyy-MM-dd");
  await putInStore("local_events", {
    ...series,
    repeat_end_date: prevDayStr,
    excluded_dates: series.excluded_dates.filter((d) => d < occurrenceDate),
    updated_at: now,
    deleted_at: null,
  });

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

  await putInStore("local_events", {
    id: generateUuid(),
    title: updates.title !== undefined ? updates.title.trim() : series.title,
    location:
      updates.location !== undefined
        ? updates.location?.trim() || null
        : series.location,
    event_date: occurrenceDate,
    start_time: nextIsAllDay
      ? null
      : updates.start_time ?? series.start_time ?? "09:00",
    end_time: nextIsAllDay
      ? null
      : updates.end_time ?? series.end_time ?? "10:00",
    is_all_day: nextIsAllDay,
    is_repeating: nextIsRepeating,
    repeat_type: nextRepeatType,
    repeat_interval: Math.max(
      1,
      updates.repeat_interval ?? series.repeat_interval
    ),
    repeat_unit: nextRepeatUnit,
    repeat_end_date: series.repeat_end_date,
    excluded_dates: [],
    hidden_dates: [],
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });

  notifyDatabaseUpdated("local_events:save_all_future");
}

export async function deleteLocalEventAll(id: string): Promise<void> {
  const current = await getByKeyFromStore<LocalEvent>("local_events", id);
  if (!current) return;

  const now = new Date().toISOString();
  await putInStore("local_events", {
    ...current,
    deleted_at: now,
    updated_at: now,
  });
  notifyDatabaseUpdated("local_events:delete");
}

export async function deleteLocalEventThisOnly(
  seriesId: string,
  occurrenceDate: string
): Promise<void> {
  const series = await getByKeyFromStore<LocalEvent>("local_events", seriesId);
  if (!series) return;
  if (!series.is_repeating) {
    await deleteLocalEventAll(seriesId);
    return;
  }

  await putInStore("local_events", {
    ...series,
    excluded_dates: Array.from(
      new Set([...series.excluded_dates, occurrenceDate])
    ),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  });
  notifyDatabaseUpdated("local_events:delete_this_only");
}

export async function deleteLocalEventAllFuture(
  seriesId: string,
  occurrenceDate: string
): Promise<void> {
  const series = await getByKeyFromStore<LocalEvent>("local_events", seriesId);
  if (!series) return;
  if (!series.is_repeating || occurrenceDate <= series.event_date) {
    await deleteLocalEventAll(seriesId);
    return;
  }

  const prevDayStr = format(subDays(parseISO(occurrenceDate), 1), "yyyy-MM-dd");
  await putInStore("local_events", {
    ...series,
    repeat_end_date: prevDayStr,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  });
  notifyDatabaseUpdated("local_events:delete_all_future");
}

// ==========================================
// Cached .ics Calendar Events (Read-Only)
// ==========================================

export async function getCachedCalendarEventsInRange(
  startDate: string,
  endDate: string
): Promise<GoogleEvent[]> {
  const all = await getAllFromStore<GoogleEvent>("calendar_events");
  return all
    .filter((ev) => ev.event_date >= startDate && ev.event_date <= endDate)
    .sort((a, b) => {
      if (a.event_date !== b.event_date) {
        return a.event_date.localeCompare(b.event_date);
      }
      if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1;
      return a.start_time.localeCompare(b.start_time);
    });
}

export async function replaceCachedCalendarEvents(
  events: GoogleEvent[]
): Promise<void> {
  await replaceStoreContents("calendar_events", events);
  notifyDatabaseUpdated("calendar_events:sync");
}

// ==========================================
// Note Pages
// ==========================================

export async function getAllNotePagesForBackup(): Promise<NotePage[]> {
  const all = await getAllFromStore<NotePage>("note_pages");
  return all
    .map((p) => ({ ...p, deleted_at: p.deleted_at ?? null }))
    .sort((a, b) => a.page_order - b.page_order);
}

export async function getAllNotePages(): Promise<NotePage[]> {
  const all = await getAllNotePagesForBackup();
  const active = all.filter(isRecordActive);
  if (active.length > 0) return active;

  const now = new Date().toISOString();
  const seeded: NotePage[] = [];
  for (let i = 1; i <= 3; i++) {
    const page: NotePage = {
      id: generateUuid(),
      page_order: i,
      content: "",
      updated_at: now,
      deleted_at: null,
    };
    await putInStore("note_pages", page);
    seeded.push(page);
  }
  return seeded;
}

export async function updateNotePageContent(
  id: string,
  content: string
): Promise<void> {
  const existing = await getByKeyFromStore<NotePage>("note_pages", id);
  if (!existing) return;

  await putInStore("note_pages", {
    ...existing,
    content,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  });
  notifyDatabaseUpdated("note_pages:update");
}

export async function insertNotePageAfter(
  afterPageId: string
): Promise<NotePage> {
  const pages = await getAllNotePages();
  const idx = pages.findIndex((p) => p.id === afterPageId);
  const insertOrder = idx >= 0 ? pages[idx].page_order + 1 : pages.length + 1;
  const now = new Date().toISOString();

  for (const p of pages) {
    if (p.page_order >= insertOrder) {
      await putInStore("note_pages", {
        ...p,
        page_order: p.page_order + 1,
        updated_at: now,
      });
    }
  }

  const newPage: NotePage = {
    id: generateUuid(),
    page_order: insertOrder,
    content: "",
    updated_at: now,
    deleted_at: null,
  };
  await putInStore("note_pages", newPage);
  notifyDatabaseUpdated("note_pages:insert");
  return newPage;
}

export async function deleteNotePage(id: string): Promise<void> {
  const pages = await getAllNotePages();
  if (pages.length <= 1) return;

  const target = pages.find((p) => p.id === id);
  if (!target) return;

  const now = new Date().toISOString();
  await putInStore("note_pages", {
    ...target,
    deleted_at: now,
    updated_at: now,
  });

  const remaining = pages.filter((p) => p.id !== id);
  for (let i = 0; i < remaining.length; i++) {
    const desiredOrder = i + 1;
    if (remaining[i].page_order !== desiredOrder) {
      await putInStore("note_pages", {
        ...remaining[i],
        page_order: desiredOrder,
        updated_at: now,
      });
    }
  }
  notifyDatabaseUpdated("note_pages:delete");
}

// ==========================================
// Sync Merge & Tombstone Purge
// ==========================================

export async function purgeExpiredSoftDeletedRecords(
  daysOld = 30
): Promise<number> {
  const cutoffIso = subDays(new Date(), daysOld).toISOString();
  let purged = 0;

  for (const t of await getAllLocalTasks()) {
    if (t.deleted_at && t.deleted_at < cutoffIso && t.updated_at <= t.deleted_at) {
      await deleteFromStore("tasks", t.sync_id);
      purged++;
    }
  }
  for (const ev of await getAllLocalEventsForBackup()) {
    if (ev.deleted_at && ev.deleted_at < cutoffIso && ev.updated_at <= ev.deleted_at) {
      await deleteFromStore("local_events", ev.id);
      purged++;
    }
  }
  for (const np of await getAllNotePagesForBackup()) {
    if (np.deleted_at && np.deleted_at < cutoffIso && np.updated_at <= np.deleted_at) {
      await deleteFromStore("note_pages", np.id);
      purged++;
    }
  }

  if (purged > 0) notifyDatabaseUpdated("sync:purge_expired");
  return purged;
}

export async function purgeAllSoftDeletedRecordsNow(): Promise<{
  purgedTasks: number;
}> {
  let purgedTasks = 0;
  for (const t of await getAllLocalTasks()) {
    if (t.deleted_at && t.updated_at <= t.deleted_at) {
      await deleteFromStore("tasks", t.sync_id);
      purgedTasks++;
    }
  }
  for (const ev of await getAllLocalEventsForBackup()) {
    if (ev.deleted_at && ev.updated_at <= ev.deleted_at) {
      await deleteFromStore("local_events", ev.id);
    }
  }
  for (const np of await getAllNotePagesForBackup()) {
    if (np.deleted_at && np.updated_at <= np.deleted_at) {
      await deleteFromStore("note_pages", np.id);
    }
  }
  notifyDatabaseUpdated("sync:purge_all_deleted");
  return { purgedTasks };
}

export async function upsertRemoteBackupIntoLocal(
  remoteTasks: LocalTask[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = []
): Promise<number> {
  let upserted = 0;

  const localTasks = await getAllLocalTasks();
  const localTaskMap = new Map<string, LocalTask>();
  for (const lt of localTasks) localTaskMap.set(lt.sync_id, lt);

  for (const rawRt of remoteTasks) {
    const syncId = rawRt.sync_id?.trim() || String(rawRt.id);
    const rt = resolveSoftDeleteWinner({
      ...rawRt,
      sync_id: syncId,
      updated_at:
        rawRt.updated_at || rawRt.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawRt.deleted_at ?? null,
    });
    const existing = localTaskMap.get(syncId);
    if (!existing) {
      await putInStore("tasks", rt);
      upserted++;
    } else if (getEffectiveTimestamp(rt) > getEffectiveTimestamp(existing)) {
      const newestUpdated =
        rt.updated_at > existing.updated_at ? rt.updated_at : existing.updated_at;
      const candDeleted =
        (rt.deleted_at || "") > (existing.deleted_at || "")
          ? rt.deleted_at
          : existing.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;
      await putInStore("tasks", {
        ...rt,
        updated_at: newestUpdated,
        deleted_at: winningDeleted,
      });
      upserted++;
    }
  }

  const localEvents = await getAllLocalEventsForBackup();
  const localEventMap = new Map<string, LocalEvent>();
  for (const ev of localEvents) localEventMap.set(ev.id, ev);

  for (const rawEv of remoteLocalEvents) {
    if (!rawEv.id) continue;
    const ev = resolveSoftDeleteWinner({
      ...rawEv,
      created_at:
        rawEv.created_at || rawEv.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at:
        rawEv.updated_at || rawEv.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawEv.deleted_at ?? null,
    });
    const existing = localEventMap.get(ev.id);
    if (!existing) {
      await putInStore("local_events", ev);
      upserted++;
    } else if (getEffectiveTimestamp(ev) > getEffectiveTimestamp(existing)) {
      const newestUpdated =
        ev.updated_at > existing.updated_at ? ev.updated_at : existing.updated_at;
      const candDeleted =
        (ev.deleted_at || "") > (existing.deleted_at || "")
          ? ev.deleted_at
          : existing.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;
      await putInStore("local_events", {
        ...ev,
        updated_at: newestUpdated,
        deleted_at: winningDeleted,
      });
      upserted++;
    }
  }

  const localNotes = await getAllNotePagesForBackup();
  const localNoteMap = new Map<string, NotePage>();
  for (const np of localNotes) localNoteMap.set(np.id, np);

  for (const rawNp of remoteNotePages) {
    if (!rawNp.id) continue;
    const np = resolveSoftDeleteWinner({
      ...rawNp,
      updated_at: rawNp.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawNp.deleted_at ?? null,
    });
    const existing = localNoteMap.get(np.id);
    if (!existing) {
      await putInStore("note_pages", np);
      upserted++;
    } else if (getEffectiveTimestamp(np) > getEffectiveTimestamp(existing)) {
      const newestUpdated =
        np.updated_at > existing.updated_at ? np.updated_at : existing.updated_at;
      const candDeleted =
        (np.deleted_at || "") > (existing.deleted_at || "")
          ? np.deleted_at
          : existing.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;
      await putInStore("note_pages", {
        ...np,
        updated_at: newestUpdated,
        deleted_at: winningDeleted,
      });
      upserted++;
    }
  }

  if (upserted > 0) notifyDatabaseUpdated("github_sync:pull_upsert");
  return upserted;
}

export async function replaceAllLocalDataWithRemote(
  remoteTasks: LocalTask[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = []
): Promise<void> {
  await replaceStoreContents(
    "tasks",
    remoteTasks.map((t) =>
      resolveSoftDeleteWinner({
        ...t,
        sync_id: t.sync_id?.trim() || String(t.id),
        deleted_at: t.deleted_at ?? null,
      })
    )
  );
  await replaceStoreContents(
    "local_events",
    remoteLocalEvents
      .filter((e) => Boolean(e.id))
      .map((e) =>
        resolveSoftDeleteWinner({ ...e, deleted_at: e.deleted_at ?? null })
      )
  );
  await replaceStoreContents(
    "note_pages",
    remoteNotePages
      .filter((n) => Boolean(n.id))
      .map((n) =>
        resolveSoftDeleteWinner({ ...n, deleted_at: n.deleted_at ?? null })
      )
  );
  notifyDatabaseUpdated("github_sync:replace_all");
}
