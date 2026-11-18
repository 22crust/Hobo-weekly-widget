pub mod calendar_sync;
pub mod github_sync;

use calendar_sync::fetch_calendar_ics_feed;
use github_sync::{
    check_github_remote_file, configure_github_sync, pull_from_github,
    pull_merge_and_push_to_github, queue_debounced_github_push, sync_to_github_now,
    test_github_connection, GithubSyncState,
};
use std::sync::Arc;
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
    ]
}

#[tauri::command]
fn read_local_image_data_url(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::path::Path;

    let file_path = Path::new(&path);
    if !file_path.exists() || !file_path.is_file() {
        return Err("FILE_NOT_FOUND".to_string());
    }

    let bytes = std::fs::read(file_path).map_err(|e| format!("READ_ERROR: {e}"))?;
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };

    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
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
        .invoke_handler(tauri::generate_handler![
            fetch_calendar_ics_feed,
            read_local_image_data_url,
            backup_planner_db,
            configure_github_sync,
            test_github_connection,
            check_github_remote_file,
            pull_from_github,
            sync_to_github_now,
            queue_debounced_github_push
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
            // Intercept CloseRequested (X or Alt+F4) so the widget hides instead of terminating the tray process
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            for label in ["planner-widget", "calendar-widget"] {
                if let Some(win) = app.get_webview_window(label) {
                    let _ = win.set_decorations(false);
                    let _ = win.set_shadow(false);
                    let _ = win.set_always_on_bottom(true);
                    let _ = win.set_skip_taskbar(true);
                    if label == "planner-widget" {
                        let _ = win.set_size(Size::Logical(LogicalSize::new(760.0, 760.0)));
                        let _ = win.set_position(Position::Physical(PhysicalPosition::new(450, 100)));
                    }
                    let _ = win.show();
                    let _ = win.unminimize();
                }
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
