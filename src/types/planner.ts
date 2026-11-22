import {
  BucketDefinition,
  BucketLayoutEntry,
  BucketLayoutSnapshot,
  BucketScope,
} from "../../shared/buckets";

export type {
  BucketDefinition,
  BucketLayoutEntry,
  BucketLayoutSnapshot,
  BucketScope,
};

/**
 * Read-only Calendar Event cached locally in SQLite (`calendar_events` table).
 * Populated from multiple `.ics` feeds (Google Calendar, Apple iCloud, Outlook, etc.).
 */
export interface GoogleEvent {
  id: number;
  /** Deterministic unique key per event occurrence: `${source_url}::${uid}_${start_time}` */
  instance_key: string;
  /** Original iCal VEVENT UID */
  uid: string;
  /** Normalized source `.ics` feed URL */
  source_url: string;
  /** Detected calendar name or provider (`Google Calendar`, `Apple iCloud`, `Outlook`, etc.) */
  calendar_name: string;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO 8601 start timestamp */
  start_time: string;
  /** ISO 8601 end timestamp */
  end_time: string;
  /** Local date string in YYYY-MM-DD format for fast day column lookup */
  event_date: string;
  /** true if all-day event, false if timed event */
  is_all_day: boolean;
  /** true if hidden by user in the weekly view, false if visible */
  is_hidden: boolean;
  /** ISO 8601 timestamp when this occurrence was last synced */
  last_synced: string;
  /** True if this event was created locally in `local_events` */
  is_local?: boolean;
  /** Underlying UUID in `local_events` when `is_local` is true */
  local_event_id?: string;
  /** Whether this local event belongs to a repeating series */
  is_repeating?: boolean;
  repeat_type?: RepeatType | null;
  repeat_interval?: number;
  repeat_unit?: RepeatUnit | null;
  /** Raw HH:mm start time for local events */
  local_start_hhmm?: string | null;
  /** Raw HH:mm end time for local events */
  local_end_hhmm?: string | null;
}

export type RepeatType = "monthly" | "annual" | "custom";
export type RepeatUnit = "days" | "weeks" | "months";

export interface LocalEvent {
  id: string;
  title: string;
  location: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  is_repeating: boolean;
  repeat_type: RepeatType | null;
  repeat_interval: number;
  repeat_unit: RepeatUnit | null;
  repeat_end_date: string | null;
  excluded_dates: string[];
  hidden_dates: string[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CreateLocalEventInput {
  title: string;
  location?: string | null;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  is_all_day: boolean;
  is_repeating: boolean;
  repeat_type?: RepeatType | null;
  repeat_interval?: number;
  repeat_unit?: RepeatUnit | null;
}

export interface UpdateLocalEventInput {
  title?: string;
  location?: string | null;
  event_date?: string;
  start_time?: string | null;
  end_time?: string | null;
  is_all_day?: boolean;
  is_repeating?: boolean;
  repeat_type?: RepeatType | null;
  repeat_interval?: number;
  repeat_unit?: RepeatUnit | null;
}

export type CalendarEvent = GoogleEvent;

/**
 * Input payload used by the .ics sync engine when upserting occurrences.
 */
export interface UpsertGoogleEventInput {
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
}

/**
 * Local-only task stored in local SQLite (`local_tasks` table).
 * CRITICAL CONSTRAINT: Never synced or written back to Google Calendar.
 * Optionally backed up to a private GitHub repository when `storage_mode === "github"`.
 */
export interface LocalTask {
  id: number;
  sync_id?: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD date string when scheduled on a specific day */
  assigned_date: string | null;
  /** Monday YYYY-MM-DD string linking a task to a specific week's "Weekly Tasks" sidebar */
  assigned_week_start: string | null;
  /** Whether this task belongs to the persistent "Long-Term Tasks" sidebar section */
  is_long_term: boolean;
  /** Immutable ID of the sidebar task list bucket (`'weekly'`, `'long_term'`, or `'bucket_<8hex>'`) */
  bucket_id?: string;
  /** Optional HH:mm start time */
  start_time: string | null;
  /** Optional HH:mm end time */
  end_time: string | null;
  is_completed: boolean;
  /** Whether this task appears in the 7-day weekly view row for `assigned_date` */
  show_in_weekly: boolean;
  /** Whether this task appears in the right-hand "Tasks" sidebar page */
  show_in_sidebar: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NotePage {
  id: string;
  page_order: number;
  content: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface WeekImage {
  /** UUID primary key */
  id: string;
  /** Monday YYYY-MM-DD of the active week */
  week_start: string;
  /** HTTP/HTTPS image URL */
  image_url: string;
  /** Percentage 0–100 of the planner canvas width */
  pos_x: number;
  /** Percentage 0–100 of the planner canvas height */
  pos_y: number;
  /** Width in CSS pixels (default 180) */
  width: number;
  /** Nullable height in CSS pixels (preserves natural aspect ratio unless set) */
  height: number | null;
  /** Layer ordering (default 10) */
  z_index: number;
  /** Whether the sticker is locked behind the text layer */
  is_locked: boolean;
  /** Rotation angle in degrees (soft-snaps every 90°) */
  rotation: number;
  /** Top crop inset percentage (0–80) */
  crop_top: number;
  /** Right crop inset percentage (0–80) */
  crop_right: number;
  /** Bottom crop inset percentage (0–80) */
  crop_bottom: number;
  /** Left crop inset percentage (0–80) */
  crop_left: number;
  /** Opacity level from 1 to 10 (1 = 10%, 10 = 100% default) */
  opacity: number;
  /** True for local-PC dropped files (never synced to GitHub) */
  is_local_only?: boolean;
  /** ISO 8601 timestamp */
  updated_at: string;
  /** ISO 8601 soft-delete timestamp (nullable) */
  deleted_at: string | null;
}

export interface CreateWeekImageInput {
  id?: string;
  week_start: string;
  image_url: string;
  pos_x: number;
  pos_y: number;
  width?: number;
  height?: number | null;
  z_index?: number;
  is_locked?: boolean;
  rotation?: number;
  crop_top?: number;
  crop_right?: number;
  crop_bottom?: number;
  crop_left?: number;
  opacity?: number;
  is_local_only?: boolean;
}

export interface UpdateWeekImageInput {
  pos_x?: number;
  pos_y?: number;
  width?: number;
  height?: number | null;
  z_index?: number;
  is_locked?: boolean;
  rotation?: number;
  crop_top?: number;
  crop_right?: number;
  crop_bottom?: number;
  crop_left?: number;
  opacity?: number;
}

export type StorageMode = "local" | "github";

export interface AppSettings {
  storage_mode: StorageMode;
  github_token: string;
  github_owner: string;
  github_repo: string;
  github_file_path: string;
  google_ical_urls: string;
  calendar_urls: string;
  accent_color: string;
}

export interface CalendarFeedSyncResult {
  url: string;
  provider: string;
  calendarName: string;
  ok: boolean;
  eventCount: number;
  error: string | null;
}

export type GithubSyncStatusKind =
  | "disabled"
  | "idle"
  | "syncing"
  | "synced"
  | "error";

export interface GithubSyncStatusPayload {
  status: GithubSyncStatusKind;
  last_synced_at: string | null;
  message: string | null;
}

import type { SyncedPreferences } from "../../shared/timeFormat";

export interface PlannerBackupPayload {
  schema_version: number;
  exported_at: string;
  tasks: LocalTask[];
  week_images: WeekImage[];
  local_events?: LocalEvent[];
  note_pages?: NotePage[];
  bucket_definitions?: BucketDefinition[];
  bucket_layouts?: BucketLayoutSnapshot[];
  preferences?: SyncedPreferences;
  /** Legacy compatibility alias if reading an older payload */
  local_tasks?: LocalTask[];
}

export interface CalendarCachePayload {
  schema_version: number;
  exported_at: string;
  events: GoogleEvent[];
}

export interface GithubRemoteCheckResult {
  exists: boolean;
  sha: string | null;
  payload: PlannerBackupPayload | null;
}

export interface CreateLocalTaskInput {
  title: string;
  notes?: string | null;
  assigned_date?: string | null;
  assigned_week_start?: string | null;
  is_long_term?: boolean;
  bucket_id?: string;
  start_time?: string | null;
  end_time?: string | null;
  show_in_weekly: boolean;
  show_in_sidebar: boolean;
}

export interface UpdateLocalTaskInput {
  title?: string;
  notes?: string | null;
  assigned_date?: string | null;
  assigned_week_start?: string | null;
  is_long_term?: boolean;
  bucket_id?: string;
  start_time?: string | null;
  end_time?: string | null;
  is_completed?: boolean;
  show_in_weekly?: boolean;
  show_in_sidebar?: boolean;
  sort_order?: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  upsertedCount: number;
  hasConfiguredUrl: boolean;
  feedResults?: Record<string, CalendarFeedSyncResult>;
}

export interface DailyWeather {
  date: string; // YYYY-MM-DD
  weatherCode: number;
  tempMax: number;
  tempMin: number;
}

export interface CurrentWeatherSummary {
  city: string;
  temperature: number;
  weatherCode: number;
  conditionLabel: string;
  tempMax: number;
  tempMin: number;
}

export interface WeatherData {
  current: CurrentWeatherSummary | null;
  dailyByDate: Record<string, DailyWeather>;
}
