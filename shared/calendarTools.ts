export type CalendarToolId =
  | "year_in_days"
  | "mood_tracker"
  | "date_counters";

export type MoodColorKey = "grey" | "red" | "orange" | "yellow" | "green";

export interface CalendarToolMeta {
  id: CalendarToolId;
  title: string;
  description: string;
}

export const ALL_CALENDAR_TOOLS: CalendarToolMeta[] = [
  {
    id: "year_in_days",
    title: "Year in Days",
    description: "Daily progress grid for the current year.",
  },
  {
    id: "mood_tracker",
    title: "Mood Tracker",
    description: "Year-in-pixels daily mood tracker with 5 colours.",
  },
  {
    id: "date_counters",
    title: "Date Counters",
    description: "Count days until or since custom events.",
  },
];

export const DEFAULT_VISIBLE_CALENDAR_TOOLS: CalendarToolId[] = [
  "year_in_days",
];

const VALID_TOOL_IDS = new Set<string>(ALL_CALENDAR_TOOLS.map((t) => t.id));

const TOOLS_STORAGE_KEY = "hobo_calendar_tools_v1";
const TOOLS_UPDATED_AT_KEY = "hobo_calendar_tools_updated_at_v1";
const TOOLS_EVENT = "hobo-calendar-tools-changed";

export function normalizeCalendarToolsList(raw: unknown): CalendarToolId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_VISIBLE_CALENDAR_TOOLS];
  const seen = new Set<CalendarToolId>();
  const out: CalendarToolId[] = [];
  for (const item of raw) {
    if (
      typeof item === "string" &&
      VALID_TOOL_IDS.has(item) &&
      !seen.has(item as CalendarToolId)
    ) {
      seen.add(item as CalendarToolId);
      out.push(item as CalendarToolId);
    }
  }
  return out;
}

export function getSavedCalendarTools(): CalendarToolId[] {
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_VISIBLE_CALENDAR_TOOLS];
    return normalizeCalendarToolsList(JSON.parse(raw));
  } catch {
    return [...DEFAULT_VISIBLE_CALENDAR_TOOLS];
  }
}

export function getSavedCalendarToolsUpdatedAt(): string {
  try {
    return (
      localStorage.getItem(TOOLS_UPDATED_AT_KEY) ||
      "1970-01-01T00:00:00.000Z"
    );
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export function saveCalendarTools(
  tools: CalendarToolId[],
  updatedAt: string = new Date().toISOString()
): CalendarToolId[] {
  const normalized = normalizeCalendarToolsList(tools);
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem(TOOLS_UPDATED_AT_KEY, updatedAt);
  } catch {
    // Ignore storage errors
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOOLS_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function toggleCalendarToolInOrder(
  current: CalendarToolId[],
  toolId: CalendarToolId,
  nextVisible: boolean
): CalendarToolId[] {
  if (nextVisible) {
    if (current.includes(toolId)) return current;
    return [...current, toolId];
  }
  return current.filter((id) => id !== toolId);
}

export function applyRemoteCalendarTools(
  remoteTools?: string[] | null,
  remoteUpdatedAt?: string | null
): boolean {
  if (!Array.isArray(remoteTools)) return false;
  const remoteTs = remoteUpdatedAt || "1970-01-01T00:00:00.000Z";
  if (remoteTs > getSavedCalendarToolsUpdatedAt()) {
    saveCalendarTools(normalizeCalendarToolsList(remoteTools), remoteTs);
    return true;
  }
  return false;
}

export function subscribeCalendarTools(
  callback: (tools: CalendarToolId[]) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const custom = e as CustomEvent<CalendarToolId[]>;
    callback(
      Array.isArray(custom.detail) ? custom.detail : getSavedCalendarTools()
    );
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOOLS_STORAGE_KEY) {
      callback(getSavedCalendarTools());
    }
  };
  window.addEventListener(TOOLS_EVENT, onEvent);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TOOLS_EVENT, onEvent);
    window.removeEventListener("storage", onStorage);
  };
}
