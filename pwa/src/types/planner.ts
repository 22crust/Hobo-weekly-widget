import {
  BucketDefinition,
  BucketLayoutEntry,
  BucketLayoutSnapshot,
  BucketScope,
} from "../../../shared/buckets";

export type {
  BucketDefinition,
  BucketLayoutEntry,
  BucketLayoutSnapshot,
  BucketScope,
};

export interface GoogleEvent {
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
  repeat_type?: RepeatType | null;
  repeat_interval?: number;
  repeat_unit?: RepeatUnit | null;
  local_start_hhmm?: string | null;
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

export interface LocalTask {
  id: number;
  sync_id: string;
  title: string;
  notes: string | null;
  assigned_date: string | null;
  assigned_week_start: string | null;
  is_long_term: boolean;
  bucket_id?: string;
  start_time: string | null;
  end_time: string | null;
  is_completed: boolean;
  show_in_weekly: boolean;
  show_in_sidebar: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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

export interface NotePage {
  id: string;
  page_order: number;
  content: string;
  updated_at: string;
  deleted_at?: string | null;
}

export type StorageMode = "local" | "github";

export interface AppSettings {
  storage_mode: StorageMode;
  github_token: string;
  github_owner: string;
  github_repo: string;
  github_file_path: string;
  accent_color: string;
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

import type { SyncedPreferences } from "../../../shared/timeFormat";

export interface BucketTextEntry {
  bucket_id: string;
  week_start: string;
  content: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PlannerBackupPayload {
  schema_version: number;
  exported_at: string;
  tasks: LocalTask[];
  /** Preserved untouched from remote so mobile edits never erase desktop stickers */
  week_images?: unknown[];
  local_events?: LocalEvent[];
  note_pages?: NotePage[];
  bucket_definitions?: BucketDefinition[];
  bucket_layouts?: BucketLayoutSnapshot[];
  bucket_text_entries?: BucketTextEntry[];
  /** Preserved untouched from remote so mobile edits never erase desktop calendar tools */
  mood_entries?: unknown[];
  date_counters?: unknown[];
  preferences?: SyncedPreferences;
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
