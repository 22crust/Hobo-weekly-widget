import {
  getEffectiveTimestamp,
  mergeRecordTimestamps,
  resolveSoftDeleteWinner,
} from "../../shared/plannerCore";
import {
  BucketDefinition,
  BucketLayoutSnapshot,
  LocalEvent,
  LocalTask,
  NotePage,
  WeekImage,
} from "../types/planner";
import { generateUuid } from "../utils/id";
import {
  getAllBucketDefinitionsForBackup,
  getAllBucketLayouts,
} from "./bucketsRepo";
import { getDatabase, notifyDatabaseUpdated } from "./database";
import { getAllLocalEventsForBackup } from "./localEventsRepo";
import { getAllLocalTasks } from "./localTasksRepo";
import { getAllNotePagesForBackup } from "./notePagesRepo";
import { getAllWeekImages } from "./weekImagesRepo";

/**
 * Upserts remote GitHub backup collections into local SQLite by record key,
 * keeping whichever timestamp (`updated_at` vs. `deleted_at`) is newest.
 */
export async function upsertRemoteBackupIntoLocal(
  remoteTasks: LocalTask[],
  remoteImages: WeekImage[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = []
): Promise<number> {
  const db = await getDatabase();
  const localTasks = await getAllLocalTasks();
  const localBySyncId = new Map<string, LocalTask>();
  const localById = new Map<number, LocalTask>();
  for (const lt of localTasks) {
    if (lt.sync_id && lt.sync_id.trim() !== "") {
      localBySyncId.set(lt.sync_id.trim(), lt);
    }
    localById.set(lt.id, lt);
  }

  let upsertedCount = 0;

  for (const rawRt of remoteTasks) {
    const rt = resolveSoftDeleteWinner({
      ...rawRt,
      updated_at:
        rawRt.updated_at || rawRt.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawRt.deleted_at ?? null,
    });

    const remoteSyncId =
      rt.sync_id && rt.sync_id.trim() !== "" ? rt.sync_id.trim() : null;
    const existing = remoteSyncId
      ? localBySyncId.get(remoteSyncId)
      : localById.get(rt.id);
    const remoteEffective = getEffectiveTimestamp(rt);
    const localEffective = existing ? getEffectiveTimestamp(existing) : "";

    if (!existing) {
      const resolvedSyncId = remoteSyncId || generateUuid();
      const resolvedBucketId =
        rt.bucket_id && rt.bucket_id.trim() !== ""
          ? rt.bucket_id.trim()
          : rt.is_long_term
          ? "long_term"
          : "weekly";
      await db.execute(
        `INSERT INTO local_tasks (
          sync_id, title, notes, assigned_date, assigned_week_start, is_long_term, bucket_id,
          start_time, end_time, is_completed, show_in_weekly, show_in_sidebar,
          sort_order, created_at, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          resolvedSyncId,
          rt.title,
          rt.notes,
          rt.assigned_date,
          rt.assigned_week_start,
          rt.is_long_term ? 1 : 0,
          resolvedBucketId,
          rt.start_time,
          rt.end_time,
          rt.is_completed ? 1 : 0,
          rt.show_in_weekly ? 1 : 0,
          rt.show_in_sidebar ? 1 : 0,
          rt.sort_order,
          rt.created_at || rt.updated_at,
          rt.updated_at,
          rt.deleted_at,
        ]
      );
      upsertedCount++;
    } else if (remoteEffective > localEffective) {
      const { updated_at: newestUpdated, deleted_at: winningDeleted } =
        mergeRecordTimestamps(existing, rt);
      const resolvedSyncId =
        remoteSyncId || existing.sync_id || generateUuid();
      const resolvedBucketId =
        rt.bucket_id && rt.bucket_id.trim() !== ""
          ? rt.bucket_id.trim()
          : existing.bucket_id && existing.bucket_id.trim() !== ""
          ? existing.bucket_id.trim()
          : rt.is_long_term
          ? "long_term"
          : "weekly";

      await db.execute(
        `UPDATE local_tasks
         SET sync_id = $1,
             title = $2,
             notes = $3,
             assigned_date = $4,
             assigned_week_start = $5,
             is_long_term = $6,
             bucket_id = $7,
             start_time = $8,
             end_time = $9,
             is_completed = $10,
             show_in_weekly = $11,
             show_in_sidebar = $12,
             sort_order = $13,
             created_at = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          resolvedSyncId,
          rt.title,
          rt.notes,
          rt.assigned_date,
          rt.assigned_week_start,
          rt.is_long_term ? 1 : 0,
          resolvedBucketId,
          rt.start_time,
          rt.end_time,
          rt.is_completed ? 1 : 0,
          rt.show_in_weekly ? 1 : 0,
          rt.show_in_sidebar ? 1 : 0,
          rt.sort_order,
          rt.created_at || existing.created_at,
          newestUpdated,
          winningDeleted,
          existing.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localImages = await getAllWeekImages();
  const localImgMap = new Map<string, WeekImage>();
  for (const li of localImages) {
    localImgMap.set(li.id, li);
  }

  for (const rawImg of remoteImages) {
    const img = resolveSoftDeleteWinner({
      ...rawImg,
      updated_at: rawImg.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawImg.deleted_at ?? null,
    });

    const existingImg = localImgMap.get(img.id);
    const remoteEffective = getEffectiveTimestamp(img);
    const localEffective = existingImg ? getEffectiveTimestamp(existingImg) : "";

    if (!existingImg) {
      await db.execute(
        `INSERT INTO week_images (
          id, week_start, image_url, pos_x, pos_y, width, height, z_index, is_locked,
          rotation, crop_top, crop_right, crop_bottom, crop_left, opacity, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          img.id,
          img.week_start,
          img.image_url,
          img.pos_x,
          img.pos_y,
          img.width,
          img.height ?? null,
          img.z_index ?? 10,
          img.is_locked ? 1 : 0,
          img.rotation ?? 0,
          img.crop_top ?? 0,
          img.crop_right ?? 0,
          img.crop_bottom ?? 0,
          img.crop_left ?? 0,
          img.opacity ?? 10,
          img.updated_at,
          img.deleted_at,
        ]
      );
      upsertedCount++;
    } else if (remoteEffective > localEffective) {
      const { updated_at: newestUpdated, deleted_at: winningDeleted } =
        mergeRecordTimestamps(existingImg, img);

      await db.execute(
        `UPDATE week_images
         SET week_start = $1,
             image_url = $2,
             pos_x = $3,
             pos_y = $4,
             width = $5,
             height = $6,
             z_index = $7,
             is_locked = $8,
             rotation = $9,
             crop_top = $10,
             crop_right = $11,
             crop_bottom = $12,
             crop_left = $13,
             opacity = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          img.week_start,
          img.image_url,
          img.pos_x,
          img.pos_y,
          img.width,
          img.height ?? null,
          img.z_index ?? 10,
          img.is_locked ? 1 : 0,
          img.rotation ?? 0,
          img.crop_top ?? 0,
          img.crop_right ?? 0,
          img.crop_bottom ?? 0,
          img.crop_left ?? 0,
          img.opacity ?? 10,
          newestUpdated,
          winningDeleted,
          img.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localEvents = await getAllLocalEventsForBackup();
  const localEventMap = new Map<string, LocalEvent>();
  for (const ev of localEvents) {
    localEventMap.set(ev.id, ev);
  }

  for (const rawEv of remoteLocalEvents) {
    if (!rawEv.id) continue;
    const ev = resolveSoftDeleteWinner({
      ...rawEv,
      created_at:
        rawEv.created_at || rawEv.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at:
        rawEv.updated_at || rawEv.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawEv.deleted_at ?? null,
    });
    const existingEv = localEventMap.get(ev.id);
    const remoteEff = getEffectiveTimestamp(ev);
    const localEff = existingEv ? getEffectiveTimestamp(existingEv) : "";

    if (!existingEv) {
      await db.execute(
        `INSERT INTO local_events (
          id, title, location, event_date, start_time, end_time,
          is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
          repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at, deleted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          ev.id,
          ev.title,
          ev.location ?? null,
          ev.event_date,
          ev.start_time ?? null,
          ev.end_time ?? null,
          ev.is_all_day ? 1 : 0,
          ev.is_repeating ? 1 : 0,
          ev.repeat_type ?? null,
          Math.max(1, ev.repeat_interval || 1),
          ev.repeat_unit ?? null,
          ev.repeat_end_date ?? null,
          JSON.stringify(
            Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []
          ),
          JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
          ev.created_at,
          ev.updated_at,
          ev.deleted_at ?? null,
        ]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const { updated_at: newestUpdated, deleted_at: winningDeleted } =
        mergeRecordTimestamps(existingEv, ev);

      await db.execute(
        `UPDATE local_events
         SET title = $1,
             location = $2,
             event_date = $3,
             start_time = $4,
             end_time = $5,
             is_all_day = $6,
             is_repeating = $7,
             repeat_type = $8,
             repeat_interval = $9,
             repeat_unit = $10,
             repeat_end_date = $11,
             excluded_dates = $12,
             hidden_dates = $13,
             created_at = $14,
             updated_at = $15,
             deleted_at = $16
         WHERE id = $17`,
        [
          ev.title,
          ev.location ?? null,
          ev.event_date,
          ev.start_time ?? null,
          ev.end_time ?? null,
          ev.is_all_day ? 1 : 0,
          ev.is_repeating ? 1 : 0,
          ev.repeat_type ?? null,
          Math.max(1, ev.repeat_interval || 1),
          ev.repeat_unit ?? null,
          ev.repeat_end_date ?? null,
          JSON.stringify(
            Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []
          ),
          JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
          ev.created_at || existingEv.created_at,
          newestUpdated,
          winningDeleted,
          ev.id,
        ]
      );
      upsertedCount++;
    }
  }

  const localNotePages = await getAllNotePagesForBackup();
  const localNoteMap = new Map<string, NotePage>();
  for (const np of localNotePages) {
    localNoteMap.set(np.id, np);
  }

  for (const rawNp of remoteNotePages) {
    if (!rawNp.id) continue;
    const np = resolveSoftDeleteWinner({
      ...rawNp,
      updated_at: rawNp.updated_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawNp.deleted_at ?? null,
    });
    const existingNp = localNoteMap.get(np.id);
    const remoteEff = getEffectiveTimestamp(np);
    const localEff = existingNp ? getEffectiveTimestamp(existingNp) : "";

    if (!existingNp) {
      await db.execute(
        `INSERT INTO note_pages (id, page_order, content, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          np.id,
          np.page_order,
          np.content ?? "",
          np.updated_at,
          np.deleted_at ?? null,
        ]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const { updated_at: newestUpdated, deleted_at: winningDeleted } =
        mergeRecordTimestamps(existingNp, np);

      await db.execute(
        `UPDATE note_pages
         SET page_order = $1,
             content = $2,
             updated_at = $3,
             deleted_at = $4
         WHERE id = $5`,
        [np.page_order, np.content ?? "", newestUpdated, winningDeleted, np.id]
      );
      upsertedCount++;
    }
  }

  const localBucketDefs = await getAllBucketDefinitionsForBackup();
  const localBucketDefMap = new Map<string, BucketDefinition>();
  for (const bd of localBucketDefs) {
    localBucketDefMap.set(bd.id, bd);
  }

  for (const rawBd of remoteBucketDefs) {
    if (!rawBd.id) continue;
    const bd = resolveSoftDeleteWinner({
      ...rawBd,
      scope:
        rawBd.scope === "persistent"
          ? ("persistent" as const)
          : ("weekly" as const),
      created_at:
        rawBd.created_at || rawBd.updated_at || "1970-01-01T00:00:00.000Z",
      updated_at:
        rawBd.updated_at || rawBd.created_at || "1970-01-01T00:00:00.000Z",
      deleted_at: rawBd.deleted_at ?? null,
    });
    const existingBd = localBucketDefMap.get(bd.id);
    const remoteEff = getEffectiveTimestamp(bd);
    const localEff = existingBd ? getEffectiveTimestamp(existingBd) : "";

    if (!existingBd) {
      const bdKind = bd.kind === "text" ? "text" : "tasks";
      await db.execute(
        `INSERT INTO bucket_definitions (id, title, scope, kind, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          bd.id,
          bd.title,
          bd.scope,
          bdKind,
          bd.created_at,
          bd.updated_at,
          bd.deleted_at ?? null,
        ]
      );
      upsertedCount++;
    } else if (remoteEff > localEff) {
      const bdKind = bd.kind === "text" ? "text" : "tasks";
      const { updated_at: newestUpdated, deleted_at: winningDeleted } =
        mergeRecordTimestamps(existingBd, bd);

      await db.execute(
        `UPDATE bucket_definitions
         SET title = $1,
             scope = $2,
             kind = $3,
             updated_at = $4,
             deleted_at = $5
         WHERE id = $6`,
        [bd.title, bd.scope, bdKind, newestUpdated, winningDeleted, bd.id]
      );
      upsertedCount++;
    }
  }

  const localBucketLayouts = await getAllBucketLayouts();
  const localLayoutMap = new Map<string, BucketLayoutSnapshot>();
  for (const bl of localBucketLayouts) {
    localLayoutMap.set(bl.effective_from_week, bl);
  }

  for (const rawBl of remoteBucketLayouts) {
    if (!rawBl.effective_from_week) continue;
    const existingBl = localLayoutMap.get(rawBl.effective_from_week);
    const remoteUpdated = rawBl.updated_at || "1970-01-01T00:00:00.000Z";
    const localUpdated = existingBl?.updated_at || "";

    if (!existingBl || remoteUpdated > localUpdated) {
      await db.execute(
        `INSERT INTO bucket_layouts (effective_from_week, buckets_json, is_explicit_override, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(effective_from_week) DO UPDATE SET
           buckets_json = excluded.buckets_json,
           is_explicit_override = excluded.is_explicit_override,
           updated_at = excluded.updated_at`,
        [
          rawBl.effective_from_week,
          JSON.stringify(Array.isArray(rawBl.buckets) ? rawBl.buckets : []),
          rawBl.is_explicit_override ? 1 : 0,
          remoteUpdated,
        ]
      );
      upsertedCount++;
    }
  }

  if (upsertedCount > 0) {
    await notifyDatabaseUpdated("github_sync:pull_upsert");
  }
  return upsertedCount;
}

/**
 * Replaces local SQLite backup tables with the given remote dataset.
 */
export async function replaceAllLocalDataWithRemote(
  remoteTasks: LocalTask[],
  remoteImages: WeekImage[],
  remoteLocalEvents: LocalEvent[] = [],
  remoteNotePages: NotePage[] = [],
  remoteBucketDefs: BucketDefinition[] = [],
  remoteBucketLayouts: BucketLayoutSnapshot[] = []
): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM local_tasks`);
  await db.execute(
    `DELETE FROM week_images WHERE COALESCE(is_local_only, 0) = 0`
  );
  await db.execute(`DELETE FROM local_events`);
  await db.execute(`DELETE FROM note_pages`);
  await db.execute(`DELETE FROM bucket_definitions`);
  await db.execute(`DELETE FROM bucket_layouts`);

  for (const rawRt of remoteTasks) {
    const rt = resolveSoftDeleteWinner({
      ...rawRt,
      updated_at:
        rawRt.updated_at || rawRt.created_at || new Date().toISOString(),
      deleted_at: rawRt.deleted_at ?? null,
    });
    const resolvedSyncId =
      rt.sync_id && rt.sync_id.trim() !== "" ? rt.sync_id.trim() : generateUuid();
    const resolvedBucketId =
      rt.bucket_id && rt.bucket_id.trim() !== ""
        ? rt.bucket_id.trim()
        : rt.is_long_term
        ? "long_term"
        : "weekly";
    await db.execute(
      `INSERT INTO local_tasks (
        sync_id, title, notes, assigned_date, assigned_week_start, is_long_term, bucket_id,
        start_time, end_time, is_completed, show_in_weekly, show_in_sidebar,
        sort_order, created_at, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        resolvedSyncId,
        rt.title,
        rt.notes,
        rt.assigned_date,
        rt.assigned_week_start,
        rt.is_long_term ? 1 : 0,
        resolvedBucketId,
        rt.start_time,
        rt.end_time,
        rt.is_completed ? 1 : 0,
        rt.show_in_weekly ? 1 : 0,
        rt.show_in_sidebar ? 1 : 0,
        rt.sort_order,
        rt.created_at || rt.updated_at,
        rt.updated_at,
        rt.deleted_at,
      ]
    );
  }

  for (const rawImg of remoteImages) {
    const img = resolveSoftDeleteWinner({
      ...rawImg,
      updated_at: rawImg.updated_at || new Date().toISOString(),
      deleted_at: rawImg.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO week_images (
        id, week_start, image_url, pos_x, pos_y, width, height, z_index, is_locked,
        rotation, crop_top, crop_right, crop_bottom, crop_left, opacity, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        img.id,
        img.week_start,
        img.image_url,
        img.pos_x,
        img.pos_y,
        img.width,
        img.height ?? null,
        img.z_index ?? 10,
        img.is_locked ? 1 : 0,
        img.rotation ?? 0,
        img.crop_top ?? 0,
        img.crop_right ?? 0,
        img.crop_bottom ?? 0,
        img.crop_left ?? 0,
        img.opacity ?? 10,
        img.updated_at,
        img.deleted_at,
      ]
    );
  }

  for (const rawEv of remoteLocalEvents) {
    if (!rawEv.id) continue;
    const ev = resolveSoftDeleteWinner({
      ...rawEv,
      created_at:
        rawEv.created_at || rawEv.updated_at || new Date().toISOString(),
      updated_at:
        rawEv.updated_at || rawEv.created_at || new Date().toISOString(),
      deleted_at: rawEv.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO local_events (
        id, title, location, event_date, start_time, end_time,
        is_all_day, is_repeating, repeat_type, repeat_interval, repeat_unit,
        repeat_end_date, excluded_dates, hidden_dates, created_at, updated_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        ev.id,
        ev.title,
        ev.location ?? null,
        ev.event_date,
        ev.start_time ?? null,
        ev.end_time ?? null,
        ev.is_all_day ? 1 : 0,
        ev.is_repeating ? 1 : 0,
        ev.repeat_type ?? null,
        Math.max(1, ev.repeat_interval || 1),
        ev.repeat_unit ?? null,
        ev.repeat_end_date ?? null,
        JSON.stringify(
          Array.isArray(ev.excluded_dates) ? ev.excluded_dates : []
        ),
        JSON.stringify(Array.isArray(ev.hidden_dates) ? ev.hidden_dates : []),
        ev.created_at,
        ev.updated_at,
        ev.deleted_at ?? null,
      ]
    );
  }

  for (const rawNp of remoteNotePages) {
    if (!rawNp.id) continue;
    const np = resolveSoftDeleteWinner({
      ...rawNp,
      updated_at: rawNp.updated_at || new Date().toISOString(),
      deleted_at: rawNp.deleted_at ?? null,
    });
    await db.execute(
      `INSERT INTO note_pages (id, page_order, content, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        np.id,
        np.page_order,
        np.content ?? "",
        np.updated_at,
        np.deleted_at ?? null,
      ]
    );
  }

  for (const rawBd of remoteBucketDefs) {
    if (!rawBd.id) continue;
    const bd = resolveSoftDeleteWinner({
      ...rawBd,
      scope:
        rawBd.scope === "persistent"
          ? ("persistent" as const)
          : ("weekly" as const),
      created_at:
        rawBd.created_at || rawBd.updated_at || new Date().toISOString(),
      updated_at:
        rawBd.updated_at || rawBd.created_at || new Date().toISOString(),
      deleted_at: rawBd.deleted_at ?? null,
    });
    const bdKind = bd.kind === "text" ? "text" : "tasks";
    await db.execute(
      `INSERT INTO bucket_definitions (id, title, scope, kind, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        bd.id,
        bd.title,
        bd.scope,
        bdKind,
        bd.created_at,
        bd.updated_at,
        bd.deleted_at ?? null,
      ]
    );
  }

  // Ensure built-in weekly/long_term exist if remote payload came from an older version without bucket_definitions
  await getAllBucketDefinitionsForBackup();

  for (const rawBl of remoteBucketLayouts) {
    if (!rawBl.effective_from_week) continue;
    await db.execute(
      `INSERT INTO bucket_layouts (effective_from_week, buckets_json, is_explicit_override, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [
        rawBl.effective_from_week,
        JSON.stringify(Array.isArray(rawBl.buckets) ? rawBl.buckets : []),
        rawBl.is_explicit_override ? 1 : 0,
        rawBl.updated_at || new Date().toISOString(),
      ]
    );
  }

  await notifyDatabaseUpdated("github_sync:replace_all");
}
