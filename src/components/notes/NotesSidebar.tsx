import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FilePlus2, Trash2 } from "lucide-react";
import { onDatabaseUpdated } from "../../db/database";
import {
  deleteNotePage,
  getAllNotePages,
  insertNotePageAfter,
  updateNotePageContent,
} from "../../db/notePagesRepo";
import {
  deleteWeekImage,
  getWeekImagesForWeek,
  updateWeekImage,
} from "../../db/weekImagesRepo";
import {
  NotePage,
  UpdateWeekImageInput,
  WeekImage,
} from "../../types/planner";
import { CrispSquareGrid } from "../planner/CrispSquareGrid";
import { WeeklyImageLayer } from "../planner/WeeklyImageLayer";

const SIDE_BORDER_PX = 16;
const BOTTOM_BORDER_PX = 24;
const TOTAL_WEEK_GRID_ROWS = 35;
const MIN_GRID_PX = 15;
const MAX_GRID_PX = 22;

interface NotesSidebarProps {
  onHoverChange?: (
    cursor: { pageId: string; xPct: number; yPct: number } | null
  ) => void;
}

export const NotesSidebar: React.FC<NotesSidebarProps> = ({
  onHoverChange,
}) => {
  const [pages, setPages] = useState<NotePage[]>([]);
  const [currentPageIdx, setCurrentPageIdx] = useState<number>(0);
  const [draftContent, setDraftContent] = useState<string>("");
  const [pageImages, setPageImages] = useState<WeekImage[]>([]);

  // Inline page number jump input state
  const [isEditingPageNum, setIsEditingPageNum] = useState(false);
  const [pageJumpInput, setPageJumpInput] = useState("");

  // Right-click page context menu
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Grid alignment matching WeekBoard's 7-day weekly planner
  const [gridSizePx, setGridSizePx] = useState<number>(17);
  const [notesBoxWidthPx, setNotesBoxWidthPx] = useState<number>(308);
  const [isScrollable, setIsScrollable] = useState<boolean>(false);

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const notesBoxRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const dirtyPageIdRef = useRef<string | null>(null);
  const isPageActionPendingRef = useRef<boolean>(false);

  const currentPage = pages[currentPageIdx] ?? null;
  const currentPageId = currentPage?.id ?? null;

  const loadPages = useCallback(async () => {
    try {
      const loaded = await getAllNotePages();
      setPages(loaded);
      setCurrentPageIdx((prev) =>
        loaded.length === 0 ? 0 : Math.min(prev, loaded.length - 1)
      );
    } catch (err) {
      console.warn("[NotesSidebar] Failed to load note pages:", err);
    }
  }, []);

  const loadStickersForPage = useCallback(async (pageId: string | null) => {
    if (!pageId) {
      setPageImages([]);
      return;
    }
    try {
      const imgs = await getWeekImagesForWeek(`note:${pageId}`);
      setPageImages(imgs);
    } catch (err) {
      console.warn("[NotesSidebar] Failed to load page stickers:", err);
    }
  }, []);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  // Sync draftContent when switching pages (unless actively typing on that same page)
  useEffect(() => {
    if (!currentPage) {
      setDraftContent("");
      return;
    }
    if (dirtyPageIdRef.current !== currentPage.id) {
      setDraftContent(currentPage.content);
    }
    void loadStickersForPage(currentPage.id);
  }, [currentPageId, currentPage?.content, loadStickersForPage]);

  // Subscribe to DB updates (e.g., pasting a sticker on a note page)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void onDatabaseUpdated((source) => {
      if (isDisposed) return;
      if (source?.startsWith("week_images:") && currentPageId) {
        void loadStickersForPage(currentPageId);
      } else if (source?.startsWith("note_pages:") && !dirtyPageIdRef.current) {
        void loadPages();
      }
    }).then((fn) => {
      if (isDisposed) fn();
      else unlisten = fn;
    });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [currentPageId, loadPages, loadStickersForPage]);

  // Match WeekBoard's exact gridSizePx & 7-day height alignment
  useEffect(() => {
    const sidebarEl = sidebarRef.current;
    const notesEl = notesBoxRef.current;
    if (!sidebarEl) return;

    const updateLayout = () => {
      const headerH = headerRef.current?.offsetHeight ?? 28;
      const availableH = sidebarEl.clientHeight - headerH - BOTTOM_BORDER_PX;
      if (availableH > 140) {
        const rawGrid = availableH / TOTAL_WEEK_GRID_ROWS;
        const clamped = Math.max(MIN_GRID_PX, Math.min(MAX_GRID_PX, rawGrid));
        setGridSizePx(clamped);
      }
      if (notesEl) {
        setNotesBoxWidthPx(notesEl.clientWidth);
      }
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(sidebarEl);
    if (notesEl) observer.observe(notesEl);
    return () => observer.disconnect();
  }, []);

  // Auto-expand textarea height only when content exceeds the bottom threshold
  useEffect(() => {
    const ta = textareaRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!ta || !scrollEl) return;

    const containerH = scrollEl.clientHeight;
    ta.style.height = "0px";
    const contentH = ta.scrollHeight;
    const exceedsThreshold = contentH > containerH;
    setIsScrollable(exceedsThreshold);
    ta.style.height = `${exceedsThreshold ? contentH : containerH}px`;
  }, [draftContent, currentPageId, gridSizePx]);

  // Close right-click context menu on outside click
  useEffect(() => {
    if (!contextMenuPos) return;
    const close = () => setContextMenuPos(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenuPos]);

  const flushContentSave = useCallback(
    async (pageId: string, text: string) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await updateNotePageContent(pageId, text);
      if (dirtyPageIdRef.current === pageId) {
        dirtyPageIdRef.current = null;
      }
      setPages((prev) =>
        prev.map((p) => (p.id === pageId ? { ...p, content: text } : p))
      );
    },
    []
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    setDraftContent(nextVal);
    if (!currentPageId) return;

    dirtyPageIdRef.current = currentPageId;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    const targetId = currentPageId;
    saveTimerRef.current = window.setTimeout(() => {
      void flushContentSave(targetId, nextVal);
    }, 350);
  };

  const goToPageIndex = async (nextIdx: number) => {
    if (pages.length === 0) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, nextIdx));
    if (currentPageId && dirtyPageIdRef.current === currentPageId) {
      await flushContentSave(currentPageId, draftContent);
    }
    setCurrentPageIdx(clamped);
  };

  const handleCommitPageJump = () => {
    const parsed = parseInt(pageJumpInput.trim(), 10);
    setIsEditingPageNum(false);
    if (
      !Number.isNaN(parsed) &&
      String(parsed) === pageJumpInput.trim() &&
      parsed >= 1 &&
      parsed <= pages.length
    ) {
      void goToPageIndex(parsed - 1);
    }
  };

  const handleAddPageAfterCurrent = async () => {
    setContextMenuPos(null);
    if (!currentPageId || isPageActionPendingRef.current) return;
    isPageActionPendingRef.current = true;
    try {
      if (dirtyPageIdRef.current === currentPageId) {
        await flushContentSave(currentPageId, draftContent);
      }
      const newPage = await insertNotePageAfter(currentPageId);
      const updated = await getAllNotePages();
      setPages(updated);
      const newIdx = updated.findIndex((p) => p.id === newPage.id);
      if (newIdx >= 0) {
        setCurrentPageIdx(newIdx);
      }
    } finally {
      isPageActionPendingRef.current = false;
    }
  };

  const handleDeleteCurrentPage = async () => {
    setContextMenuPos(null);
    if (!currentPageId || pages.length <= 1 || isPageActionPendingRef.current) {
      return;
    }
    isPageActionPendingRef.current = true;
    try {
      dirtyPageIdRef.current = null;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const deletingIdx = currentPageIdx;
      await deleteNotePage(currentPageId);
      const updated = await getAllNotePages();
      setPages(updated);
      // Always navigate to the previous page (or stay at page 1 if deleting index 0)
      setCurrentPageIdx(Math.max(0, Math.min(deletingIdx - 1, updated.length - 1)));
    } finally {
      isPageActionPendingRef.current = false;
    }
  };

  const handleUpdateNoteSticker = (id: string, updates: UpdateWeekImageInput) => {
    void updateWeekImage(id, updates).then(() => {
      void loadStickersForPage(currentPageId);
    });
  };

  const handleDeleteNoteSticker = (id: string) => {
    void deleteWeekImage(id).then(() => {
      void loadStickersForPage(currentPageId);
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = canvasRef.current;
    if (!el || !onHoverChange || !currentPageId) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    onHoverChange({ pageId: currentPageId, xPct, yPct });
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const notesBoxHeightPx = TOTAL_WEEK_GRID_ROWS * gridSizePx;

  return (
    <div
      ref={sidebarRef}
      onContextMenu={handleContextMenu}
      className="relative w-[340px] shrink-0 h-full flex flex-col overflow-hidden"
    >
      {/* Top Header Row matching WeekBoard's header height (pt-1 pb-1.5 + text-lg leading-none) */}
      <div
        ref={headerRef}
        style={{
          paddingLeft: `${SIDE_BORDER_PX}px`,
          paddingRight: `${SIDE_BORDER_PX}px`,
        }}
        className="pt-1 pb-1.5 flex items-center justify-between select-none shrink-0 border-l border-hobo-lineDark"
      >
        <span className="text-lg leading-none tracking-[0.06em] font-normal text-hobo-ink">
          NOTES
        </span>

        {/* Page Flipping Arrows with Editable Page Number (e.g. 1/3) in the Middle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={currentPageIdx <= 0}
            onClick={() => void goToPageIndex(currentPageIdx - 1)}
            className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red disabled:opacity-35 transition-colors bg-transparent border-0"
          >
            <ChevronLeft className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>

          {isEditingPageNum ? (
            <input
              type="text"
              value={pageJumpInput}
              autoFocus
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                setPageJumpInput(digitsOnly);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCommitPageJump();
                } else if (e.key === "Escape") {
                  setIsEditingPageNum(false);
                }
              }}
              onBlur={handleCommitPageJump}
              className="w-8 text-center bg-white/70 border border-hobo-lineDark text-[10px] leading-none py-0.5 text-hobo-ink outline-none focus:border-hobo-red"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setPageJumpInput(String(currentPageIdx + 1));
                setIsEditingPageNum(true);
              }}
              className="inline-flex items-center justify-center px-1 py-0 text-[10px] leading-none tracking-[0.12em] text-hobo-ink hover:text-hobo-red bg-transparent border-0 transition-colors cursor-pointer"
            >
              {pages.length > 0 ? `${currentPageIdx + 1}/${pages.length}` : "1/1"}
            </button>
          )}

          <button
            type="button"
            disabled={currentPageIdx >= pages.length - 1}
            onClick={() => void goToPageIndex(currentPageIdx + 1)}
            className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red disabled:opacity-35 transition-colors bg-transparent border-0"
          >
            <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* Main Notes Body: border-l stops 24px above bottom edge, matching the weekly/tasks separator */}
      <div
        style={{
          paddingLeft: `${SIDE_BORDER_PX}px`,
          paddingRight: `${SIDE_BORDER_PX}px`,
        }}
        className="flex-1 min-h-0 flex flex-col justify-start overflow-hidden border-l border-hobo-lineDark mb-[24px]"
      >
        {/* Notes Page Box: Top & Bottom lines align exactly with the 7-day weekly planner */}
        <div
          ref={notesBoxRef}
          style={{ height: `${notesBoxHeightPx}px` }}
          className="border-t border-b border-hobo-lineDark relative flex flex-col shrink-0 overflow-hidden"
        >
          <CrispSquareGrid
            cellSizePx={gridSizePx}
            rows={TOTAL_WEEK_GRID_ROWS}
            widthPx={notesBoxWidthPx}
          />

          {/* Scrollable Canvas (only scrolls once content exceeds bottom threshold; stickers scroll with notes) */}
          <div
            ref={scrollContainerRef}
            className={`relative z-10 flex-1 min-h-0 overflow-x-hidden ${
              isScrollable ? "overflow-y-auto" : "overflow-y-hidden"
            }`}
          >
            <div
              ref={canvasRef}
              data-sticker-drop-zone="notes"
              data-note-page-id={currentPageId ?? ""}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => onHoverChange?.(null)}
              className="relative min-h-full w-full"
            >
              <WeeklyImageLayer
                images={pageImages}
                containerRef={canvasRef}
                onUpdateImage={handleUpdateNoteSticker}
                onDeleteImage={handleDeleteNoteSticker}
              />

              <textarea
                ref={textareaRef}
                value={draftContent}
                onChange={handleTextChange}
                onBlur={() => {
                  if (currentPageId && dirtyPageIdRef.current === currentPageId) {
                    void flushContentSave(currentPageId, draftContent);
                  }
                }}
                placeholder=""
                className="block relative z-10 w-full bg-transparent border-0 outline-none resize-none px-3 py-2 text-[12px] leading-[17px] font-light text-hobo-ink overflow-hidden"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right-Click Context Menu for Adding / Deleting Note Pages (Portaled above all elements) */}
      {contextMenuPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(contextMenuPos.x, window.innerWidth - 165)}px`,
              top: `${Math.min(contextMenuPos.y, window.innerHeight - 80)}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            className="z-[9999] w-40 bg-hobo-paperSolid border border-hobo-lineDark shadow-sm py-1 px-1 pointer-events-auto select-none"
          >
            <button
              type="button"
              onClick={() => void handleAddPageAfterCurrent()}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-hobo-ink hover:text-hobo-red hover:bg-hobo-redSoft transition-colors bg-transparent border-0 text-left"
            >
              <FilePlus2 className="w-3 h-3 stroke-[1.5]" />
              <span>Add Page</span>
            </button>

            <button
              type="button"
              disabled={pages.length <= 1}
              onClick={() => void handleDeleteCurrentPage()}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-hobo-ink hover:text-hobo-red hover:bg-hobo-redSoft disabled:opacity-40 disabled:pointer-events-none transition-colors bg-transparent border-0 text-left"
            >
              <Trash2 className="w-3 h-3 stroke-[1.5]" />
              <span>Delete Page</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};
