import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  BucketDefinition,
  BucketLayoutEntry,
  MAX_VISIBLE_BUCKETS,
  MAX_VISIBLE_BUCKETS_MESSAGE,
} from "../../../shared/buckets";

interface ManageHiddenListsModalProps {
  isOpen: boolean;
  bucketDefinitions: BucketDefinition[];
  layoutEntries: BucketLayoutEntry[];
  onClose: () => void;
  onToggleVisibility: (bucketId: string, nextVisible: boolean) => void;
  onRenameBucket: (bucketId: string, newTitle: string) => Promise<void> | void;
  onCountTasksInBucket: (bucketId: string) => Promise<number>;
  onDeleteHiddenBucket: (bucketId: string) => Promise<void> | void;
}

export const ManageHiddenListsModal: React.FC<ManageHiddenListsModalProps> = ({
  isOpen,
  bucketDefinitions,
  layoutEntries,
  onClose,
  onToggleVisibility,
  onRenameBucket,
  onCountTasksInBucket,
  onDeleteHiddenBucket,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    bucketId: string;
    title: string;
    taskCount: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEditingId(null);
      setWarningMessage(null);
      setPendingDelete(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  if (!isOpen) return null;

  const visibleByBucketId = new Map<string, boolean>();
  for (const entry of layoutEntries) {
    visibleByBucketId.set(entry.bucket_id, entry.visible);
  }

  // Order lists by the current page's layout order first, then any remaining definitions
  const orderedDefs: BucketDefinition[] = [];
  const defById = new Map(bucketDefinitions.map((d) => [d.id, d]));
  const seen = new Set<string>();

  for (const entry of layoutEntries) {
    const def = defById.get(entry.bucket_id);
    if (def && !seen.has(def.id)) {
      seen.add(def.id);
      orderedDefs.push(def);
    }
  }
  for (const def of bucketDefinitions) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      orderedDefs.push(def);
    }
  }

  const visibleCount = orderedDefs.filter((d) =>
    Boolean(visibleByBucketId.get(d.id))
  ).length;

  const commitRename = async (bucketId: string, originalTitle: string) => {
    setEditingId(null);
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === originalTitle) return;
    await onRenameBucket(bucketId, trimmed);
  };

  const handleToggle = (bucketId: string, currentlyVisible: boolean) => {
    setWarningMessage(null);
    if (!currentlyVisible && visibleCount >= MAX_VISIBLE_BUCKETS) {
      setWarningMessage(MAX_VISIBLE_BUCKETS_MESSAGE);
      return;
    }
    onToggleVisibility(bucketId, !currentlyVisible);
  };

  const handleDeleteClick = async (def: BucketDefinition) => {
    setWarningMessage(null);
    const count = await onCountTasksInBucket(def.id);
    if (count > 0) {
      setPendingDelete({
        bucketId: def.id,
        title: def.title,
        taskCount: count,
      });
    } else {
      await onDeleteHiddenBucket(def.id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4 select-none pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] bg-hobo-paperSolid border border-hobo-lineDark shadow-lg overflow-hidden text-xs font-light"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3.5 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.16em] text-hobo-ink font-normal">
              Manage Task Lists
            </h3>
            <p className="text-[9px] text-hobo-muted mt-0.5">
              Double-click a list name to rename it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        {/* Warning banner when exceeding 4 visible lists */}
        {warningMessage && (
          <div className="px-3.5 py-2 bg-hobo-redSoft border-b border-hobo-red text-[11px] text-hobo-red">
            {warningMessage}
          </div>
        )}

        {/* Delete confirmation prompt when a hidden list has tasks */}
        {pendingDelete ? (
          <div className="p-4 space-y-3">
            <p className="text-[11px] leading-relaxed text-hobo-ink">
              Deleting the task list will delete{" "}
              <span className="font-normal text-hobo-red">
                {pendingDelete.taskCount}
              </span>{" "}
              task{pendingDelete.taskCount === 1 ? "" : "s"} under this list.
              Proceed?
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] border border-hobo-lineDark text-hobo-muted hover:text-hobo-ink bg-transparent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = pendingDelete.bucketId;
                  setPendingDelete(null);
                  await onDeleteHiddenBucket(id);
                }}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] border border-hobo-red bg-hobo-red text-white hover:opacity-90"
              >
                Proceed
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 max-h-[320px] overflow-y-auto divide-y divide-hobo-line">
            {orderedDefs.length === 0 ? (
              <p className="text-[11px] text-hobo-muted py-2 text-center">
                No task lists exist yet. Right-click the tasks page to add one.
              </p>
            ) : (
              orderedDefs.map((def) => {
                const isVisible = Boolean(visibleByBucketId.get(def.id));
                const isEditing = editingId === def.id;

                return (
                  <div
                    key={def.id}
                    className="py-2 flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* On/Off Slider Toggle */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isVisible}
                        onClick={() => handleToggle(def.id, isVisible)}
                        className={`relative w-7 h-4 rounded-full transition-colors shrink-0 border ${
                          isVisible
                            ? "bg-hobo-red border-hobo-red"
                            : "bg-hobo-line border-hobo-lineDark"
                        }`}
                      >
                        <span
                          className={`block w-2.5 h-2.5 rounded-full bg-white transition-transform ${
                            isVisible ? "translate-x-3.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>

                      {/* List Name (double-click to rename) */}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onBlur={() => void commitRename(def.id, def.title)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitRename(def.id, def.title);
                              } else if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                            className="w-full bg-white/80 border border-hobo-red px-1.5 py-0.5 text-[11px] text-hobo-ink outline-none"
                          />
                        ) : (
                          <div
                            onDoubleClick={() => {
                              setDraftTitle(def.title);
                              setEditingId(def.id);
                            }}
                            className="flex items-baseline gap-1.5 cursor-text truncate"
                          >
                            <span
                              className={`text-[11px] uppercase tracking-[0.1em] truncate ${
                                isVisible ? "text-hobo-ink" : "text-hobo-muted"
                              }`}
                            >
                              {def.title}
                            </span>
                            <span className="text-[9px] text-hobo-faint uppercase shrink-0">
                              {def.scope === "persistent" ? "long-term" : "weekly"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Permanent Delete X icon for hidden lists */}
                    {!isVisible && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteClick(def)}
                        className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 shrink-0 transition-colors"
                      >
                        <X className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
