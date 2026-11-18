import Database from "@tauri-apps/plugin-sql";
import { UnlistenFn } from "@tauri-apps/api/event";

const DB_NAME = "sqlite:planner.db";
export const DB_UPDATED_EVENT = "planner:db-updated";

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

/**
 * Opens (or returns the cached) SQLite connection to `planner.db` in AppLocalData.
 * Schema creation and upgrades are managed by Rust `tauri_plugin_sql` migrations (`v1..v12`).
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const db = await Database.load(DB_NAME);

      await db.execute(`
        INSERT OR IGNORE INTO app_settings (
          id, storage_mode, github_token, github_owner, github_repo, github_file_path, google_ical_urls, calendar_urls, accent_color
        ) VALUES (1, 'local', '', '', '', 'planner-data.json', '', '', '#C94A38');
      `);

      dbInstance = db;
      return db;
    })();
  }

  return initPromise;
}

/**
 * Broadcasts an in-window event so active views reload their queries once per mutation.
 */
export async function notifyDatabaseUpdated(source?: string): Promise<void> {
  window.dispatchEvent(
    new CustomEvent(DB_UPDATED_EVENT, {
      detail: { source: source ?? "unknown" },
    })
  );
}

/**
 * Subscribes to database change notifications.
 */
export async function onDatabaseUpdated(
  callback: (source?: string) => void
): Promise<UnlistenFn> {
  const domHandler = (e: Event) => {
    const custom = e as CustomEvent<{ source?: string }>;
    callback(custom.detail?.source);
  };
  window.addEventListener(DB_UPDATED_EVENT, domHandler);

  return () => {
    window.removeEventListener(DB_UPDATED_EVENT, domHandler);
  };
}
