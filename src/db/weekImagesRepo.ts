import { getDatabase, notifyDatabaseUpdated } from "./database";
import { generateUuid } from "../utils/id";
import {
  CreateWeekImageInput,
  UpdateWeekImageInput,
  WeekImage,
} from "../types/planner";

interface RawWeekImageRow {
  id: string;
  week_start: string;
  image_url: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number | null;
  z_index: number;
  is_locked: number;
  rotation?: number;
  crop_top?: number;
  crop_right?: number;
  crop_bottom?: number;
  crop_left?: number;
  opacity?: number;
  is_local_only?: number;
  updated_at: string;
  deleted_at?: string | null;
}

function mapRowToWeekImage(row: RawWeekImageRow): WeekImage {
  return {
    ...row,
    is_locked: Boolean(row.is_locked),
    rotation: row.rotation ?? 0,
    crop_top: row.crop_top ?? 0,
    crop_right: row.crop_right ?? 0,
    crop_bottom: row.crop_bottom ?? 0,
    crop_left: row.crop_left ?? 0,
    opacity: row.opacity ?? 10,
    is_local_only: Boolean(row.is_local_only),
    deleted_at: row.deleted_at ?? null,
  };
}

/**
 * Fetches all syncable URL-based stickers across all weeks, including soft-deleted tombstones
 * (`deleted_at IS NOT NULL`) so GitHub sync can propagate deletions across devices.
 * Excludes local-PC file stickers (`is_local_only = 1`), which are never synced to GitHub.
 */
export async function getAllWeekImages(): Promise<WeekImage[]> {
  const db = await getDatabase();
  const rows = await db.select<RawWeekImageRow[]>(
    `SELECT *
     FROM week_images
     WHERE COALESCE(is_local_only, 0) = 0
     ORDER BY week_start ASC, z_index ASC, updated_at ASC`
  );
  return rows.map(mapRowToWeekImage);
}

/**
 * Fetches all active (non-deleted) stickers belonging to a specific week (`weekStart` Monday YYYY-MM-DD).
 * Hides items where `deleted_at` is set (`deleted_at IS NULL` or `updated_at > deleted_at`).
 */
export async function getWeekImagesForWeek(
  weekStart: string
): Promise<WeekImage[]> {
  const db = await getDatabase();
  const rows = await db.select<RawWeekImageRow[]>(
    `SELECT *
     FROM week_images
     WHERE week_start = $1
       AND (deleted_at IS NULL OR updated_at > deleted_at)
     ORDER BY z_index ASC, updated_at ASC`,
    [weekStart]
  );
  return rows.map(mapRowToWeekImage);
}

/**
 * Inserts a newly pasted sticker image into `week_images` and triggers a database update.
 */
export async function createWeekImage(
  input: CreateWeekImageInput
): Promise<WeekImage> {
  const db = await getDatabase();
  const id = input.id ?? generateUuid();
  const nowIso = new Date().toISOString();
  const width = input.width ?? 180;
  const height = input.height ?? null;
  const zIndex = input.z_index ?? 10;
  const isLocked = input.is_locked ?? false;
  const rotation = input.rotation ?? 0;
  const cropTop = input.crop_top ?? 0;
  const cropRight = input.crop_right ?? 0;
  const cropBottom = input.crop_bottom ?? 0;
  const cropLeft = input.crop_left ?? 0;
  const opacity = input.opacity ?? 10;
  const isLocalOnly = input.is_local_only ? 1 : 0;

  await db.execute(
    `INSERT INTO week_images (
      id, week_start, image_url, pos_x, pos_y, width, height, z_index, is_locked,
      rotation, crop_top, crop_right, crop_bottom, crop_left, opacity, is_local_only, updated_at, deleted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NULL)`,
    [
      id,
      input.week_start,
      input.image_url.trim(),
      input.pos_x,
      input.pos_y,
      width,
      height,
      zIndex,
      isLocked ? 1 : 0,
      rotation,
      cropTop,
      cropRight,
      cropBottom,
      cropLeft,
      opacity,
      isLocalOnly,
      nowIso,
    ]
  );

  await notifyDatabaseUpdated("week_images:create");
  return {
    id,
    week_start: input.week_start,
    image_url: input.image_url.trim(),
    pos_x: input.pos_x,
    pos_y: input.pos_y,
    width,
    height,
    z_index: zIndex,
    is_locked: isLocked,
    rotation,
    crop_top: cropTop,
    crop_right: cropRight,
    crop_bottom: cropBottom,
    crop_left: cropLeft,
    opacity,
    updated_at: nowIso,
    deleted_at: null,
  };
}

/**
 * Updates position, dimensions, rotation, crop insets, `z_index`, or `is_locked`
 * of an existing sticker, clears `deleted_at`, and bumps `updated_at`.
 */
export async function updateWeekImage(
  id: string,
  updates: UpdateWeekImageInput
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<RawWeekImageRow[]>(
    `SELECT * FROM week_images WHERE id = $1`,
    [id]
  );
  const current = rows[0];
  if (!current) return;

  const nowIso = new Date().toISOString();
  const nextPosX = updates.pos_x !== undefined ? updates.pos_x : current.pos_x;
  const nextPosY = updates.pos_y !== undefined ? updates.pos_y : current.pos_y;
  const nextWidth = updates.width !== undefined ? updates.width : current.width;
  const nextHeight =
    updates.height !== undefined ? updates.height : current.height;
  const nextZIndex =
    updates.z_index !== undefined ? updates.z_index : current.z_index;
  const nextLocked =
    updates.is_locked !== undefined
      ? updates.is_locked
        ? 1
        : 0
      : current.is_locked;
  const nextRotation =
    updates.rotation !== undefined ? updates.rotation : current.rotation ?? 0;
  const nextCropTop =
    updates.crop_top !== undefined ? updates.crop_top : current.crop_top ?? 0;
  const nextCropRight =
    updates.crop_right !== undefined
      ? updates.crop_right
      : current.crop_right ?? 0;
  const nextCropBottom =
    updates.crop_bottom !== undefined
      ? updates.crop_bottom
      : current.crop_bottom ?? 0;
  const nextCropLeft =
    updates.crop_left !== undefined ? updates.crop_left : current.crop_left ?? 0;
  const nextOpacity =
    updates.opacity !== undefined ? updates.opacity : current.opacity ?? 10;

  await db.execute(
    `UPDATE week_images
     SET pos_x = $1,
         pos_y = $2,
         width = $3,
         height = $4,
         z_index = $5,
         is_locked = $6,
         rotation = $7,
         crop_top = $8,
         crop_right = $9,
         crop_bottom = $10,
         crop_left = $11,
         opacity = $12,
         updated_at = $13,
         deleted_at = NULL
     WHERE id = $14`,
    [
      nextPosX,
      nextPosY,
      nextWidth,
      nextHeight,
      nextZIndex,
      nextLocked,
      nextRotation,
      nextCropTop,
      nextCropRight,
      nextCropBottom,
      nextCropLeft,
      nextOpacity,
      nowIso,
      id,
    ]
  );

  await notifyDatabaseUpdated("week_images:update");
}

/**
 * Soft-deletes a sticker by setting `deleted_at` (and `updated_at`) to the current ISO 8601 timestamp.
 */
export async function deleteWeekImage(id: string): Promise<void> {
  const db = await getDatabase();
  const nowIso = new Date().toISOString();
  await db.execute(
    `UPDATE week_images
     SET deleted_at = $1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, id]
  );
  await notifyDatabaseUpdated("week_images:delete");
}
