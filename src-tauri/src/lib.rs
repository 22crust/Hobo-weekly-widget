pub mod calendar_sync;
pub mod github_sync;

use calendar_sync::fetch_calendar_ics_feed;
use github_sync::{
    check_github_remote_file, configure_github_sync, pull_from_github,
    pull_merge_and_push_to_github, push_calendar_cache_to_github, queue_debounced_github_push,
    sync_to_github_now, test_github_connection, GithubSyncState,
};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_window_state::StateFlags;

pub const TRIGGER_SYNC_EVENT: &str = "trigger-sync";
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_google_events_and_local_tasks_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS google_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    instance_key TEXT NOT NULL UNIQUE,
                    uid TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    location TEXT,
                    start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL,
                    event_date TEXT NOT NULL,
                    is_all_day INTEGER NOT NULL DEFAULT 0,
                    is_hidden INTEGER NOT NULL DEFAULT 0,
                    last_synced TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_google_events_date ON google_events(event_date);

                CREATE TABLE IF NOT EXISTS local_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    notes TEXT,
                    assigned_date TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    is_completed INTEGER NOT NULL DEFAULT 0,
                    show_in_weekly INTEGER NOT NULL DEFAULT 1,
                    show_in_sidebar INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_local_tasks_date ON local_tasks(assigned_date);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_week_start_and_long_term_to_local_tasks",
            sql: "
                ALTER TABLE local_tasks ADD COLUMN assigned_week_start TEXT;
                ALTER TABLE local_tasks ADD COLUMN is_long_term INTEGER NOT NULL DEFAULT 0;
                CREATE INDEX IF NOT EXISTS idx_local_tasks_week ON local_tasks(assigned_week_start);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_updated_at_app_settings_and_week_images",
            sql: "
                ALTER TABLE local_tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

                CREATE TABLE IF NOT EXISTS app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    storage_mode TEXT NOT NULL DEFAULT 'local',
                    github_token TEXT NOT NULL DEFAULT '',
                    github_owner TEXT NOT NULL DEFAULT '',
                    github_repo TEXT NOT NULL DEFAULT '',
                    github_file_path TEXT NOT NULL DEFAULT 'planner-data.json',
                    google_ical_urls TEXT NOT NULL DEFAULT ''
                );

                INSERT OR IGNORE INTO app_settings (
                    id, storage_mode, github_token, github_owner, github_repo, github_file_path, google_ical_urls
                ) VALUES (1, 'local', '', '', '', 'planner-data.json', '');

                CREATE TABLE IF NOT EXISTS week_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    week_start_date TEXT NOT NULL UNIQUE,
                    image_data TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_week_images_sticker_schema",
            sql: "
                DROP TABLE IF EXISTS week_images;

                CREATE TABLE IF NOT EXISTS week_images (
                    id TEXT PRIMARY KEY NOT NULL,
                    week_start TEXT NOT NULL,
                    image_url TEXT NOT NULL,
                    pos_x REAL NOT NULL DEFAULT 40.0,
                    pos_y REAL NOT NULL DEFAULT 30.0,
                    width REAL NOT NULL DEFAULT 180.0,
                    height REAL,
                    z_index INTEGER NOT NULL DEFAULT 10,
                    is_locked INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_week_images_week_start ON week_images(week_start);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_deleted_at_soft_delete_to_local_tasks_and_week_images",
            sql: "
                ALTER TABLE local_tasks ADD COLUMN deleted_at TEXT;
                ALTER TABLE week_images ADD COLUMN deleted_at TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_rotation_and_crop_to_week_images",
            sql: "
                ALTER TABLE week_images ADD COLUMN rotation REAL NOT NULL DEFAULT 0.0;
                ALTER TABLE week_images ADD COLUMN crop_top REAL NOT NULL DEFAULT 0.0;
                ALTER TABLE week_images ADD COLUMN crop_right REAL NOT NULL DEFAULT 0.0;
                ALTER TABLE week_images ADD COLUMN crop_bottom REAL NOT NULL DEFAULT 0.0;
                ALTER TABLE week_images ADD COLUMN crop_left REAL NOT NULL DEFAULT 0.0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_accent_color_to_app_settings",
            sql: "
                ALTER TABLE app_settings ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#C94A38';
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_opacity_level_to_week_images",
            sql: "
                ALTER TABLE week_images ADD COLUMN opacity INTEGER NOT NULL DEFAULT 10;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "migrate_google_events_to_calendar_events_and_add_calendar_urls",
            sql: "
                CREATE TABLE IF NOT EXISTS calendar_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    instance_key TEXT NOT NULL UNIQUE,
                    uid TEXT NOT NULL,
                    source_url TEXT NOT NULL DEFAULT '',
                    calendar_name TEXT NOT NULL DEFAULT 'Calendar',
                    title TEXT NOT NULL,
                    description TEXT,
                    location TEXT,
                    start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL,
                    event_date TEXT NOT NULL,
                    is_all_day INTEGER NOT NULL DEFAULT 0,
                    is_hidden INTEGER NOT NULL DEFAULT 0,
                    last_synced TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date);
                CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_url);

                INSERT OR IGNORE INTO calendar_events (
                    instance_key, uid, source_url, calendar_name, title, description, location,
                    start_time, end_time, event_date, is_all_day, is_hidden, last_synced
                )
                SELECT
                    instance_key, uid, 'legacy', 'Calendar', title, description, location,
                    start_time, end_time, event_date, is_all_day, is_hidden, last_synced
                FROM google_events;

                DROP TABLE IF EXISTS google_events;

                ALTER TABLE app_settings ADD COLUMN calendar_urls TEXT NOT NULL DEFAULT '';
                UPDATE app_settings SET calendar_urls = google_ical_urls WHERE calendar_urls = '' AND google_ical_urls != '';
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "create_local_events_table",
            sql: "
                CREATE TABLE IF NOT EXISTS local_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    location TEXT,
                    event_date TEXT NOT NULL,
                    start_time TEXT,
                    end_time TEXT,
                    is_all_day INTEGER NOT NULL DEFAULT 0,
                    is_repeating INTEGER NOT NULL DEFAULT 0,
                    repeat_type TEXT,
                    repeat_interval INTEGER NOT NULL DEFAULT 1,
                    repeat_unit TEXT,
                    repeat_end_date TEXT,
                    excluded_dates TEXT NOT NULL DEFAULT '[]',
                    hidden_dates TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_local_events_date ON local_events(event_date);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "create_note_pages_table",
            sql: "
                CREATE TABLE IF NOT EXISTS note_pages (
                    id TEXT PRIMARY KEY NOT NULL,
                    page_order INTEGER NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_is_local_only_to_week_images",
            sql: "
                ALTER TABLE week_images ADD COLUMN is_local_only INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_sync_id_to_local_tasks",
            sql: "
                ALTER TABLE local_tasks ADD COLUMN sync_id TEXT;
                UPDATE local_tasks
                SET sync_id = lower(
                    hex(randomblob(4)) || '-' ||
                    hex(randomblob(2)) || '-4' ||
                    substr(hex(randomblob(2)), 2) || '-' ||
                    substr('89ab', abs(random()) % 4 + 1, 1) ||
                    substr(hex(randomblob(2)), 2) || '-' ||
                    hex(randomblob(6))
                )
                WHERE sync_id IS NULL OR sync_id = '';
                CREATE UNIQUE INDEX IF NOT EXISTS idx_local_tasks_sync_id ON local_tasks(sync_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_deleted_at_to_local_events_and_note_pages",
            sql: "
                ALTER TABLE local_events ADD COLUMN deleted_at TEXT;
                ALTER TABLE note_pages ADD COLUMN deleted_at TEXT;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_custom_task_buckets",
            sql: "
                ALTER TABLE local_tasks ADD COLUMN bucket_id TEXT NOT NULL DEFAULT 'weekly';
                UPDATE local_tasks SET bucket_id = 'long_term' WHERE is_long_term = 1;

                CREATE TABLE IF NOT EXISTS bucket_definitions (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );

                INSERT OR IGNORE INTO bucket_definitions (id, title, scope, created_at, updated_at, deleted_at)
                VALUES
                    ('weekly', 'Weekly Tasks', 'weekly', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', NULL),
                    ('long_term', 'Long-Term Tasks', 'persistent', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', NULL);

                CREATE TABLE IF NOT EXISTS bucket_layouts (
                    effective_from_week TEXT PRIMARY KEY NOT NULL,
                    buckets_json TEXT NOT NULL,
                    is_explicit_override INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_calendar_tools_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS mood_entries (
                    date TEXT PRIMARY KEY NOT NULL,
                    color_key TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS date_counters (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    target_date TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_bucket_kind_and_text_entries",
            sql: "
                ALTER TABLE bucket_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'tasks';

                CREATE TABLE IF NOT EXISTS bucket_text_entries (
                    bucket_id TEXT NOT NULL,
                    week_start TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT,
                    PRIMARY KEY (bucket_id, week_start)
                );
            ",
            kind: MigrationKind::Up,
        },
    ]
}

/// Zero-allocation check for whether a local-PC sticker file still exists on disk.
#[tauri::command]
fn check_local_file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

pub struct PlannerRegionState(pub Mutex<(bool, bool, bool)>);

fn apply_planner_region(
    win: &tauri::WebviewWindow,
    show_calendar: bool,
    show_notes: bool,
    is_collapsed: bool,
) {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        extern "system" {
            fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
            fn SetWindowRgn(hwnd: *mut c_void, hrgn: *mut c_void, redraw: i32) -> i32;
        }
        let Ok(size) = win.inner_size() else { return };
        let factor = win.scale_factor().unwrap_or(1.0);
        let side_f = 340.0 * factor;
        let left = if show_calendar {
            0
        } else {
            (side_f.floor() as i32 - 1).max(0)
        };
        let right = if show_notes {
            size.width as i32 + 1
        } else {
            ((size.width as f64) - side_f).ceil().max((left + 100) as f64) as i32 + 1
        };
        let bottom = if is_collapsed {
            (28.0 * factor).ceil() as i32 + 1
        } else {
            size.height as i32 + 1
        };

        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                let rgn = CreateRectRgn(left, 0, right, bottom);
                if !rgn.is_null() {
                    SetWindowRgn(hwnd.0 as *mut c_void, rgn, 1);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (win, show_calendar, show_notes, is_collapsed);
    }
}

#[tauri::command]
fn set_planner_visible_region(
    app: tauri::AppHandle,
    state: tauri::State<'_, PlannerRegionState>,
    show_calendar: bool,
    show_notes: bool,
    is_collapsed: bool,
) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = (show_calendar, show_notes, is_collapsed);
    }
    if let Some(win) = app.get_webview_window("planner-widget") {
        apply_planner_region(&win, show_calendar, show_notes, is_collapsed);
    }
}

/// Creates a local safety backup (`planner.db.bak`) in AppLocalData before installing an app update.
#[tauri::command]
fn backup_planner_db(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app_local_data_dir: {e}"))?;
    let db_path = data_dir.join("planner.db");
    let bak_path = data_dir.join("planner.db.bak");
    if db_path.exists() {
        std::fs::copy(&db_path, &bak_path)
            .map_err(|e| format!("Failed to backup planner.db: {e}"))?;
    }
    Ok(())
}

fn toggle_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
        } else {
            let _ = window.set_always_on_bottom(true);
            let _ = window.set_skip_taskbar(true);
            let _ = window.show();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let github_state = Arc::new(GithubSyncState::default());

    tauri::Builder::default()
        .manage(github_state)
        .manage(PlannerRegionState(Mutex::new((false, false, false))))
        .invoke_handler(tauri::generate_handler![
            fetch_calendar_ics_feed,
            check_local_file_exists,
            set_planner_visible_region,
            backup_planner_db,
            configure_github_sync,
            test_github_connection,
            check_github_remote_file,
            pull_from_github,
            sync_to_github_now,
            queue_debounced_github_push,
            push_calendar_cache_to_github
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:planner.db", get_migrations())
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .on_window_event(|window, event| {
            match event {
                // Intercept CloseRequested (X or Alt+F4) so the widget hides instead of terminating the tray process
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Resized(_) => {
                    if window.label() == "planner-widget" {
                        let app = window.app_handle();
                        if let Some(state) = app.try_state::<PlannerRegionState>() {
                            if let Ok(guard) = state.0.lock() {
                                let (cal, notes, collapsed) = *guard;
                                if let Some(wv) = app.get_webview_window("planner-widget") {
                                    apply_planner_region(&wv, cal, notes, collapsed);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            if let Some(win) = app.get_webview_window("planner-widget") {
                let _ = win.set_decorations(false);
                let _ = win.set_shadow(false);
                let _ = win.set_always_on_bottom(true);
                let _ = win.set_skip_taskbar(true);
                let _ = win.set_size(Size::Logical(LogicalSize::new(1440.0, 760.0)));
                let _ = win.set_position(Position::Physical(PhysicalPosition::new(110, 100)));
                apply_planner_region(&win, false, false, false);
                let _ = win.show();
                let _ = win.unminimize();
            }

            let initial_autostart = app
                .autolaunch()
                .is_enabled()
                .unwrap_or(false);

            let toggle_plan = MenuItemBuilder::with_id(
                "toggle_planner",
                "Show / Hide Weekly Planner",
            )
            .build(app)?;

            let sync_now = MenuItemBuilder::with_id(
                "sync_now",
                "Sync Calendars Now",
            )
            .build(app)?;

            let open_settings = MenuItemBuilder::with_id(
                "open_settings",
                "Settings...",
            )
            .build(app)?;

            let sep_1 = PredefinedMenuItem::separator(app)?;

            let launch_on_startup = CheckMenuItemBuilder::with_id(
                "launch_on_startup",
                "Launch on Startup",
            )
            .checked(initial_autostart)
            .build(app)?;

            let sep_2 = PredefinedMenuItem::separator(app)?;

            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[
                    &toggle_plan,
                    &sync_now,
                    &open_settings,
                    &sep_1,
                    &launch_on_startup,
                    &sep_2,
                    &quit,
                ])
                .build()?;

            let startup_item_for_closure = launch_on_startup.clone();

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Weekly Planner")
                .on_menu_event(move |app_handle, event| match event.id().as_ref() {
                    "toggle_planner" => toggle_window(app_handle, "planner-widget"),
                    "sync_now" => {
                        let _ = app_handle.emit(TRIGGER_SYNC_EVENT, ());
                    }
                    "open_settings" => {
                        if let Some(window) = app_handle.get_webview_window("planner-widget") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app_handle.emit(OPEN_SETTINGS_EVENT, ());
                    }
                    "launch_on_startup" => {
                        let autolaunch = app_handle.autolaunch();
                        let currently_enabled = autolaunch.is_enabled().unwrap_or(false);
                        if currently_enabled {
                            let _ = autolaunch.disable();
                            let _ = startup_item_for_closure.set_checked(false);
                        } else {
                            let _ = autolaunch.enable();
                            let _ = startup_item_for_closure.set_checked(true);
                        }
                    }
                    "quit" => {
                        // Flush latest GitHub backup on Quit if GitHub mode is active
                        let state = app_handle.state::<Arc<GithubSyncState>>().inner().clone();
                        let handle_clone = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let cfg = state.config.lock().ok().map(|g| g.clone());
                            let payload = state.latest_payload.lock().ok().map(|g| g.clone());
                            if let (Some(c), Some(p)) = (cfg, payload) {
                                if c.is_active() && !p.exported_at.is_empty() {
                                    let _ = pull_merge_and_push_to_github(&c, &p, false).await;
                                }
                            }
                            handle_clone.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle(), "planner-widget");
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Local Planner tauri application");
}
