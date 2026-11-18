import { getDatabase, notifyDatabaseUpdated } from "./database";
import { AppSettings, StorageMode } from "../types/planner";

interface RawAppSettingsRow {
  id: number;
  storage_mode: string;
  github_token: string;
  github_owner: string;
  github_repo: string;
  github_file_path: string;
  google_ical_urls: string;
  calendar_urls?: string;
  accent_color?: string;
}

export const DEFAULT_ACCENT_HEX = "#C94A38";
const ACCENT_STORAGE_KEY = "hobo_accent_color";

export const ACCENT_COLOR_PRESETS = [
  { name: "Hobonichi Red", hex: "#C94A38" },
  { name: "Persimmon Rust", hex: "#C86D3B" },
  { name: "Matcha Moss", hex: "#4E7A56" },
  { name: "Aizome Indigo", hex: "#3B5B8C" },
  { name: "Plum Wine", hex: "#7E4B68" },
  { name: "Sumi Charcoal", hex: "#4A4845" },
];

const DEFAULT_SETTINGS: AppSettings = {
  storage_mode: "local",
  github_token: "",
  github_owner: "",
  github_repo: "",
  github_file_path: "planner-data.json",
  google_ical_urls: "",
  calendar_urls: "",
  accent_color: DEFAULT_ACCENT_HEX,
};

function isValidHexColor(hex: string): boolean {
  return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex.trim());
}

function normalizeHexColor(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${(
      cleaned[0] +
      cleaned[0] +
      cleaned[1] +
      cleaned[1] +
      cleaned[2] +
      cleaned[2]
    ).toUpperCase()}`;
  }
  return DEFAULT_ACCENT_HEX;
}

/**
 * Returns the currently persisted user accent colour without modifying the DOM.
 */
export function getSavedAccentColorSync(): string {
  try {
    const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (stored && isValidHexColor(stored)) {
      return normalizeHexColor(stored);
    }
  } catch {
    // Ignore storage access errors
  }

  if (typeof document !== "undefined") {
    const domHex = document.documentElement.style
      .getPropertyValue("--hobo-accent-hex")
      .trim();
    if (domHex && isValidHexColor(domHex)) {
      return normalizeHexColor(domHex);
    }
  }

  return DEFAULT_ACCENT_HEX;
}

/**
 * Converts a `#RRGGBB` hex string to `"R G B"` space-separated RGB channels
 * and applies `--hobo-accent-rgb` and `--hobo-accent-hex` on `document.documentElement`.
 */
export function applyAccentColorToDom(hexColor: string): void {
  if (typeof document === "undefined") return;
  if (!isValidHexColor(hexColor)) return;

  const normalized = normalizeHexColor(hexColor);
  const cleaned = normalized.slice(1);
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);

  document.documentElement.style.setProperty(
    "--hobo-accent-rgb",
    `${r} ${g} ${b}`
  );
  document.documentElement.style.setProperty("--hobo-accent-hex", normalized);
}

/**
 * Called ONCE on application startup to restore the user's saved accent colour.
 */
export async function initAccentColorOnBoot(): Promise<void> {
  // 1. Apply synchronous localStorage value immediately if present
  try {
    const cached = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (cached && isValidHexColor(cached)) {
      applyAccentColorToDom(cached);
      return;
    }
  } catch {
    // Ignore localStorage error
  }

  // 2. Otherwise check SQLite app_settings once on boot
  try {
    const db = await getDatabase();
    const rows = await db.select<RawAppSettingsRow[]>(
      `SELECT accent_color FROM app_settings WHERE id = 1`
    );
    const dbColor = rows[0]?.accent_color?.trim();
    if (dbColor && isValidHexColor(dbColor)) {
      const normalized = normalizeHexColor(dbColor);
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, normalized);
      } catch {
        // Ignore
      }
      applyAccentColorToDom(normalized);
    }
  } catch {
    // Never overwrite or reset the accent color on error
  }
}

/**
 * Immediately saves and applies a user-selected accent colour to the DOM,
 * `localStorage`, and SQLite (`app_settings.accent_color`).
 */
export async function saveAccentColor(hexColor: string): Promise<void> {
  if (!isValidHexColor(hexColor)) return;
  const normalized = normalizeHexColor(hexColor);

  applyAccentColorToDom(normalized);

  try {
    localStorage.setItem(ACCENT_STORAGE_KEY, normalized);
  } catch {
    // Ignore localStorage error
  }

  try {
    const db = await getDatabase();
    await db.execute(
      `UPDATE app_settings SET accent_color = $1 WHERE id = 1`,
      [normalized]
    );
  } catch (err) {
    console.warn("[appSettingsRepo] Failed to persist accent_color to SQLite:", err);
  }
}

/**
 * Reads the single local `app_settings` row from SQLite (`planner.db`).
 * Pure read: NEVER modifies or resets the active accent colour on the DOM.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const currentAccent = getSavedAccentColorSync();
  try {
    const db = await getDatabase();
    const rows = await db.select<RawAppSettingsRow[]>(
      `SELECT * FROM app_settings WHERE id = 1`
    );
    const row = rows[0];
    if (!row) {
      return {
        ...DEFAULT_SETTINGS,
        accent_color: currentAccent,
      };
    }

    const calendarUrls = (
      row.calendar_urls?.trim() ||
      row.google_ical_urls?.trim() ||
      ""
    );
    const mode: StorageMode =
      row.storage_mode === "github" ? "github" : "local";

    // Prefer user's stored accent in localStorage, then DB row, without ever resetting the DOM
    let resolvedAccent = currentAccent;
    try {
      const localStored = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (localStored && isValidHexColor(localStored)) {
        resolvedAccent = normalizeHexColor(localStored);
      } else if (row.accent_color && isValidHexColor(row.accent_color)) {
        resolvedAccent = normalizeHexColor(row.accent_color);
      }
    } catch {
      if (row.accent_color && isValidHexColor(row.accent_color)) {
        resolvedAccent = normalizeHexColor(row.accent_color);
      }
    }

    return {
      storage_mode: mode,
      github_token: row.github_token ?? "",
      github_owner: row.github_owner ?? "",
      github_repo: row.github_repo ?? "",
      github_file_path: (row.github_file_path || "planner-data.json").trim(),
      google_ical_urls: calendarUrls,
      calendar_urls: calendarUrls,
      accent_color: resolvedAccent,
    };
  } catch (err) {
    console.warn("[appSettingsRepo] Failed to load app_settings:", err);
    return {
      ...DEFAULT_SETTINGS,
      accent_color: currentAccent,
    };
  }
}

/**
 * Saves updated `app_settings` strictly to local SQLite (`planner.db`).
 * Preserves the user's chosen `accent_color` without resetting it.
 */
export async function saveAppSettings(
  settings: AppSettings
): Promise<AppSettings> {
  const db = await getDatabase();
  const normalizedPath =
    settings.github_file_path.trim().replace(/^\/+/, "") || "planner-data.json";
  const accent = isValidHexColor(settings.accent_color)
    ? normalizeHexColor(settings.accent_color)
    : getSavedAccentColorSync();
  const calendarUrls = (
    settings.calendar_urls ??
    settings.google_ical_urls ??
    ""
  ).trim();

  await db.execute(
    `UPDATE app_settings
     SET storage_mode = $1,
         github_token = $2,
         github_owner = $3,
         github_repo = $4,
         github_file_path = $5,
         google_ical_urls = $6,
         calendar_urls = $7,
         accent_color = $8
     WHERE id = 1`,
    [
      settings.storage_mode,
      settings.github_token.trim(),
      settings.github_owner.trim(),
      settings.github_repo.trim(),
      normalizedPath,
      calendarUrls,
      calendarUrls,
      accent,
    ]
  );

  await notifyDatabaseUpdated("app_settings:update");
  return {
    ...settings,
    github_token: settings.github_token.trim(),
    github_owner: settings.github_owner.trim(),
    github_repo: settings.github_repo.trim(),
    github_file_path: normalizedPath,
    google_ical_urls: calendarUrls,
    calendar_urls: calendarUrls,
    accent_color: accent,
  };
}
