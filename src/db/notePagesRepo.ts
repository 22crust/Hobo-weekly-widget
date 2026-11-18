import { getDatabase, notifyDatabaseUpdated } from "./database";
import { generateUuid } from "../utils/id";
import { NotePage } from "../types/planner";

interface RawNotePageRow {
  id: string;
  page_order: number;
  content: string;
  updated_at: string;
}

let seedInFlightPromise: Promise<NotePage[]> | null = null;

/**
 * Fetches all note pages ordered by `page_order ASC`.
 * Automatically seeds 3 blank pages by default if none exist yet (serialized to prevent duplicate seeding).
 */
export async function getAllNotePages(): Promise<NotePage[]> {
  const db = await getDatabase();
  const rows = await db.select<RawNotePageRow[]>(
    `SELECT * FROM note_pages ORDER BY page_order ASC`
  );

  if (rows.length > 0) {
    return rows;
  }

  if (seedInFlightPromise) {
    return seedInFlightPromise;
  }

  seedInFlightPromise = (async () => {
    const recheck = await db.select<RawNotePageRow[]>(
      `SELECT * FROM note_pages ORDER BY page_order ASC`
    );
    if (recheck.length > 0) {
      return recheck;
    }

    // Seed 3 blank pages by default
    const now = new Date().toISOString();
    const seeded: NotePage[] = [];
    for (let i = 1; i <= 3; i++) {
      const page: NotePage = {
        id: generateUuid(),
        page_order: i,
        content: "",
        updated_at: now,
      };
      await db.execute(
        `INSERT INTO note_pages (id, page_order, content, updated_at)
         VALUES ($1, $2, $3, $4)`,
        [page.id, page.page_order, page.content, page.updated_at]
      );
      seeded.push(page);
    }
    return seeded;
  })();

  try {
    return await seedInFlightPromise;
  } finally {
    seedInFlightPromise = null;
  }
}

/**
 * Updates the text content of a note page.
 */
export async function updateNotePageContent(
  id: string,
  content: string
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE note_pages SET content = $1, updated_at = $2 WHERE id = $3`,
    [content, now, id]
  );
  await notifyDatabaseUpdated("note_pages:update");
}

/**
 * Inserts a new blank note page immediately after `afterPageId`
 * and shifts subsequent pages' `page_order` by +1.
 */
export async function insertNotePageAfter(
  afterPageId: string
): Promise<NotePage> {
  const db = await getDatabase();
  const pages = await getAllNotePages();
  const targetIdx = pages.findIndex((p) => p.id === afterPageId);
  const insertOrder =
    targetIdx >= 0 ? pages[targetIdx].page_order + 1 : pages.length + 1;

  await db.execute(
    `UPDATE note_pages SET page_order = page_order + 1 WHERE page_order >= $1`,
    [insertOrder]
  );

  const now = new Date().toISOString();
  const newPage: NotePage = {
    id: generateUuid(),
    page_order: insertOrder,
    content: "",
    updated_at: now,
  };

  await db.execute(
    `INSERT INTO note_pages (id, page_order, content, updated_at)
     VALUES ($1, $2, '', $3)`,
    [newPage.id, newPage.page_order, newPage.updated_at]
  );

  await notifyDatabaseUpdated("note_pages:insert");
  return newPage;
}

/**
 * Deletes a note page (keeping at least 1 page), renumbers remaining pages,
 * and cleans up any stickers attached to that page.
 */
export async function deleteNotePage(id: string): Promise<void> {
  const db = await getDatabase();
  const pages = await getAllNotePages();
  if (pages.length <= 1) {
    return;
  }

  await db.execute(`DELETE FROM note_pages WHERE id = $1`, [id]);

  // Soft-delete any stickers placed on this note page
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE week_images SET deleted_at = $1, updated_at = $1 WHERE week_start = $2`,
    [now, `note:${id}`]
  );

  // Renumber remaining pages sequentially 1..N
  const remaining = await db.select<RawNotePageRow[]>(
    `SELECT * FROM note_pages ORDER BY page_order ASC`
  );
  for (let i = 0; i < remaining.length; i++) {
    const desiredOrder = i + 1;
    if (remaining[i].page_order !== desiredOrder) {
      await db.execute(
        `UPDATE note_pages SET page_order = $1 WHERE id = $2`,
        [desiredOrder, remaining[i].id]
      );
    }
  }

  await notifyDatabaseUpdated("note_pages:delete");
}
