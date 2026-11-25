import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { LocalTask } from "../../types/planner";
import {
  applyTaskDropIndicator,
  clearTaskDropIndicator,
  computeTaskDropInsertion,
} from "../../../shared/taskDragDrop";

// Module-level dragged task ID for pointer drag-and-drop
let activeDraggedTaskId: number | null = null;
export function getActiveDraggedTaskId(): number | null {
  return activeDraggedTaskId;
}
export function setActiveDraggedTaskId(id: number | null): void {
  activeDraggedTaskId = id;
}

interface TaskItemProps {
  task: LocalTask;
  onToggleComplete: (id: number, isCompleted: boolean) => void;
  onEditTitle: (id: number, newTitle: string) => void;
  onDelete: (id: number) => void;
  onMoveToDate?: (id: number, dateStr: string) => void;
  onMoveToWeeklySidebar?: (id: number) => void;
  onMoveToLongTermSidebar?: (id: number) => void;
  onMigratePrevWeek?: (id: number) => void;
  onMigrateNextWeek?: (id: number) => void;
  showMigrationArrows?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onToggleComplete,
  onEditTitle,
  onDelete,
  onMigratePrevWeek,
  onMigrateNextWeek,
  showMigrationArrows = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftTitle(task.title);
  }, [task.title]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commitEdit = () => {
    const trimmed = draftTitle.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== task.title) {
      onEditTitle(task.id, trimmed);
    } else {
      setDraftTitle(task.title);
    }
  };

  /**
   * Pure pointer-based drag-and-drop (`mousedown` -> `mousemove` -> `mouseup`).
   * Moves a floating copy of the task text right along with the cursor while dragging.
   */
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isEditing) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let indicatorTarget: HTMLElement | null = null;

    const findMatchedDropZone = (x: number, y: number): HTMLElement | null => {
      const allDropZones = document.querySelectorAll<HTMLElement>(
        "[data-task-drop-zone]"
      );
      for (const zone of allDropZones) {
        const rect = zone.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return zone;
        }
      }
      return null;
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 4) {
        dragging = true;
        setActiveDraggedTaskId(task.id);
      }
      if (dragging) {
        setDragOffset({ x: moveEvent.clientX, y: moveEvent.clientY });
        const zone = findMatchedDropZone(moveEvent.clientX, moveEvent.clientY);
        if (zone) {
          const insertion = computeTaskDropInsertion(
            zone,
            moveEvent.clientY,
            "data-task-id",
            String(task.id),
            task.is_completed
          );
          indicatorTarget = applyTaskDropIndicator(
            indicatorTarget,
            insertion.indicatorTarget,
            insertion.indicatorPosition
          );
        } else {
          clearTaskDropIndicator(indicatorTarget);
          indicatorTarget = null;
        }
      }
    };

    const onMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      clearTaskDropIndicator(indicatorTarget);
      indicatorTarget = null;
      if (dragging) {
        setDragOffset(null);
        const matchedZone = findMatchedDropZone(upEvent.clientX, upEvent.clientY);
        if (matchedZone) {
          const insertion = computeTaskDropInsertion(
            matchedZone,
            upEvent.clientY,
            "data-task-id",
            String(task.id),
            task.is_completed
          );
          matchedZone.dispatchEvent(
            new CustomEvent("planner:task-pointer-drop", {
              bubbles: true,
              detail: { taskId: task.id, insertIndex: insertion.insertIndex },
            })
          );
        }
        setActiveDraggedTaskId(null);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <>
      <div
        data-task-id={task.id}
        data-task-completed={task.is_completed ? "1" : "0"}
        onMouseDown={handleMouseDown}
        className={`group relative flex items-start gap-1.5 py-[1px] text-[12px] leading-[16px] text-hobo-ink select-none ${
          dragOffset ? "opacity-30" : ""
        }`}
      >
        {/* Crisp square Hobonichi paper checkbox */}
        <button
          type="button"
          onClick={() => onToggleComplete(task.id, !task.is_completed)}
          className={`mt-[2px] w-3 h-3 shrink-0 border flex items-center justify-center transition-colors ${
            task.is_completed
              ? "border-hobo-muted bg-hobo-muted/20 text-hobo-muted"
              : "border-hobo-lineDark hover:border-hobo-red bg-transparent"
          }`}
        >
          {task.is_completed && <Check className="w-2.5 h-2.5 stroke-[2]" />}
        </button>

        {/* Task Title: default cursor, single line with right-edge fade, expands on hover */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") {
                setDraftTitle(task.title);
                setIsEditing(false);
              }
            }}
            className="flex-1 min-w-0 bg-hobo-paperSolid/90 text-hobo-ink text-[12px] leading-[16px] px-1 py-0 border-b border-hobo-red outline-none font-light"
          />
        ) : (
          <div
            onDoubleClick={() => setIsEditing(true)}
            className={`flex-1 min-w-0 cursor-default transition-colors ${
              task.is_completed
                ? "line-through text-hobo-muted/75"
                : "text-hobo-ink"
            } whitespace-nowrap overflow-hidden task-fade-mask group-hover:whitespace-normal group-hover:overflow-visible group-hover:break-words`}
          >
            {task.title}
          </div>
        )}

        {/* Hover action icons */}
        {!isEditing && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0 pl-1">
            {showMigrationArrows && onMigratePrevWeek && (
              <button
                type="button"
                onClick={() => onMigratePrevWeek(task.id)}
                className="text-hobo-muted hover:text-hobo-ink bg-transparent border-0 p-0"
              >
                <ArrowLeft className="w-3 h-3 stroke-[1.5]" />
              </button>
            )}
            {showMigrationArrows && onMigrateNextWeek && (
              <button
                type="button"
                onClick={() => onMigrateNextWeek(task.id)}
                className="text-hobo-muted hover:text-hobo-ink bg-transparent border-0 p-0"
              >
                <ArrowRight className="w-3 h-3 stroke-[1.5]" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(task.id)}
              className="text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0"
            >
              <X className="w-3 h-3 stroke-[1.5]" />
            </button>
          </div>
        )}
      </div>

      {/* Grabbed floating text that follows the cursor during drag */}
      {dragOffset && (
        <div
          style={{
            position: "fixed",
            left: `${dragOffset.x + 8}px`,
            top: `${dragOffset.y - 8}px`,
          }}
          className="pointer-events-none z-50 text-[12px] leading-[16px] font-light text-hobo-ink whitespace-nowrap select-none"
        >
          {task.title}
        </div>
      )}
    </>
  );
};
