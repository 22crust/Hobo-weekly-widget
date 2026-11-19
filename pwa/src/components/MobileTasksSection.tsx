import React, { useState } from "react";
import { Plus } from "lucide-react";
import { LocalTask } from "../types/planner";
import { MobileTaskItem } from "./MobileTaskItem";

interface MobileTasksSectionProps {
  weeklyTasks: LocalTask[];
  longTermTasks: LocalTask[];
  onAddWeeklyTask: (title: string) => void;
  onAddLongTermTask: (title: string) => void;
  onToggleTask: (task: LocalTask) => void;
  onEditTaskTitle: (syncId: string, title: string) => void;
  onDeleteTask: (syncId: string) => void;
  onMigrateWeeklyToPrevWeek: (syncId: string) => void;
  onMigrateWeeklyToNextWeek: (syncId: string) => void;
  onClearCompletedWeekly: () => void;
  onClearCompletedLongTerm: () => void;
}

export const MobileTasksSection: React.FC<MobileTasksSectionProps> = ({
  weeklyTasks,
  longTermTasks,
  onAddWeeklyTask,
  onAddLongTermTask,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onMigrateWeeklyToPrevWeek,
  onMigrateWeeklyToNextWeek,
  onClearCompletedWeekly,
  onClearCompletedLongTerm,
}) => {
  const [weeklyDraft, setWeeklyDraft] = useState("");
  const [longTermDraft, setLongTermDraft] = useState("");

  const hasCompletedWeekly = weeklyTasks.some((t) => t.is_completed);
  const hasCompletedLongTerm = longTermTasks.some((t) => t.is_completed);

  return (
    <section className="px-3.5 py-3 space-y-4">
      {/* Weekly Tasks — auto-sized height & drop zone */}
      <div data-task-drop-zone="weekly-sidebar" className="py-1 -mx-1 px-1">
        <div className="pb-0.5 flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-hobo-ink font-medium">
            Weekly Tasks
          </h3>
          {hasCompletedWeekly && (
            <button
              type="button"
              onClick={onClearCompletedWeekly}
              className="text-[10px] uppercase tracking-wider text-hobo-muted hover:text-hobo-red"
            >
              Clear Completed
            </button>
          )}
        </div>

        <div className="pt-0.5 space-y-0">
          {weeklyTasks.map((task) => (
            <MobileTaskItem
              key={task.sync_id}
              task={task}
              onToggle={onToggleTask}
              onEditTitle={onEditTaskTitle}
              onDelete={onDeleteTask}
              onMigrateToPrevWeek={onMigrateWeeklyToPrevWeek}
              onMigrateToNextWeek={onMigrateWeeklyToNextWeek}
            />
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!weeklyDraft.trim()) return;
              onAddWeeklyTask(weeklyDraft.trim());
              setWeeklyDraft("");
            }}
            className="flex items-center gap-1.5 pt-0.5"
          >
            <Plus className="w-3.5 h-3.5 text-hobo-faint shrink-0" />
            <input
              type="text"
              value={weeklyDraft}
              onChange={(e) => setWeeklyDraft(e.target.value)}
              className="w-full text-[12.5px] bg-transparent text-hobo-ink outline-none py-0.5"
            />
          </form>
        </div>
      </div>

      {/* Long-Term Tasks — auto-sized height & drop zone */}
      <div data-task-drop-zone="long-term" className="py-1 -mx-1 px-1">
        <div className="pb-0.5 flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-hobo-ink font-medium">
            Long-Term Tasks
          </h3>
          {hasCompletedLongTerm && (
            <button
              type="button"
              onClick={onClearCompletedLongTerm}
              className="text-[10px] uppercase tracking-wider text-hobo-muted hover:text-hobo-red"
            >
              Clear Completed
            </button>
          )}
        </div>

        <div className="pt-0.5 space-y-0">
          {longTermTasks.map((task) => (
            <MobileTaskItem
              key={task.sync_id}
              task={task}
              onToggle={onToggleTask}
              onEditTitle={onEditTaskTitle}
              onDelete={onDeleteTask}
            />
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!longTermDraft.trim()) return;
              onAddLongTermTask(longTermDraft.trim());
              setLongTermDraft("");
            }}
            className="flex items-center gap-1.5 pt-0.5"
          >
            <Plus className="w-3.5 h-3.5 text-hobo-faint shrink-0" />
            <input
              type="text"
              value={longTermDraft}
              onChange={(e) => setLongTermDraft(e.target.value)}
              className="w-full text-[12.5px] bg-transparent text-hobo-ink outline-none py-0.5"
            />
          </form>
        </div>
      </div>
    </section>
  );
};
