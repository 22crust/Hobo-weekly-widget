import { addDays, format, parseISO } from "date-fns";

export type BucketScope = "weekly" | "persistent";

export interface BucketDefinition {
  id: string;
  title: string;
  scope: BucketScope;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface BucketLayoutEntry {
  bucket_id: string;
  visible: boolean;
  height_ratio: number;
}

export interface BucketLayoutSnapshot {
  effective_from_week: string;
  buckets: BucketLayoutEntry[];
  is_explicit_override: boolean;
  updated_at: string;
}

export const BUILTIN_WEEKLY_BUCKET_ID = "weekly";
export const BUILTIN_LONG_TERM_BUCKET_ID = "long_term";
export const MAX_VISIBLE_BUCKETS = 4;
export const MAX_VISIBLE_BUCKETS_MESSAGE =
  "The maximum number of visible lists is 4. Hide a list to add a new one.";

export function getDefaultBucketDefinitions(
  nowIso = "1970-01-01T00:00:00.000Z"
): BucketDefinition[] {
  return [
    {
      id: BUILTIN_WEEKLY_BUCKET_ID,
      title: "Weekly Tasks",
      scope: "weekly",
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    },
    {
      id: BUILTIN_LONG_TERM_BUCKET_ID,
      title: "Long-Term Tasks",
      scope: "persistent",
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
    },
  ];
}

export function newBucketId(): string {
  const hex = "0123456789abcdef";
  let out = "bucket_";
  for (let i = 0; i < 8; i++) {
    out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function isBucketDefinitionActive(def: BucketDefinition): boolean {
  return !def.deleted_at || def.updated_at > def.deleted_at;
}

export function getNextMondayWeekStart(weekStart: string): string {
  return format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd");
}

export function parseBucketsJson(raw: string | null | undefined): BucketLayoutEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        bucket_id: String(item.bucket_id || ""),
        visible: Boolean(item.visible),
        height_ratio:
          typeof item.height_ratio === "number" && Number.isFinite(item.height_ratio)
            ? Math.max(0, item.height_ratio)
            : 0,
      }))
      .filter((item) => item.bucket_id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Normalizes a list of layout entries against active `bucket_definitions`:
 * - Removes deleted/unknown `bucket_id`s
 * - Deduplicates by `bucket_id`
 * - Appends any active `bucket_definitions` missing from `entries` as `{ visible: false, height_ratio: 0 }`
 * - Normalizes `height_ratio` across all `visible: true` entries so they sum to `1.0`
 */
export function normalizeLayoutEntries(
  entries: BucketLayoutEntry[],
  activeDefs: BucketDefinition[]
): BucketLayoutEntry[] {
  const activeIds = new Set(activeDefs.map((d) => d.id));
  const seen = new Set<string>();
  const result: BucketLayoutEntry[] = [];

  for (const entry of entries) {
    if (!activeIds.has(entry.bucket_id) || seen.has(entry.bucket_id)) continue;
    seen.add(entry.bucket_id);
    result.push({
      bucket_id: entry.bucket_id,
      visible: Boolean(entry.visible),
      height_ratio: Math.max(0, Number(entry.height_ratio) || 0),
    });
  }

  for (const def of activeDefs) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      result.push({
        bucket_id: def.id,
        visible: false,
        height_ratio: 0,
      });
    }
  }

  // Enforce max 4 visible lists
  let visibleCount = 0;
  for (const item of result) {
    if (item.visible) {
      if (visibleCount >= MAX_VISIBLE_BUCKETS) {
        item.visible = false;
        item.height_ratio = 0;
      } else {
        visibleCount++;
      }
    } else {
      item.height_ratio = 0;
    }
  }

  if (visibleCount === 0) {
    return result;
  }

  const visibleItems = result.filter((r) => r.visible);
  const PositiveSum = visibleItems.reduce(
    (acc, item) => acc + (item.height_ratio > 0 ? item.height_ratio : 0),
    0
  );

  if (PositiveSum <= 0.0001) {
    const equalRatio = 1 / visibleCount;
    for (const item of visibleItems) {
      item.height_ratio = equalRatio;
    }
    return result;
  }

  // If some visible items have 0 ratio (e.g. just unhidden or added), give them a fair 1/N share
  const zeroItems = visibleItems.filter((i) => i.height_ratio <= 0.0001);
  if (zeroItems.length > 0 && zeroItems.length < visibleCount) {
    const sharePerNew = 1 / visibleCount;
    const remainingShare = Math.max(0.1, 1 - sharePerNew * zeroItems.length);
    for (const item of visibleItems) {
      if (item.height_ratio <= 0.0001) {
        item.height_ratio = sharePerNew;
      } else {
        item.height_ratio = (item.height_ratio / PositiveSum) * remainingShare;
      }
    }
  }

  const totalSum = visibleItems.reduce((acc, item) => acc + item.height_ratio, 0);
  for (const item of visibleItems) {
    item.height_ratio = item.height_ratio / totalSum;
  }

  return result;
}

export function equalizeVisibleRatios(
  entries: BucketLayoutEntry[]
): BucketLayoutEntry[] {
  const visibleCount = entries.filter((e) => e.visible).length;
  if (visibleCount === 0) return entries.map((e) => ({ ...e, height_ratio: 0 }));
  const equal = 1 / visibleCount;
  return entries.map((e) => ({
    ...e,
    height_ratio: e.visible ? equal : 0,
  }));
}

export function getClassicDefaultEntries(
  activeDefs: BucketDefinition[]
): BucketLayoutEntry[] {
  const base: BucketLayoutEntry[] = [
    { bucket_id: BUILTIN_WEEKLY_BUCKET_ID, visible: true, height_ratio: 0.5 },
    { bucket_id: BUILTIN_LONG_TERM_BUCKET_ID, visible: true, height_ratio: 0.5 },
  ];
  return normalizeLayoutEntries(base, activeDefs);
}

/**
 * Resolves the effective layout for `weekStart` (Monday YYYY-MM-DD):
 * Picks the snapshot with the greatest `effective_from_week <= weekStart`,
 * falling back to the classic 2-list default.
 */
export function resolveWeekLayout(
  weekStart: string,
  layouts: BucketLayoutSnapshot[],
  activeDefs: BucketDefinition[]
): BucketLayoutEntry[] {
  let best: BucketLayoutSnapshot | null = null;
  for (const snap of layouts) {
    if (snap.effective_from_week <= weekStart) {
      if (!best || snap.effective_from_week > best.effective_from_week) {
        best = snap;
      }
    }
  }

  if (!best) {
    return getClassicDefaultEntries(activeDefs);
  }
  return normalizeLayoutEntries(best.buckets, activeDefs);
}

export function layoutEntriesEqual(
  a: BucketLayoutEntry[],
  b: BucketLayoutEntry[]
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].bucket_id !== b[i].bucket_id) return false;
    if (a[i].visible !== b[i].visible) return false;
    if (
      a[i].visible &&
      Math.abs((a[i].height_ratio || 0) - (b[i].height_ratio || 0)) > 0.002
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Plans a single-week ("this page only") layout edit on `weekStart`.
 * - Skips writing if `nextEntries` already matches `weekStart`'s current layout.
 * - If `nextEntries` matches what `weekStart` would inherit from earlier weeks without an override,
 *   clears `is_explicit_override = false` on `weekStart` instead of leaving a stale override.
 * - Otherwise writes `weekStart` with `is_explicit_override = true` AND ensures `weekStart + 7 days`
 *   has a snapshot preserving what `weekStart + 7 days` resolved to before this edit,
 *   so the edit never leaks into future weeks.
 */
export function planThisWeekLayoutEdit(
  weekStart: string,
  nextEntries: BucketLayoutEntry[],
  layouts: BucketLayoutSnapshot[],
  activeDefs: BucketDefinition[],
  nowIso = new Date().toISOString()
): BucketLayoutSnapshot[] {
  const normalizedNext = normalizeLayoutEntries(nextEntries, activeDefs);
  const currentResolved = resolveWeekLayout(weekStart, layouts, activeDefs);

  if (layoutEntriesEqual(normalizedNext, currentResolved)) {
    return [];
  }

  const layoutsBeforeThisWeek = layouts.filter(
    (s) => s.effective_from_week < weekStart
  );
  const inheritedFromEarlier = resolveWeekLayout(
    weekStart,
    layoutsBeforeThisWeek,
    activeDefs
  );
  const existingThisWeek = layouts.find(
    (s) => s.effective_from_week === weekStart
  );

  // If the new layout matches what weekStart inherits from earlier weeks, clear any explicit override
  if (layoutEntriesEqual(normalizedNext, inheritedFromEarlier)) {
    if (!existingThisWeek) return [];
    return [
      {
        effective_from_week: weekStart,
        buckets: normalizedNext,
        is_explicit_override: false,
        updated_at: nowIso,
      },
    ];
  }

  const nextWeekStart = getNextMondayWeekStart(weekStart);
  const existingNextWeek = layouts.find(
    (s) => s.effective_from_week === nextWeekStart
  );
  const resolvedNextWeekBeforeEdit = resolveWeekLayout(
    nextWeekStart,
    layouts,
    activeDefs
  );

  const toWrite: BucketLayoutSnapshot[] = [
    {
      effective_from_week: weekStart,
      buckets: normalizedNext,
      is_explicit_override: true,
      updated_at: nowIso,
    },
  ];

  if (!existingNextWeek) {
    toWrite.push({
      effective_from_week: nextWeekStart,
      buckets: resolvedNextWeekBeforeEdit,
      is_explicit_override: false,
      updated_at: nowIso,
    });
  }

  return toWrite;
}

export function findFutureExplicitOverrides(
  weekStart: string,
  layouts: BucketLayoutSnapshot[]
): BucketLayoutSnapshot[] {
  return layouts.filter(
    (s) => s.effective_from_week > weekStart && s.is_explicit_override
  );
}

/**
 * Plans "Set default layout from this week forward" starting at `weekStart`.
 */
export function planSetDefaultLayoutFromWeek(
  weekStart: string,
  defaultEntries: BucketLayoutEntry[],
  layouts: BucketLayoutSnapshot[],
  activeDefs: BucketDefinition[],
  mode: "overwrite_all" | "keep_overrides",
  nowIso = new Date().toISOString()
): BucketLayoutSnapshot[] {
  const normalizedDefault = normalizeLayoutEntries(defaultEntries, activeDefs);
  const byWeek = new Map<string, BucketLayoutSnapshot>();

  byWeek.set(weekStart, {
    effective_from_week: weekStart,
    buckets: normalizedDefault,
    is_explicit_override: false,
    updated_at: nowIso,
  });

  const existingByWeek = new Map<string, BucketLayoutSnapshot>();
  for (const snap of layouts) {
    existingByWeek.set(snap.effective_from_week, snap);
  }

  for (const snap of layouts) {
    if (snap.effective_from_week <= weekStart) continue;

    if (mode === "overwrite_all" || !snap.is_explicit_override) {
      byWeek.set(snap.effective_from_week, {
        effective_from_week: snap.effective_from_week,
        buckets: normalizedDefault,
        is_explicit_override: false,
        updated_at: nowIso,
      });
    } else {
      // Keep explicit override on snap.effective_from_week, and ensure snap + 1 week restores new default
      const restoreWeek = getNextMondayWeekStart(snap.effective_from_week);
      const restoreExisting = existingByWeek.get(restoreWeek);
      if (!restoreExisting || !restoreExisting.is_explicit_override) {
        byWeek.set(restoreWeek, {
          effective_from_week: restoreWeek,
          buckets: normalizedDefault,
          is_explicit_override: false,
          updated_at: nowIso,
        });
      }
    }
  }

  return Array.from(byWeek.values());
}
