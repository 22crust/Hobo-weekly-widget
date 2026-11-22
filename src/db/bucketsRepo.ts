import {
  BucketDefinition,
  BucketLayoutSnapshot,
  BucketScope,
  getDefaultBucketDefinitions,
  isBucketDefinitionActive,
  newBucketId,
  parseBucketsJson,
} from "../../shared/buckets";
import { getDatabase, notifyDatabaseUpdated } from "./database";

interface RawBucketDefinitionRow {
  id: string;
  title: string;
  scope: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface RawBucketLayoutRow {
  effective_from_week: string;
  buckets_json: string;
  is_explicit_override: number;
  updated_at: string;
}

function mapRowToBucketDefinition(row: RawBucketDefinitionRow): BucketDefinition {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope === "persistent" ? "persistent" : "weekly",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

function mapRowToBucketLayout(row: RawBucketLayoutRow): BucketLayoutSnapshot {
  return {
    effective_from_week: row.effective_from_week,
    buckets: parseBucketsJson(row.buckets_json),
    is_explicit_override: Boolean(row.is_explicit_override),
    updated_at: row.updated_at,
  };
}

export async function getAllBucketDefinitionsForBackup(): Promise<BucketDefinition[]> {
  const db = await getDatabase();
  const rows = await db.select<RawBucketDefinitionRow[]>(
    `SELECT * FROM bucket_definitions ORDER BY created_at ASC, id ASC`
  );
  if (rows.length === 0) {
    const defaults = getDefaultBucketDefinitions();
    for (const def of defaults) {
      await db.execute(
        `INSERT OR IGNORE INTO bucket_definitions (id, title, scope, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [def.id, def.title, def.scope, def.created_at, def.updated_at]
      );
    }
    return defaults;
  }
  return rows.map(mapRowToBucketDefinition);
}

export async function getActiveBucketDefinitions(): Promise<BucketDefinition[]> {
  const all = await getAllBucketDefinitionsForBackup();
  return all.filter(isBucketDefinitionActive);
}

export async function getAllBucketLayouts(): Promise<BucketLayoutSnapshot[]> {
  const db = await getDatabase();
  const rows = await db.select<RawBucketLayoutRow[]>(
    `SELECT * FROM bucket_layouts ORDER BY effective_from_week ASC`
  );
  return rows.map(mapRowToBucketLayout);
}

export async function createBucketDefinition(
  title: string,
  scope: BucketScope
): Promise<BucketDefinition> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  const cleanTitle = title.trim() || (scope === "persistent" ? "Long-Term List" : "Weekly List");
  const def: BucketDefinition = {
    id: newBucketId(),
    title: cleanTitle,
    scope,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
  };

  await db.execute(
    `INSERT INTO bucket_definitions (id, title, scope, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, NULL)`,
    [def.id, def.title, def.scope, def.created_at, def.updated_at]
  );

  await notifyDatabaseUpdated("bucket_definitions:create");
  return def;
}

export async function renameBucketDefinition(
  id: string,
  newTitle: string
): Promise<void> {
  const trimmed = newTitle.trim();
  if (!trimmed) return;
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  await db.execute(
    `UPDATE bucket_definitions
     SET title = $1,
         updated_at = $2
     WHERE id = $3`,
    [trimmed, nowIso, id]
  );
  await notifyDatabaseUpdated("bucket_definitions:rename");
}

export async function saveBucketLayoutSnapshots(
  snapshots: BucketLayoutSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) return;
  const db = await getDatabase();
  for (const snap of snapshots) {
    await db.execute(
      `INSERT INTO bucket_layouts (effective_from_week, buckets_json, is_explicit_override, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(effective_from_week) DO UPDATE SET
         buckets_json = excluded.buckets_json,
         is_explicit_override = excluded.is_explicit_override,
         updated_at = excluded.updated_at`,
      [
        snap.effective_from_week,
        JSON.stringify(snap.buckets),
        snap.is_explicit_override ? 1 : 0,
        snap.updated_at,
      ]
    );
  }
  await notifyDatabaseUpdated("bucket_layouts:update");
}

export async function countActiveTasksInBucket(
  bucketId: string
): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) AS cnt
     FROM local_tasks
     WHERE show_in_sidebar = 1
       AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $1
       AND (deleted_at IS NULL OR updated_at > deleted_at)`,
    [bucketId]
  );
  return rows[0]?.cnt ?? 0;
}

export async function permanentlyDeleteHiddenBucket(
  bucketId: string
): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();

  await db.execute(
    `UPDATE bucket_definitions
     SET deleted_at = $1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, bucketId]
  );

  await db.execute(
    `UPDATE local_tasks
     SET deleted_at = $1,
         updated_at = $1
     WHERE show_in_sidebar = 1
       AND COALESCE(bucket_id, CASE WHEN is_long_term = 1 THEN 'long_term' ELSE 'weekly' END) = $2
       AND (deleted_at IS NULL OR updated_at > deleted_at)`,
    [nowIso, bucketId]
  );

  const layouts = await getAllBucketLayouts();
  for (const snap of layouts) {
    const filtered = snap.buckets.filter((b) => b.bucket_id !== bucketId);
    if (filtered.length !== snap.buckets.length) {
      await db.execute(
        `UPDATE bucket_layouts
         SET buckets_json = $1,
             updated_at = $2
         WHERE effective_from_week = $3`,
        [JSON.stringify(filtered), nowIso, snap.effective_from_week]
      );
    }
  }

  await notifyDatabaseUpdated("bucket_definitions:delete");
}
