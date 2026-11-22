import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  BucketDefinition,
  BucketLayoutSnapshot,
  BucketScope,
  getDefaultBucketDefinitions,
  resolveWeekLayout,
} from "../../../shared/buckets";
import { LocalTask } from "../types/planner";
import { MobileTaskItem } from "./MobileTaskItem";

interface MobileTasksSectionProps {
  weekStartDate: string;
  weeklyTasks: LocalTask[];
  longTermTasks: LocalTask[];
  bucketDefinitions: BucketDefinition[];
  bucketLayouts: BucketLayoutSnapshot[];
  onAddTaskInBucket: (bucketId: string, scope: BucketScope, title: string) => void;
  onToggleTask: (task: LocalTask) => void;
  onEditTaskTitle: (syncId: string, title: string) => void;
  onDeleteTask: (syncId: string) => void;
  onMigrateWeeklyToPrevWeek: (syncId: string) => void;
  onMigrateWeeklyToNextWeek: (syncId: string) => void;
  onClearCompletedInBucket: (bucketId: string, scope: BucketScope) => void;
}

export const MobileTasksSection: React.FC<MobileTasksSectionProps> = ({
  weekStartDate,
  weeklyTasks,
  longTermTasks,
  bucketDefinitions,
  bucketLayouts,
  onAddTaskInBucket,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onMigrateWeeklyToPrevWeek,
  onMigrateWeeklyToNextWeek,
  onClearCompletedInBucket,
}) => {
  const [draftsByBucket, setDraftsByBucket] = useState<Record<string, string>>(
    {}
  );

  const activeDefs = useMemo(
    () =>
      bucketDefinitions.length > 0
        ? bucketDefinitions
        : getDefaultBucketDefinitions(),
    [bucketDefinitions]
  );

  const defById = useMemo(
    () => new Map(activeDefs.map((d) => [d.id, d])),
    [activeDefs]
  );

  const resolvedLayout = useMemo(
    () => resolveWeekLayout(weekStartDate, bucketLayouts, activeDefs),
    [weekStartDate, bucketLayouts, activeDefs]
  );

  const visibleEntries = useMemo(
    () => resolvedLayout.filter((e) => e.visible && defById.has(e.bucket_id)),
    [resolvedLayout, defById]
  );

  const allSidebarTasks = useMemo(
    () => [...weeklyTasks, ...longTermTasks],
    [weeklyTasks, longTermTasks]
  );

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <section className="px-3.5 py-3 space-y-4">
      {visibleEntries.map((entry) => {
        const def = defById.get(entry.bucket_id);
        if (!def) return null;

        const bucketTasks = allSidebarTasks.filter((t) => {
          const tBucket =
            t.bucket_id || (t.is_long_term ? "long_term" : "weekly");
          return tBucket === def.id;
        });
        const hasCompleted = bucketTasks.some((t) => t.is_completed);
        const draft = draftsByBucket[def.id] ?? "";

        return (
          <div
            key={def.id}
            data-task-drop-zone={`bucket:${def.id}`}
            className="py-1 -mx-1 px-1"
          >
            <div className="pb-0.5 flex items-center justify-between">
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-hobo-ink font-medium">
                {def.title}
              </h3>
              {hasCompleted && (
                <button
                  type="button"
                  onClick={() => onClearCompletedInBucket(def.id, def.scope)}
                  className="text-[10px] uppercase tracking-wider text-hobo-muted hover:text-hobo-red"
                >
                  Clear Completed
                </button>
              )}
            </div>

            <div className="pt-0.5 space-y-0">
              {bucketTasks.map((task) => (
                <MobileTaskItem
                  key={task.sync_id}
                  task={task}
                  onToggle={onToggleTask}
                  onEditTitle={onEditTaskTitle}
                  onDelete={onDeleteTask}
                  onMigrateToPrevWeek={
                    def.scope === "weekly"
                      ? onMigrateWeeklyToPrevWeek
                      : undefined
                  }
                  onMigrateToNextWeek={
                    def.scope === "weekly"
                      ? onMigrateWeeklyToNextWeek
                      : undefined
                  }
                />
              ))}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim()) return;
                  onAddTaskInBucket(def.id, def.scope, draft.trim());
                  setDraftsByBucket((prev) => ({ ...prev, [def.id]: "" }));
                }}
                className="flex items-center gap-1.5 pt-0.5"
              >
                <Plus className="w-3.5 h-3.5 text-hobo-faint shrink-0" />
                <input
                  type="text"
                  value={draft}
                  onChange={(e) =>
                    setDraftsByBucket((prev) => ({
                      ...prev,
                      [def.id]: e.target.value,
                    }))
                  }
                  className="w-full text-[12.5px] bg-transparent text-hobo-ink outline-none py-0.5"
                />
              </form>
            </div>
          </div>
        );
      })}
    </section>
  );
};
