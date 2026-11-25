import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { LocalTask } from "../types/planner";
import {
  applyTaskDropIndicator,
  clearTaskDropIndicator,
  computeTaskDropInsertion,
} from "../../../shared/taskDragDrop";

interface MobileTaskItemProps {
  task: LocalTask;
  onToggle: (task: LocalTask) => void;
  onEditTitle: (syncId: string, title: string) => void;
  onDelete: (syncId: string) => void;
  onMigrateToPrevWeek?: (syncId: string) => void;
  onMigrateToNextWeek?: (syncId: string) => void;
}

const LONG_PRESS_MS = 320;
const MOVE_CANCEL_PX = 8;

export const MobileTaskItem: React.FC<MobileTaskItemProps> = ({
  task,
  onToggle,
  onEditTitle,
  onDelete,
  onMigrateToPrevWeek,
  onMigrateToNextWeek,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const holdTimerRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const hoveredZoneRef = useRef<HTMLElement | null>(null);
  const indicatorTargetRef = useRef<HTMLElement | null>(null);

  const clearHoverHighlight = () => {
    if (hoveredZoneRef.current) {
      hoveredZoneRef.current.removeAttribute("data-drop-active");
      hoveredZoneRef.current = null;
    }
    clearTaskDropIndicator(indicatorTargetRef.current);
    indicatorTargetRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
      clearHoverHighlight();
    };
  }, []);

  const commitEdit = () => {
    setIsEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.title) {
      onEditTitle(task.sync_id, trimmed);
    } else {
      setDraft(task.title);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEditing || menuOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest("button[data-no-drag='true']") || target.closest("input")) {
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let latestX = startX;
    let latestY = startY;
    isDraggingRef.current = false;

    const findDropZone = (x: number, y: number): HTMLElement | null => {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        const zone = (el as HTMLElement).closest?.(
          "[data-task-drop-zone]"
        ) as HTMLElement | null;
        if (zone) return zone;
      }
      return null;
    };

    const cleanup = () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      clearHoverHighlight();
      setDragPos(null);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("touchmove", onTouchMovePreventScroll);
    };

    const onTouchMovePreventScroll = (te: TouchEvent) => {
      if (isDraggingRef.current) {
        te.preventDefault();
      }
    };

    const onPointerMove = (me: PointerEvent) => {
      latestX = me.clientX;
      latestY = me.clientY;
      if (!isDraggingRef.current) {
        if (
          Math.abs(latestX - startX) > MOVE_CANCEL_PX ||
          Math.abs(latestY - startY) > MOVE_CANCEL_PX
        ) {
          cleanup();
        }
        return;
      }

      setDragPos({ x: latestX, y: latestY });
      const zone = findDropZone(latestX, latestY);
      if (zone !== hoveredZoneRef.current) {
        if (hoveredZoneRef.current) {
          hoveredZoneRef.current.removeAttribute("data-drop-active");
        }
        if (zone) {
          zone.setAttribute("data-drop-active", "true");
          hoveredZoneRef.current = zone;
        } else {
          hoveredZoneRef.current = null;
        }
      }
      if (zone) {
        const insertion = computeTaskDropInsertion(
          zone,
          latestY,
          "data-task-sync-id",
          task.sync_id,
          task.is_completed
        );
        indicatorTargetRef.current = applyTaskDropIndicator(
          indicatorTargetRef.current,
          insertion.indicatorTarget,
          insertion.indicatorPosition
        );
      } else {
        clearTaskDropIndicator(indicatorTargetRef.current);
        indicatorTargetRef.current = null;
      }
    };

    const onPointerUp = (ue: PointerEvent) => {
      const wasDragging = isDraggingRef.current;
      const dropX = ue.clientX || latestX;
      const dropY = ue.clientY || latestY;
      cleanup();

      if (wasDragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 150);

        const zone = findDropZone(dropX, dropY);
        const zoneKey = zone?.getAttribute("data-task-drop-zone");
        if (zone && zoneKey) {
          const insertion = computeTaskDropInsertion(
            zone,
            dropY,
            "data-task-sync-id",
            task.sync_id,
            task.is_completed
          );
          window.dispatchEvent(
            new CustomEvent("pwa:task-drop", {
              detail: {
                syncId: task.sync_id,
                zone: zoneKey,
                insertIndex: insertion.insertIndex,
              },
            })
          );
        }
      }
      isDraggingRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchmove", onTouchMovePreventScroll, {
      passive: false,
    });

    holdTimerRef.current = window.setTimeout(() => {
      isDraggingRef.current = true;
      setDragPos({ x: latestX, y: latestY });
      try {
        navigator.vibrate?.(15);
      } catch {
        // Ignore
      }
    }, LONG_PRESS_MS);
  };

  return (
    <>
      <div
        data-task-sync-id={task.sync_id}
        data-task-completed={task.is_completed ? "1" : "0"}
        onPointerDown={handlePointerDown}
        className={`relative py-[1px] flex items-start gap-1.5 text-[12.5px] leading-[16px] group select-none ${
          dragPos ? "opacity-35" : ""
        }`}
      >
        {/* Crisp square Hobonichi checkbox with light grey fill */}
        <button
          type="button"
          data-no-drag="true"
          onClick={() => onToggle(task)}
          className={`mt-[2px] w-3 h-3 shrink-0 border flex items-center justify-center transition-colors ${
            task.is_completed
              ? "border-hobo-muted bg-hobo-muted/20 text-hobo-muted"
              : "border-hobo-lineDark hover:border-hobo-red bg-transparent"
          }`}
          aria-label={task.is_completed ? "Mark incomplete" : "Mark complete"}
        >
          {task.is_completed && <Check className="w-2.5 h-2.5 stroke-[2]" />}
        </button>

        <div className="min-w-0 flex-1 leading-[16px]">
          {isEditing ? (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") {
                  setDraft(task.title);
                  setIsEditing(false);
                }
              }}
              autoFocus
              className="block w-full p-0 text-[12.5px] leading-[16px] bg-transparent border-b border-hobo-red text-hobo-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                if (suppressClickRef.current) return;
                setDraft(task.title);
                setIsEditing(true);
              }}
              className={`block p-0 border-0 bg-transparent text-left w-full text-[12.5px] leading-[16px] break-words ${
                task.is_completed
                  ? "line-through text-hobo-muted"
                  : "text-hobo-ink"
              }`}
            >
              {task.title}
            </button>
          )}
        </div>

        <button
          type="button"
          data-no-drag="true"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="p-0.5 text-hobo-muted hover:text-hobo-ink shrink-0"
          aria-label="Task options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-6 z-20 min-w-[165px] border border-hobo-lineDark bg-hobo-paperSolid shadow-md py-1 text-xs">
            {onMigrateToPrevWeek && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMigrateToPrevWeek(task.sync_id);
                }}
                className="w-full px-2.5 py-1.5 text-left hover:bg-hobo-paperHover flex items-center gap-1.5 text-hobo-ink"
              >
                <ArrowLeft className="w-3 h-3 text-hobo-muted" />
                Move to previous week
              </button>
            )}
            {onMigrateToNextWeek && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMigrateToNextWeek(task.sync_id);
                }}
                className="w-full px-2.5 py-1.5 text-left hover:bg-hobo-paperHover flex items-center gap-1.5 text-hobo-ink"
              >
                <ArrowRight className="w-3 h-3 text-hobo-muted" />
                Move to next week
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete(task.sync_id);
              }}
              className="w-full px-2.5 py-1.5 text-left hover:bg-hobo-redSoft flex items-center gap-1.5 text-hobo-red"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}
      </div>

      {dragPos &&
        createPortal(
          <div
            style={{
              left: `${dragPos.x + 10}px`,
              top: `${dragPos.y - 18}px`,
            }}
            className="fixed z-50 pointer-events-none px-2 py-1 bg-hobo-paperSolid border border-hobo-red shadow-md text-xs text-hobo-ink max-w-[200px] truncate"
          >
            {task.title}
          </div>,
          document.body
        )}
    </>
  );
};
