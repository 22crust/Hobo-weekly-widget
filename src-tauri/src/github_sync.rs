use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::header::{ACCEPT, AUTHORIZATION, CACHE_CONTROL, ETAG, IF_NONE_MATCH, USER_AGENT};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const GITHUB_SYNC_STATUS_EVENT: &str = "github-sync-status";
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GithubConfig {
    #[serde(default = "default_storage_mode")]
    pub storage_mode: String, // "local" | "github"
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub github_owner: String,
    #[serde(default)]
    pub github_repo: String,
    #[serde(default = "default_file_path")]
    pub github_file_path: String, // default "planner-data.json"
}

fn default_storage_mode() -> String {
    "local".to_string()
}

fn default_file_path() -> String {
    "planner-data.json".to_string()
}

impl GithubConfig {
    pub fn is_active(&self) -> bool {
        self.storage_mode == "github"
            && !self.github_token.trim().is_empty()
            && !self.github_owner.trim().is_empty()
            && !self.github_repo.trim().is_empty()
            && !self.github_file_path.trim().is_empty()
    }

    pub fn normalized_path(&self) -> String {
        let p = self.github_file_path.trim().trim_start_matches('/');
        if p.is_empty() {
            "planner-data.json".to_string()
        } else {
            p.to_string()
        }
    }

    pub fn calendar_cache_path(&self) -> String {
        let p = self.normalized_path();
        if let Some((dir, _)) = p.rsplit_once('/') {
            format!("{}/calendar-cache.json", dir)
        } else {
            "calendar-cache.json".to_string()
        }
    }
}

fn default_schema_version() -> u32 {
    CURRENT_SCHEMA_VERSION
}

fn default_epoch_iso() -> String {
    "1970-01-01T00:00:00.000Z".to_string()
}

fn default_true() -> bool {
    true
}

fn default_width() -> f64 {
    180.0
}

fn default_pos_x() -> f64 {
    40.0
}

fn default_pos_y() -> f64 {
    30.0
}

fn default_z_index() -> i64 {
    10
}

fn default_opacity() -> i64 {
    10
}

/// Forgiving boolean deserializer that accepts `true`/`false`, `1`/`0`, or `"1"`/`"true"`.
fn deserialize_bool_forgiving<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Value::deserialize(deserializer).unwrap_or(Value::Bool(false));
    match val {
        Value::Bool(b) => Ok(b),
        Value::Number(n) => Ok(n.as_i64().unwrap_or(0) != 0),
        Value::String(s) => {
            let lower = s.trim().to_ascii_lowercase();
            Ok(lower == "true" || lower == "1" || lower == "yes")
        }
        _ => Ok(false),
    }
}

/// Forgiving string ID deserializer that accepts either a string UUID or an integer ID.
fn deserialize_string_id_forgiving<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Value::deserialize(deserializer).unwrap_or(Value::Null);
    match val {
        Value::String(s) => Ok(s),
        Value::Number(n) => Ok(n.to_string()),
        _ => Ok(String::new()),
    }
}

/// Forgiving element-by-element Vec deserializer: if an older or corrupted array item
/// fails to parse, it is skipped rather than failing the entire `planner-data.json` pull.
fn deserialize_forgiving_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: for<'a> Deserialize<'a>,
{
    let val = Value::deserialize(deserializer).unwrap_or(Value::Null);
    if let Value::Array(items) = val {
        let mut valid = Vec::with_capacity(items.len());
        for item in items {
            if let Ok(parsed) = serde_json::from_value::<T>(item) {
                valid.push(parsed);
            }
        }
        Ok(valid)
    } else {
        Ok(Vec::new())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedLocalTask {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub sync_id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub assigned_date: Option<String>,
    #[serde(default)]
    pub assigned_week_start: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_long_term: bool,
    #[serde(default)]
    pub bucket_id: Option<String>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_completed: bool,
    #[serde(default = "default_true", deserialize_with = "deserialize_bool_forgiving")]
    pub show_in_weekly: bool,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub show_in_sidebar: bool,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default = "default_epoch_iso")]
    pub created_at: String,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

impl SyncedLocalTask {
    /// Stable cross-device merge key: prefers `sync_id` UUID, falling back to `legacy:<id>`.
    pub fn sync_key(&self) -> String {
        self.sync_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("legacy:{}", self.id))
    }

    /// Returns whichever timestamp (`updated_at` vs. `deleted_at`) is newest,
    /// and clears `deleted_at` if `updated_at > deleted_at`.
    pub fn normalized(mut self) -> Self {
        if let Some(ref del) = self.deleted_at {
            if self.updated_at > *del {
                self.deleted_at = None;
            }
        }
        self
    }

    pub fn effective_timestamp(&self) -> &str {
        match &self.deleted_at {
            Some(del) if del.as_str() > self.updated_at.as_str() => del.as_str(),
            _ => self.updated_at.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedWeekImage {
    #[serde(default, deserialize_with = "deserialize_string_id_forgiving")]
    pub id: String,
    #[serde(default, alias = "week_start_date")]
    pub week_start: String,
    #[serde(default, alias = "image_data")]
    pub image_url: String,
    #[serde(default = "default_pos_x")]
    pub pos_x: f64,
    #[serde(default = "default_pos_y")]
    pub pos_y: f64,
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default = "default_z_index")]
    pub z_index: i64,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_locked: bool,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub crop_top: f64,
    #[serde(default)]
    pub crop_right: f64,
    #[serde(default)]
    pub crop_bottom: f64,
    #[serde(default)]
    pub crop_left: f64,
    #[serde(default = "default_opacity")]
    pub opacity: i64,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

impl SyncedWeekImage {
    pub fn normalized(mut self) -> Self {
        if let Some(ref del) = self.deleted_at {
            if self.updated_at > *del {
                self.deleted_at = None;
            }
        }
        self
    }

    pub fn effective_timestamp(&self) -> &str {
        match &self.deleted_at {
            Some(del) if del.as_str() > self.updated_at.as_str() => del.as_str(),
            _ => self.updated_at.as_str(),
        }
    }
}

fn default_repeat_interval() -> i64 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedLocalEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub event_date: String,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_all_day: bool,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_repeating: bool,
    #[serde(default)]
    pub repeat_type: Option<String>,
    #[serde(default = "default_repeat_interval")]
    pub repeat_interval: i64,
    #[serde(default)]
    pub repeat_unit: Option<String>,
    #[serde(default)]
    pub repeat_end_date: Option<String>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub excluded_dates: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub hidden_dates: Vec<String>,
    #[serde(default = "default_epoch_iso")]
    pub created_at: String,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

impl SyncedLocalEvent {
    pub fn normalized(mut self) -> Self {
        if let Some(ref del) = self.deleted_at {
            if self.updated_at > *del {
                self.deleted_at = None;
            }
        }
        self
    }

    pub fn effective_timestamp(&self) -> &str {
        match &self.deleted_at {
            Some(del) if del.as_str() > self.updated_at.as_str() => del.as_str(),
            _ => self.updated_at.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedNotePage {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub page_order: i64,
    #[serde(default)]
    pub content: String,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

impl SyncedNotePage {
    pub fn normalized(mut self) -> Self {
        if let Some(ref del) = self.deleted_at {
            if self.updated_at > *del {
                self.deleted_at = None;
            }
        }
        self
    }

    pub fn effective_timestamp(&self) -> &str {
        match &self.deleted_at {
            Some(del) if del.as_str() > self.updated_at.as_str() => del.as_str(),
            _ => self.updated_at.as_str(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarCacheEvent {
    #[serde(default)]
    pub instance_key: String,
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub calendar_name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub start_time: String,
    #[serde(default)]
    pub end_time: String,
    #[serde(default)]
    pub event_date: String,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_all_day: bool,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_hidden: bool,
    #[serde(default)]
    pub last_synced: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarCachePayload {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_epoch_iso")]
    pub exported_at: String,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub events: Vec<CalendarCacheEvent>,
}

/**
 * Versioned JSON Envelope (`schema_version: 1`) for `planner-data.json`:
 * ```json
 * {
 *   "schema_version": 1,
 *   "exported_at": "2026-11-17T21:30:00Z",
 *   "tasks": [],
 *   "week_images": []
 * }
 * ```
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerBackupPayload {
    #[serde(default = "default_schema_version", alias = "version")]
    pub schema_version: u32,
    #[serde(default = "default_epoch_iso", alias = "updated_at")]
    pub exported_at: String,
    #[serde(
        default,
        alias = "local_tasks",
        deserialize_with = "deserialize_forgiving_vec"
    )]
    pub tasks: Vec<SyncedLocalTask>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub week_images: Vec<SyncedWeekImage>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub local_events: Vec<SyncedLocalEvent>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub note_pages: Vec<SyncedNotePage>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub bucket_definitions: Vec<SyncedBucketDefinition>,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub bucket_layouts: Vec<SyncedBucketLayoutSnapshot>,
    #[serde(default)]
    pub preferences: Option<SyncedPreferences>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedBucketDefinition {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default = "default_epoch_iso")]
    pub created_at: String,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

impl SyncedBucketDefinition {
    pub fn normalized(mut self) -> Self {
        if let Some(ref del) = self.deleted_at {
            if self.updated_at > *del {
                self.deleted_at = None;
            }
        }
        self
    }

    pub fn effective_timestamp(&self) -> &str {
        match &self.deleted_at {
            Some(del) if del.as_str() > self.updated_at.as_str() => del.as_str(),
            _ => self.updated_at.as_str(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedPreferences {
    #[serde(default)]
    pub time_format: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedBucketLayoutEntry {
    #[serde(default)]
    pub bucket_id: String,
    #[serde(default = "default_true", deserialize_with = "deserialize_bool_forgiving")]
    pub visible: bool,
    #[serde(default)]
    pub height_ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncedBucketLayoutSnapshot {
    #[serde(default)]
    pub effective_from_week: String,
    #[serde(default, deserialize_with = "deserialize_forgiving_vec")]
    pub buckets: Vec<SyncedBucketLayoutEntry>,
    #[serde(default, deserialize_with = "deserialize_bool_forgiving")]
    pub is_explicit_override: bool,
    #[serde(default = "default_epoch_iso")]
    pub updated_at: String,
}

impl PlannerBackupPayload {
    /// Compares all synced collections ignoring `exported_at` so no-op pushes can be skipped.
    pub fn data_equals(&self, other: &Self) -> bool {
        self.tasks == other.tasks
            && self.week_images == other.week_images
            && self.local_events == other.local_events
            && self.note_pages == other.note_pages
            && self.bucket_definitions == other.bucket_definitions
            && self.bucket_layouts == other.bucket_layouts
            && self.preferences == other.preferences
    }
}

impl Default for PlannerBackupPayload {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            exported_at: String::new(),
            tasks: Vec::new(),
            week_images: Vec::new(),
            local_events: Vec::new(),
            note_pages: Vec::new(),
            bucket_definitions: Vec::new(),
            bucket_layouts: Vec::new(),
            preferences: None,
        }
    }
}

/// Merges a local `PlannerBackupPayload` with a remote `PlannerBackupPayload` by `id`:
/// - For matching IDs, whichever timestamp (`updated_at` vs. `deleted_at`) is newest wins.
/// - Unique IDs from both local and remote are preserved.
pub fn merge_backup_payloads(
    local: &PlannerBackupPayload,
    remote: Option<&PlannerBackupPayload>,
    exclude_soft_deleted: bool,
) -> PlannerBackupPayload {
    let mut task_map: BTreeMap<String, SyncedLocalTask> = BTreeMap::new();
    for t in &local.tasks {
        let norm = t.clone().normalized();
        task_map.insert(norm.sync_key(), norm);
    }

    if let Some(rem) = remote {
        for rt in &rem.tasks {
            let norm_rt = rt.clone().normalized();
            let key = norm_rt.sync_key();
            match task_map.get(&key) {
                None => {
                    task_map.insert(key, norm_rt);
                }
                Some(existing) => {
                    if norm_rt.effective_timestamp() > existing.effective_timestamp() {
                        task_map.insert(key, norm_rt);
                    }
                }
            }
        }
    }

    let mut image_map: BTreeMap<String, SyncedWeekImage> = BTreeMap::new();
    for img in &local.week_images {
        let norm = img.clone().normalized();
        if !norm.id.is_empty() {
            image_map.insert(norm.id.clone(), norm);
        }
    }

    if let Some(rem) = remote {
        for rimg in &rem.week_images {
            let norm_rimg = rimg.clone().normalized();
            if norm_rimg.id.is_empty() {
                continue;
            }
            match image_map.get(&norm_rimg.id) {
                None => {
                    image_map.insert(norm_rimg.id.clone(), norm_rimg);
                }
                Some(existing) => {
                    if norm_rimg.effective_timestamp() > existing.effective_timestamp() {
                        image_map.insert(norm_rimg.id.clone(), norm_rimg);
                    }
                }
            }
        }
    }

    let mut event_map: BTreeMap<String, SyncedLocalEvent> = BTreeMap::new();
    for ev in &local.local_events {
        let norm = ev.clone().normalized();
        if !norm.id.is_empty() {
            event_map.insert(norm.id.clone(), norm);
        }
    }

    if let Some(rem) = remote {
        for rev in &rem.local_events {
            let norm_rev = rev.clone().normalized();
            if norm_rev.id.is_empty() {
                continue;
            }
            match event_map.get(&norm_rev.id) {
                None => {
                    event_map.insert(norm_rev.id.clone(), norm_rev);
                }
                Some(existing) => {
                    if norm_rev.effective_timestamp() > existing.effective_timestamp() {
                        event_map.insert(norm_rev.id.clone(), norm_rev);
                    }
                }
            }
        }
    }

    let mut note_map: BTreeMap<String, SyncedNotePage> = BTreeMap::new();
    for np in &local.note_pages {
        let norm = np.clone().normalized();
        if !norm.id.is_empty() {
            note_map.insert(norm.id.clone(), norm);
        }
    }

    if let Some(rem) = remote {
        for rnp in &rem.note_pages {
            let norm_rnp = rnp.clone().normalized();
            if norm_rnp.id.is_empty() {
                continue;
            }
            match note_map.get(&norm_rnp.id) {
                None => {
                    note_map.insert(norm_rnp.id.clone(), norm_rnp);
                }
                Some(existing) => {
                    if norm_rnp.effective_timestamp() > existing.effective_timestamp() {
                        note_map.insert(norm_rnp.id.clone(), norm_rnp);
                    }
                }
            }
        }
    }

    let mut bucket_def_map: BTreeMap<String, SyncedBucketDefinition> = BTreeMap::new();
    for bd in &local.bucket_definitions {
        let norm = bd.clone().normalized();
        if !norm.id.is_empty() {
            bucket_def_map.insert(norm.id.clone(), norm);
        }
    }

    if let Some(rem) = remote {
        for rbd in &rem.bucket_definitions {
            let norm_rbd = rbd.clone().normalized();
            if norm_rbd.id.is_empty() {
                continue;
            }
            match bucket_def_map.get(&norm_rbd.id) {
                None => {
                    bucket_def_map.insert(norm_rbd.id.clone(), norm_rbd);
                }
                Some(existing) => {
                    if norm_rbd.effective_timestamp() > existing.effective_timestamp() {
                        bucket_def_map.insert(norm_rbd.id.clone(), norm_rbd);
                    }
                }
            }
        }
    }

    let mut bucket_layout_map: BTreeMap<String, SyncedBucketLayoutSnapshot> = BTreeMap::new();
    for bl in &local.bucket_layouts {
        if !bl.effective_from_week.is_empty() {
            bucket_layout_map.insert(bl.effective_from_week.clone(), bl.clone());
        }
    }

    if let Some(rem) = remote {
        for rbl in &rem.bucket_layouts {
            if rbl.effective_from_week.is_empty() {
                continue;
            }
            match bucket_layout_map.get(&rbl.effective_from_week) {
                None => {
                    bucket_layout_map.insert(rbl.effective_from_week.clone(), rbl.clone());
                }
                Some(existing) => {
                    if rbl.updated_at > existing.updated_at {
                        bucket_layout_map.insert(rbl.effective_from_week.clone(), rbl.clone());
                    }
                }
            }
        }
    }

    let mut merged_tasks: Vec<SyncedLocalTask> = task_map.into_values().collect();
    let mut merged_images: Vec<SyncedWeekImage> = image_map.into_values().collect();
    let mut merged_events: Vec<SyncedLocalEvent> = event_map.into_values().collect();
    let mut merged_notes: Vec<SyncedNotePage> = note_map.into_values().collect();
    let mut merged_bucket_defs: Vec<SyncedBucketDefinition> =
        bucket_def_map.into_values().collect();
    let merged_bucket_layouts: Vec<SyncedBucketLayoutSnapshot> =
        bucket_layout_map.into_values().collect();

    if exclude_soft_deleted {
        merged_tasks.retain(|t| t.deleted_at.is_none());
        merged_images.retain(|img| img.deleted_at.is_none());
        merged_events.retain(|ev| ev.deleted_at.is_none());
        merged_notes.retain(|np| np.deleted_at.is_none());
        merged_bucket_defs.retain(|bd| bd.deleted_at.is_none());
    }

    let merged_preferences = match (&local.preferences, remote.and_then(|r| r.preferences.as_ref())) {
        (Some(lp), Some(rp)) => {
            let lts = lp.updated_at.as_deref().unwrap_or("");
            let rts = rp.updated_at.as_deref().unwrap_or("");
            if rts > lts {
                Some(rp.clone())
            } else {
                Some(lp.clone())
            }
        }
        (Some(lp), None) => Some(lp.clone()),
        (None, Some(rp)) => Some(rp.clone()),
        (None, None) => None,
    };

    PlannerBackupPayload {
        schema_version: CURRENT_SCHEMA_VERSION,
        exported_at: local.exported_at.clone(),
        tasks: merged_tasks,
        week_images: merged_images,
        local_events: merged_events,
        note_pages: merged_notes,
        bucket_definitions: merged_bucket_defs,
        bucket_layouts: merged_bucket_layouts,
        preferences: merged_preferences,
    }
}

pub fn parse_backup_payload_forgiving(raw_json: &str) -> PlannerBackupPayload {
    let trimmed = raw_json.trim();
    if trimmed.is_empty() {
        return PlannerBackupPayload::default();
    }

    if let Ok(mut parsed) = serde_json::from_str::<PlannerBackupPayload>(trimmed) {
        if parsed.schema_version == 0 {
            parsed.schema_version = CURRENT_SCHEMA_VERSION;
        }
        parsed
            .week_images
            .retain(|img| !img.id.is_empty() && !img.image_url.is_empty() && !img.week_start.is_empty());
        return parsed;
    }

    if let Ok(tasks) = serde_json::from_str::<Vec<SyncedLocalTask>>(trimmed) {
        return PlannerBackupPayload {
            schema_version: CURRENT_SCHEMA_VERSION,
            exported_at: default_epoch_iso(),
            tasks,
            week_images: Vec::new(),
            local_events: Vec::new(),
            note_pages: Vec::new(),
            bucket_definitions: Vec::new(),
            bucket_layouts: Vec::new(),
            preferences: None,
        };
    }

    PlannerBackupPayload::default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubSyncStatusPayload {
    pub status: String, // "disabled" | "idle" | "syncing" | "synced" | "error"
    pub last_synced_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRemoteCheckResult {
    pub exists: bool,
    pub sha: Option<String>,
    pub payload: Option<PlannerBackupPayload>,
}

#[derive(Debug, Deserialize)]
struct GithubContentsResponse {
    sha: String,
    content: Option<String>,
}

#[derive(Debug, Serialize)]
struct GithubPutContentsRequest<'a> {
    message: &'a str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

pub struct GithubSyncState {
    pub config: Mutex<GithubConfig>,
    pub latest_payload: Mutex<PlannerBackupPayload>,
    pub debounce_counter: AtomicU64,
    pub last_synced_at: Mutex<Option<String>>,
    pub last_etag: Mutex<Option<String>>,
}

impl Default for GithubSyncState {
    fn default() -> Self {
        Self {
            config: Mutex::new(GithubConfig {
                storage_mode: "local".to_string(),
                github_token: String::new(),
                github_owner: String::new(),
                github_repo: String::new(),
                github_file_path: "planner-data.json".to_string(),
            }),
            latest_payload: Mutex::new(PlannerBackupPayload::default()),
            debounce_counter: AtomicU64::new(0),
            last_synced_at: Mutex::new(None),
            last_etag: Mutex::new(None),
        }
    }
}

pub fn emit_sync_status(
    app: &AppHandle,
    state: &Arc<GithubSyncState>,
    status: &str,
    message: Option<String>,
) {
    let last_synced = state.last_synced_at.lock().ok().and_then(|g| g.clone());
    let _ = app.emit(
        GITHUB_SYNC_STATUS_EVENT,
        GithubSyncStatusPayload {
            status: status.to_string(),
            last_synced_at: last_synced,
            message,
        },
    );
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))
}

fn contents_url_for_path(cfg: &GithubConfig, path: &str) -> String {
    format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        cfg.github_owner.trim(),
        cfg.github_repo.trim(),
        path.trim_start_matches('/')
    )
}

fn contents_url(cfg: &GithubConfig) -> String {
    contents_url_for_path(cfg, &cfg.normalized_path())
}

fn repo_url(cfg: &GithubConfig) -> String {
    format!(
        "https://api.github.com/repos/{}/{}",
        cfg.github_owner.trim(),
        cfg.github_repo.trim()
    )
}

pub async fn validate_github_repo_access(cfg: &GithubConfig) -> Result<String, String> {
    if cfg.github_owner.trim().is_empty()
        || cfg.github_repo.trim().is_empty()
        || cfg.github_token.trim().is_empty()
    {
        return Err("Please enter GitHub Username, Repository Name, and Personal Access Token.".to_string());
    }

    let client = build_http_client()?;
    let resp = client
        .get(repo_url(cfg))
        .header(USER_AGENT, "LocalPlanner-Desktop-App")
        .header(ACCEPT, "application/vnd.github+json")
        .header(
            AUTHORIZATION,
            format!("Bearer {}", cfg.github_token.trim()),
        )
        .send()
        .await
        .map_err(|e| format!("Network error connecting to GitHub: {}", e))?;

    match resp.status().as_u16() {
        200 => Ok("Connected to GitHub repository.".to_string()),
        401 => Err("Invalid token (401 Unauthorized). Check your Personal Access Token.".to_string()),
        403 => Err("Access denied (403 Forbidden). Ensure token has Contents: Read & Write permission.".to_string()),
        404 => Err("Repository not found (404). Verify owner, repository name, and token access.".to_string()),
        code => Err(format!("GitHub returned unexpected status {}", code)),
    }
}

pub enum RemoteFetchOutcome {
    NotModified,
    Fetched {
        result: GithubRemoteCheckResult,
        etag: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct GithubPullResult {
    pub not_modified: bool,
    pub exists: bool,
    pub payload: Option<PlannerBackupPayload>,
}

pub async fn fetch_remote_file_with_etag(
    cfg: &GithubConfig,
    etag: Option<&str>,
) -> Result<RemoteFetchOutcome, String> {
    let client = build_http_client()?;
    let mut req = client
        .get(contents_url(cfg))
        .header(USER_AGENT, "LocalPlanner-Desktop-App")
        .header(ACCEPT, "application/vnd.github+json")
        .header(CACHE_CONTROL, "no-cache")
        .header(
            AUTHORIZATION,
            format!("Bearer {}", cfg.github_token.trim()),
        );

    if let Some(tag) = etag.map(str::trim).filter(|s| !s.is_empty()) {
        req = req.header(IF_NONE_MATCH, tag);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch remote file from GitHub: {}", e))?;

    match resp.status().as_u16() {
        304 => Ok(RemoteFetchOutcome::NotModified),
        200 => {
            let new_etag = resp
                .headers()
                .get(ETAG)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);

            let body: GithubContentsResponse = resp
                .json()
                .await
                .map_err(|e| format!("Invalid GitHub contents metadata: {}", e))?;

            let parsed_payload = if let Some(encoded) = body.content {
                let cleaned: String = encoded
                    .chars()
                    .filter(|c| !c.is_whitespace())
                    .collect();
                match BASE64_STANDARD.decode(cleaned.as_bytes()) {
                    Ok(decoded_bytes) => {
                        let decoded_str = String::from_utf8_lossy(&decoded_bytes);
                        Some(parse_backup_payload_forgiving(&decoded_str))
                    }
                    Err(_) => Some(PlannerBackupPayload::default()),
                }
            } else {
                Some(PlannerBackupPayload::default())
            };

            Ok(RemoteFetchOutcome::Fetched {
                result: GithubRemoteCheckResult {
                    exists: true,
                    sha: Some(body.sha),
                    payload: parsed_payload,
                },
                etag: new_etag,
            })
        }
        404 => Ok(RemoteFetchOutcome::Fetched {
            result: GithubRemoteCheckResult {
                exists: false,
                sha: None,
                payload: None,
            },
            etag: None,
        }),
        401 => Err("Invalid GitHub token (401 Unauthorized).".to_string()),
        403 => Err("GitHub token lacks permission (403 Forbidden).".to_string()),
        code => Err(format!("GitHub GET contents failed with HTTP {}", code)),
    }
}

pub async fn fetch_remote_file(
    cfg: &GithubConfig,
) -> Result<GithubRemoteCheckResult, String> {
    match fetch_remote_file_with_etag(cfg, None).await? {
        RemoteFetchOutcome::Fetched { result, .. } => Ok(result),
        RemoteFetchOutcome::NotModified => Ok(GithubRemoteCheckResult {
            exists: true,
            sha: None,
            payload: None,
        }),
    }
}

async fn put_file_once_at_path(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    path: &str,
    message: &'static str,
    encoded_content: &str,
    sha: Option<String>,
) -> Result<u16, String> {
    let req_body = GithubPutContentsRequest {
        message,
        content: encoded_content.to_string(),
        sha,
    };

    let resp = client
        .put(contents_url_for_path(cfg, path))
        .header(USER_AGENT, "LocalPlanner-Desktop-App")
        .header(ACCEPT, "application/vnd.github+json")
        .header(
            AUTHORIZATION,
            format!("Bearer {}", cfg.github_token.trim()),
        )
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Network error pushing to GitHub: {}", e))?;

    Ok(resp.status().as_u16())
}

async fn put_file_once(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    encoded_content: &str,
    sha: Option<String>,
) -> Result<u16, String> {
    put_file_once_at_path(
        client,
        cfg,
        &cfg.normalized_path(),
        "Sync local planner data",
        encoded_content,
        sha,
    )
    .await
}

async fn fetch_remote_sha_for_path(
    client: &reqwest::Client,
    cfg: &GithubConfig,
    path: &str,
) -> Result<Option<String>, String> {
    let resp = client
        .get(contents_url_for_path(cfg, path))
        .header(USER_AGENT, "LocalPlanner-Desktop-App")
        .header(ACCEPT, "application/vnd.github+json")
        .header(
            AUTHORIZATION,
            format!("Bearer {}", cfg.github_token.trim()),
        )
        .send()
        .await
        .map_err(|e| format!("Failed to fetch remote SHA from GitHub: {}", e))?;

    match resp.status().as_u16() {
        200 => {
            let body: GithubContentsResponse = resp
                .json()
                .await
                .map_err(|e| format!("Invalid GitHub contents metadata: {}", e))?;
            Ok(Some(body.sha))
        }
        404 => Ok(None),
        401 => Err("Invalid GitHub token (401 Unauthorized).".to_string()),
        403 => Err("GitHub token lacks permission (403 Forbidden).".to_string()),
        code => Err(format!("GitHub GET contents failed with HTTP {}", code)),
    }
}

#[tauri::command]
pub async fn push_calendar_cache_to_github(
    state: tauri::State<'_, Arc<GithubSyncState>>,
    payload: CalendarCachePayload,
) -> Result<(), String> {
    let cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to lock config".to_string())?
        .clone();

    if !cfg.is_active() {
        return Ok(());
    }

    let client = build_http_client()?;
    let cache_path = cfg.calendar_cache_path();
    let formatted_json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed to serialize calendar cache payload: {}", e))?;
    let encoded = BASE64_STANDARD.encode(formatted_json.as_bytes());

    let sha = fetch_remote_sha_for_path(&client, &cfg, &cache_path).await?;
    let status = put_file_once_at_path(
        &client,
        &cfg,
        &cache_path,
        "Update calendar-cache.json",
        &encoded,
        sha,
    )
    .await?;

    if status == 200 || status == 201 {
        return Ok(());
    }

    if status == 409 || status == 422 {
        let retry_sha = fetch_remote_sha_for_path(&client, &cfg, &cache_path).await?;
        let retry_status = put_file_once_at_path(
            &client,
            &cfg,
            &cache_path,
            "Update calendar-cache.json",
            &encoded,
            retry_sha,
        )
        .await?;
        if retry_status == 200 || retry_status == 201 {
            return Ok(());
        }
        return Err(format!(
            "GitHub calendar-cache conflict retry failed with HTTP {}",
            retry_status
        ));
    }

    Err(format!(
        "GitHub calendar-cache PUT failed with HTTP {}",
        status
    ))
}

/// Pulls the latest `planner-data.json` from GitHub, merges by `id` + newest (`updated_at` vs. `deleted_at`)
/// (unless `overwrite_remote` is true, e.g., when purging all soft-deleted rows), and commits the result.
/// Returns the merged `PlannerBackupPayload` so the caller can also upsert any newer remote rows into SQLite.
pub async fn pull_merge_and_push_to_github(
    cfg: &GithubConfig,
    local_payload: &PlannerBackupPayload,
    overwrite_remote: bool,
) -> Result<PlannerBackupPayload, String> {
    if !cfg.is_active() {
        return Ok(local_payload.clone());
    }

    let client = build_http_client()?;
    let remote = fetch_remote_file(cfg).await?;

    let combined_payload = if overwrite_remote {
        let mut clean = local_payload.clone();
        clean.schema_version = CURRENT_SCHEMA_VERSION;
        clean
    } else {
        merge_backup_payloads(local_payload, remote.payload.as_ref(), false)
    };

    // Skip no-op PUT when remote already matches the merged data
    if !overwrite_remote {
        if let Some(ref rem_payload) = remote.payload {
            if combined_payload.data_equals(rem_payload) {
                return Ok(combined_payload);
            }
        }
    }

    let formatted_json = serde_json::to_string_pretty(&combined_payload)
        .map_err(|e| format!("Failed to serialize backup payload: {}", e))?;
    let encoded = BASE64_STANDARD.encode(formatted_json.as_bytes());

    let status = put_file_once(&client, cfg, &encoded, remote.sha).await?;
    if status == 200 || status == 201 {
        return Ok(combined_payload);
    }

    // Handle 409 Conflict or 422 Unprocessable Entity by re-fetching latest sha, re-merging, and retrying once
    if status == 409 || status == 422 {
        let retry_remote = fetch_remote_file(cfg).await?;
        let retry_combined = if overwrite_remote {
            combined_payload.clone()
        } else {
            merge_backup_payloads(local_payload, retry_remote.payload.as_ref(), false)
        };
        let retry_json = serde_json::to_string_pretty(&retry_combined)
            .map_err(|e| format!("Failed to serialize backup payload: {}", e))?;
        let retry_encoded = BASE64_STANDARD.encode(retry_json.as_bytes());
        let retry_status = put_file_once(&client, cfg, &retry_encoded, retry_remote.sha).await?;
        if retry_status == 200 || retry_status == 201 {
            return Ok(retry_combined);
        }
        return Err(format!(
            "GitHub conflict retry failed with HTTP {}",
            retry_status
        ));
    }

    Err(format!("GitHub PUT contents failed with HTTP {}", status))
}

#[tauri::command]
pub async fn configure_github_sync(
    app: AppHandle,
    state: tauri::State<'_, Arc<GithubSyncState>>,
    config: GithubConfig,
) -> Result<(), String> {
    let is_active = config.is_active();
    let target_changed = if let Ok(mut guard) = state.config.lock() {
        let changed = guard.github_owner.trim() != config.github_owner.trim()
            || guard.github_repo.trim() != config.github_repo.trim()
            || guard.normalized_path() != config.normalized_path()
            || guard.storage_mode != config.storage_mode;
        *guard = config;
        changed
    } else {
        true
    };

    if target_changed {
        if let Ok(mut etag_guard) = state.last_etag.lock() {
            *etag_guard = None;
        }
    }

    if is_active {
        emit_sync_status(&app, &state, "idle", None);
    } else {
        emit_sync_status(&app, &state, "disabled", None);
    }
    Ok(())
}

#[tauri::command]
pub async fn test_github_connection(config: GithubConfig) -> Result<String, String> {
    validate_github_repo_access(&config).await
}

#[tauri::command]
pub async fn check_github_remote_file(
    config: GithubConfig,
) -> Result<GithubRemoteCheckResult, String> {
    validate_github_repo_access(&config).await?;
    fetch_remote_file(&config).await
}

#[tauri::command]
pub async fn pull_from_github(
    app: AppHandle,
    state: tauri::State<'_, Arc<GithubSyncState>>,
) -> Result<GithubPullResult, String> {
    let cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to lock config".to_string())?
        .clone();

    if !cfg.is_active() {
        emit_sync_status(&app, &state, "disabled", None);
        return Ok(GithubPullResult {
            not_modified: false,
            exists: false,
            payload: None,
        });
    }

    let cached_etag = state.last_etag.lock().ok().and_then(|g| g.clone());

    emit_sync_status(&app, &state, "syncing", None);
    match fetch_remote_file_with_etag(&cfg, cached_etag.as_deref()).await {
        Ok(RemoteFetchOutcome::NotModified) => {
            emit_sync_status(&app, &state, "synced", None);
            Ok(GithubPullResult {
                not_modified: true,
                exists: true,
                payload: None,
            })
        }
        Ok(RemoteFetchOutcome::Fetched { result, etag }) => {
            if let Ok(mut etag_guard) = state.last_etag.lock() {
                *etag_guard = etag;
            }
            if let Ok(mut ts) = state.last_synced_at.lock() {
                *ts = Some(
                    result
                        .payload
                        .as_ref()
                        .map(|p| p.exported_at.clone())
                        .unwrap_or_default(),
                );
            }
            emit_sync_status(&app, &state, "synced", None);
            Ok(GithubPullResult {
                not_modified: false,
                exists: result.exists,
                payload: result.payload,
            })
        }
        Err(err) => {
            emit_sync_status(&app, &state, "error", Some(err.clone()));
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn sync_to_github_now(
    app: AppHandle,
    state: tauri::State<'_, Arc<GithubSyncState>>,
    payload: PlannerBackupPayload,
    overwrite_remote: Option<bool>,
) -> Result<PlannerBackupPayload, String> {
    if let Ok(mut guard) = state.latest_payload.lock() {
        *guard = payload.clone();
    }

    let cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to lock config".to_string())?
        .clone();

    if !cfg.is_active() {
        emit_sync_status(&app, &state, "disabled", None);
        return Ok(payload);
    }

    emit_sync_status(&app, &state, "syncing", None);
    match pull_merge_and_push_to_github(&cfg, &payload, overwrite_remote.unwrap_or(false)).await {
        Ok(merged) => {
            if let Ok(mut etag_guard) = state.last_etag.lock() {
                *etag_guard = None;
            }
            let now_iso = merged.exported_at.clone();
            if let Ok(mut ts) = state.last_synced_at.lock() {
                *ts = Some(now_iso);
            }
            if let Ok(mut guard) = state.latest_payload.lock() {
                *guard = merged.clone();
            }
            emit_sync_status(&app, &state, "synced", None);
            Ok(merged)
        }
        Err(err) => {
            emit_sync_status(&app, &state, "error", Some(err.clone()));
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn queue_debounced_github_push(
    app: AppHandle,
    state: tauri::State<'_, Arc<GithubSyncState>>,
    payload: PlannerBackupPayload,
) -> Result<(), String> {
    if let Ok(mut guard) = state.latest_payload.lock() {
        *guard = payload;
    }

    let cfg = state
        .config
        .lock()
        .map_err(|_| "Failed to lock config".to_string())?
        .clone();

    if !cfg.is_active() {
        emit_sync_status(&app, &state, "disabled", None);
        return Ok(());
    }

    let seq = state.debounce_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let state_clone = state.inner().clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if state_clone.debounce_counter.load(Ordering::SeqCst) != seq {
            return;
        }

        let current_cfg = match state_clone.config.lock() {
            Ok(g) => g.clone(),
            Err(_) => return,
        };
        if !current_cfg.is_active() {
            return;
        }

        let latest_data = match state_clone.latest_payload.lock() {
            Ok(g) => g.clone(),
            Err(_) => return,
        };

        emit_sync_status(&app_clone, &state_clone, "syncing", None);
        // Pull latest from GitHub, merge by id + (updated_at vs deleted_at), and push combined result
        match pull_merge_and_push_to_github(&current_cfg, &latest_data, false).await {
            Ok(merged) => {
                if let Ok(mut etag_guard) = state_clone.last_etag.lock() {
                    *etag_guard = None;
                }
                if let Ok(mut ts) = state_clone.last_synced_at.lock() {
                    *ts = Some(merged.exported_at.clone());
                }
                if let Ok(mut guard) = state_clone.latest_payload.lock() {
                    *guard = merged;
                }
                emit_sync_status(&app_clone, &state_clone, "synced", None);
            }
            Err(err) => {
                emit_sync_status(&app_clone, &state_clone, "error", Some(err));
            }
        }
    });

    Ok(())
}
