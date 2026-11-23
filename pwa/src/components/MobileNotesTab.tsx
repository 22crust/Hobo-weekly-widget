import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FilePlus2, Trash2 } from "lucide-react";
import { onDatabaseUpdated } from "../db/indexedDb";
import {
  deleteNotePage,
  getAllNotePages,
  insertNotePageAfter,
  updateNotePageContent,
} from "../db/plannerRepo";
import { useDebouncedTextDraft } from "../hooks/useDebouncedTextDraft";
import { NotePage } from "../types/planner";

export const MobileNotesTab: React.FC = () => {
  const [pages, setPages] = useState<NotePage[]>([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);

  const currentPage = pages[currentPageIdx] ?? null;

  const {
    draft: draftContent,
    textareaRef,
    handleChange,
    handleBlur,
    flushPendingSave,
    cancelPendingSave,
    resetDraft,
  } = useDebouncedTextDraft({
    keyId: currentPage?.id ?? null,
    value: currentPage?.content ?? "",
    onSave: updateNotePageContent,
  });

  const loadPages = useCallback(async () => {
    const loaded = await getAllNotePages();
    setPages(loaded);
    setCurrentPageIdx((prev) =>
      loaded.length === 0 ? 0 : Math.min(prev, loaded.length - 1)
    );
  }, []);

  useEffect(() => {
    void loadPages();
    return onDatabaseUpdated((source) => {
      if (
        source?.startsWith("note_pages:") ||
        source?.startsWith("github_sync:")
      ) {
        void loadPages();
      }
    });
  }, [loadPages]);

  const handleSwitchPage = async (nextIdx: number) => {
    await flushPendingSave();
    setCurrentPageIdx(nextIdx);
  };

  const handleAddPage = async () => {
    if (!currentPage) return;
    await flushPendingSave();
    const created = await insertNotePageAfter(currentPage.id);
    const updated = await getAllNotePages();
    const newIdx = updated.findIndex((p) => p.id === created.id);
    const targetIdx = newIdx >= 0 ? newIdx : Math.min(updated.length - 1, currentPageIdx + 1);
    setPages(updated);
    setCurrentPageIdx(targetIdx);
    resetDraft("");
  };

  const handleDeletePage = async () => {
    if (!currentPage || pages.length <= 1) return;
    cancelPendingSave();
    const prevIdx = Math.max(0, currentPageIdx - 1);
    await deleteNotePage(currentPage.id);
    const updated = await getAllNotePages();
    setPages(updated);
    setCurrentPageIdx(Math.min(prevIdx, Math.max(0, updated.length - 1)));
  };

  return (
    <div className="px-3.5 py-2.5 flex flex-col min-h-[calc(100vh-4rem)]">
      {/* Compact Page Controls (no header bar or divider line) */}
      <div className="pb-1 flex items-center justify-end select-none">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPageIdx <= 0}
            onClick={() => void handleSwitchPage(Math.max(0, currentPageIdx - 1))}
            className="p-1 text-hobo-muted hover:text-hobo-red disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4 stroke-[1.5]" />
          </button>
          <span className="text-[11px] uppercase tracking-[0.1em] text-hobo-ink px-1">
            Page {pages.length === 0 ? 0 : currentPageIdx + 1} / {pages.length}
          </span>
          <button
            type="button"
            disabled={currentPageIdx >= pages.length - 1}
            onClick={() =>
              void handleSwitchPage(
                Math.min(pages.length - 1, currentPageIdx + 1)
              )
            }
            className="p-1 text-hobo-muted hover:text-hobo-red disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4 stroke-[1.5]" />
          </button>

          <button
            type="button"
            onClick={() => void handleAddPage()}
            title="New note page"
            className="ml-1 p-1 text-hobo-muted hover:text-hobo-red"
          >
            <FilePlus2 className="w-4 h-4 stroke-[1.5]" />
          </button>
          {pages.length > 1 && (
            <button
              type="button"
              onClick={() => void handleDeletePage()}
              title="Delete note page"
              className="p-1 text-hobo-muted hover:text-hobo-red"
            >
              <Trash2 className="w-4 h-4 stroke-[1.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Plain Hobonichi Grid Note Area (no extra lines) */}
      <textarea
        ref={textareaRef}
        value={draftContent}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className="flex-1 w-full py-1 bg-transparent text-[13.5px] leading-[20px] text-hobo-ink outline-none resize-none"
      />
    </div>
  );
};
