import {
  format,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  AppSettings,
  BucketDefinition,
  BucketLayoutSnapshot,
  BucketScope,
  BucketTextEntry,
  CreateLocalEventInput,
  CreateLocalTaskInput,
  GoogleEvent,
  LocalEvent,
  LocalTask,
  NotePage,
  UpdateLocalEventInput,
  UpdateLocalTaskInput,
} from "../types/planner";
import {
  getDefaultBucketDefinitions,
  isBucketDefinitionActive,
} from "../../../shared/buckets";
import {
  expandLocalEventsInRange,
  getEffectiveTimestamp,
  isRecordActive,
  resolveSoftDeleteWinner,
} from "../../../shared/plannerCore";
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
    bucket_id:
      t.bucket_id && t.bucket_id.trim() !== ""
        ? t.bucket_id.trim()
        : t.is_long_term
        ? "long_term"
        : "weekly",
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

  const isLongTerm = Boolean(input.is_long_term);
  const bucketId =
    input.bucket_id && input.bucket_id.trim() !== ""
      ? input.bucket_id.trim()
      : isLongTerm
      ? "long_term"
      : "weekly";

  const task: LocalTask = {
    id: nextNumericId(),
    sync_id: generateUuid(),
    title: input.title.trim(),
    notes: input.notes ?? null,
    assigned_date: assignedDate,
    assigned_week_start: assignedWeekStart,
    is_long_term: isLongTerm,
    bucket_id: bucketId,
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

export async function clearCompletedSidebarTasksForBucket(
  bucketId: string,
  scope: BucketScope,
  weekStart: string
): Promise<void> {
  const all = await getAllLocalTasks();
  const nowIso = new Date().toISOString();
  for (const t of all) {
    const tBucket =
      t.bucket_id || (t.is_long_term ? "long_term" : "weekly");
    if (
      isRecordActive(t) &&
      t.show_in_sidebar &&
      t.is_completed &&
      tBucket === bucketId &&
      (scope === "persistent" || t.assigned_week_start === weekStart)
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
// Bucket Definitions & Layouts
// ==========================================

export async function getAllBucketDefinitionsForBackup(): Promise<
  BucketDefinition[]
> {
  const all = await getAllFromStore<BucketDefinition>("bucket_definitions");
  if (all.length === 0) {
    const defaults = getDefaultBucketDefinitions();
    for (const def of defaults) {
      await putInStore("bucket_definitions", def);
    }
    return defaults;
  }
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getActiveBucketDefinitions(): Promise<
  BucketDefinition[]
> {
  const all = await getAllBucketDefinitionsForBackup();
  return all.filter(isBucketDefinitionActive);
}

export async function getAllBucketLayouts(): Promise<BucketLayoutSnapshot[]> {
  const all = await getAllFromStore<BucketLayoutSnapshot>("bucket_layouts");
  return all.sort((a, b) =>
    a.effective_from_week.localeCompare(b.effective_from_week)
  );
}

interface StoredBucketTextEntry extends BucketTextEntry {
  id: string;
}

export async function getAllBucketTextEntriesForBackup(): Promise<
  BucketTextEntry[]
> {
  const all = await getAllFromStore<StoredBucketTextEntry>(
    "bucket_text_entries"
  );
  return all
    .map((r) =>
      resolveSoftDeleteWinner({
        bucket_id: r.bucket_id,
        week_start: r.week_start,
        content: r.content ?? "",
        updated_at: r.updated_at,
        deleted_at: r.deleted_at ?? null,
      })
    )
    .sort((a, b) =>
      `${a.week_start}::${a.bucket_id}`.localeCompare(
        `${b.week_start}::${b.bucket_id}`
      )
    );
}

export async function getBucketTextEntriesForWeek(
  weekStart: string
): Promise<Record<string, string>> {
  const all = await getAllBucketTextEntriesForBackup();
  const map: Record<string, string> = {};
  for (const r of all) {
    if (r.week_start === weekStart && isRecordActive(r)) {
      map[r.bucket_id] = r.content;
    }
  }
  return map;
}

export async function setBucketTextEntry(
  bucketId: string,
  weekStart: string,
  content: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const entry: StoredBucketTextEntry = {
    id: `${bucketId}::${weekStart}`,
    bucket_id: bucketId,
    week_start: weekStart,
    content,
    updated_at: nowIso,
    deleted_at: null,
  };
  await putInStore("bucket_text_entries", entry);
  notifyDatabaseUpdated("bucket_text_entries:update");
}

// ==========================================
// Local Events + Repeating Expansion
// ==========================================

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
  return expandLocalEventsInRange(all, rangeStart, rangeEnd);
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
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = [],
  remoteBucketTextEntries: BucketTextEntry[] = []
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
      bucket_id:
        rawRt.bucket_id && rawRt.bucket_id.trim() !== ""
          ? rawRt.bucket_id.trim()
          : rawRt.is_long_term
          ? "long_term"
          : "weekly",
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

  const localBucketDefs = await getAllBucketDefinitionsForBackup();
  const localBucketDefMap = new Map<string, BucketDefinition>();
  for (const bd of localBucketDefs) localBucketDefMap.set(bd.id, bd);

  for (const rawBd of remoteBucketDefs) {
    if (!rawBd.id) continue;
    const bd = resolveSoftDeleteWinner({
      ...rawBd,
      scope:
        rawBd.scope === "persistent"
          ? ("persistent" as const)
          : ("weekly" as const),
      created_at:
        rawBd.created_at || rawBd.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at:
        rawBd.updated_at || rawBd.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawBd.deleted_at ?? null,
    });
    const existing = localBucketDefMap.get(bd.id);
    if (!existing) {
      await putInStore("bucket_definitions", bd);
      upserted++;
    } else if (getEffectiveTimestamp(bd) > getEffectiveTimestamp(existing)) {
      const newestUpdated =
        bd.updated_at > existing.updated_at ? bd.updated_at : existing.updated_at;
      const candDeleted =
        (bd.deleted_at || "") > (existing.deleted_at || "")
          ? bd.deleted_at
          : existing.deleted_at;
      const winningDeleted =
        candDeleted && candDeleted >= newestUpdated ? candDeleted : null;
      await putInStore("bucket_definitions", {
        ...bd,
        updated_at: newestUpdated,
        deleted_at: winningDeleted,
      });
      upserted++;
    }
  }

  const localBucketLayouts = await getAllBucketLayouts();
  const localLayoutMap = new Map<string, BucketLayoutSnapshot>();
  for (const bl of localBucketLayouts) {
    localLayoutMap.set(bl.effective_from_week, bl);
  }

  for (const rawBl of remoteBucketLayouts) {
    if (!rawBl.effective_from_week) continue;
    const existing = localLayoutMap.get(rawBl.effective_from_week);
    const remoteUpdated = rawBl.updated_at || "1970-01-01T00:00:00.000Z";
    if (!existing || remoteUpdated > existing.updated_at) {
      await putInStore("bucket_layouts", {
        effective_from_week: rawBl.effective_from_week,
        buckets: Array.isArray(rawBl.buckets) ? rawBl.buckets : [],
        is_explicit_override: Boolean(rawBl.is_explicit_override),
        updated_at: remoteUpdated,
      });
      upserted++;
    }
  }

  if (remoteBucketTextEntries.length > 0) {
    const localTexts = await getAllBucketTextEntriesForBackup();
    const localTextMap = new Map<string, BucketTextEntry>();
    for (const t of localTexts) {
      localTextMap.set(`${t.bucket_id}::${t.week_start}`, t);
    }
    for (const rawBt of remoteBucketTextEntries) {
      if (!rawBt.bucket_id || !rawBt.week_start) continue;
      const bt = resolveSoftDeleteWinner({
        bucket_id: rawBt.bucket_id,
        week_start: rawBt.week_start,
        content: rawBt.content ?? "",
        updated_at: rawBt.updated_at || "1970-01-01T00:00:00.000Z",
        deleted_at: rawBt.deleted_at ?? null,
      });
      const key = `${bt.bucket_id}::${bt.week_start}`;
      const existing = localTextMap.get(key);
      if (
        !existing ||
        getEffectiveTimestamp(bt) > getEffectiveTimestamp(existing)
      ) {
        await putInStore("bucket_text_entries", {
          id: key,
          ...bt,
        });
        upserted++;
      }
    }
  }

  if (upserted > 0) notifyDatabaseUpdated("github_sync:pull_upsert");
  return upserted;
}

export async function replaceAllLocalDataWithRemote(
  remoteTasks: LocalTask[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = [],
  remoteBucketTextEntries: BucketTextEntry[] = []
): Promise<void> {
  await replaceStoreContents(
    "tasks",
    remoteTasks.map((t) =>
      resolveSoftDeleteWinner({
        ...t,
        sync_id: t.sync_id?.trim() || String(t.id),
        bucket_id:
          t.bucket_id && t.bucket_id.trim() !== ""
            ? t.bucket_id.trim()
            : t.is_long_term
            ? "long_term"
            : "weekly",
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
  await replaceStoreContents(
    "bucket_definitions",
    remoteBucketDefs
      .filter((b) => Boolean(b.id))
      .map((b) =>
        resolveSoftDeleteWinner({
          ...b,
          scope:
            b.scope === "persistent"
              ? ("persistent" as const)
              : ("weekly" as const),
          deleted_at: b.deleted_at ?? null,
        })
      )
  );
  await getAllBucketDefinitionsForBackup();
  await replaceStoreContents(
    "bucket_layouts",
    remoteBucketLayouts
      .filter((bl) => Boolean(bl.effective_from_week))
      .map((bl) => ({
        effective_from_week: bl.effective_from_week,
        buckets: Array.isArray(bl.buckets) ? bl.buckets : [],
        is_explicit_override: Boolean(bl.is_explicit_override),
        updated_at: bl.updated_at || new Date().toISOString(),
      }))
  );
  await replaceStoreContents(
    "bucket_text_entries",
    remoteBucketTextEntries
      .filter((bt) => Boolean(bt.bucket_id && bt.week_start))
      .map((bt) => ({
        id: `${bt.bucket_id}::${bt.week_start}`,
        ...resolveSoftDeleteWinner({
          bucket_id: bt.bucket_id,
          week_start: bt.week_start,
          content: bt.content ?? "",
          updated_at: bt.updated_at || "1970-01-01T00:00:00.000Z",
          deleted_at: bt.deleted_at ?? null,
        }),
      }))
  );
  notifyDatabaseUpdated("github_sync:replace_all");
}
