import React, { useState } from "react";
import { addDays, format, isToday, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { GoogleEvent, LocalTask } from "../types/planner";
import { MobileTaskItem } from "./MobileTaskItem";

interface MobileWeekBoardProps {
  weekStartDate: string;
  weekEndDate: string;
  weekEvents: GoogleEvent[];
  datedTasks: LocalTask[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetThisWeek: () => void;
  onAddTaskInDay: (dateStr: string, title: string) => void;
  onToggleTask: (task: LocalTask) => void;
  onEditTaskTitle: (syncId: string, title: string) => void;
  onDeleteTask: (syncId: string) => void;
  onSelectDayForEvents?: (dateStr: string) => void;
}

function formatEventTimeShort(ev: GoogleEvent): string {
  if (ev.is_all_day) return "All Day";
  if (ev.local_start_hhmm && ev.local_end_hhmm) {
    return `${ev.local_start_hhmm} – ${ev.local_end_hhmm}`;
  }
  try {
    return `${format(parseISO(ev.start_time), "HH:mm")} – ${format(
      parseISO(ev.end_time),
      "HH:mm"
    )}`;
  } catch {
    return "";
  }
}

export const MobileWeekBoard: React.FC<MobileWeekBoardProps> = ({
  weekStartDate,
  weekEndDate,
  weekEvents,
  datedTasks,
  onPrevWeek,
  onNextWeek,
  onResetThisWeek,
  onAddTaskInDay,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onSelectDayForEvents,
}) => {
  const startObj = parseISO(weekStartDate);
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    format(addDays(startObj, i), "yyyy-MM-dd")
  );
  const [draftsByDay, setDraftsByDay] = useState<Record<string, string>>({});

  return (
    <section className="px-3.5 pt-2.5 pb-3 border-b border-hobo-lineDark">
      {/* Header matching desktop WeekBoard: date range + < This Week > */}
      <div className="pb-2 flex items-center justify-between select-none">
        <span className="text-[11px] leading-none tracking-[0.1em] uppercase text-hobo-muted truncate">
          {format(parseISO(weekStartDate), "MMM d")} –{" "}
          {format(parseISO(weekEndDate), "MMM d, yyyy")}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onPrevWeek}
            className="inline-flex items-center justify-center p-1 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            <ChevronLeft className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
          <button
            type="button"
            onClick={onResetThisWeek}
            className="inline-flex items-center justify-center px-1 py-0 text-[10px] leading-none uppercase tracking-[0.12em] text-hobo-ink hover:text-hobo-red bg-transparent border-0 transition-colors"
          >
            This Week
          </button>
          <button
            type="button"
            onClick={onNextWeek}
            className="inline-flex items-center justify-center p-1 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* 7-Day Vertical Stack matching desktop DayColumn styling */}
      <div className="border-t border-hobo-lineDark divide-y divide-hobo-lineDark">
        {weekDays.map((dateStr) => {
          const dateObj = parseISO(dateStr);
          const today = isToday(dateObj);
          const dayOfWeekIdx = dateObj.getDay();
          const isSunday = dayOfWeekIdx === 0;
          const isSaturday = dayOfWeekIdx === 6;

          const dayEvents = weekEvents.filter(
            (ev) => ev.event_date === dateStr && !ev.is_hidden
          );
          const dayTasks = datedTasks.filter(
            (t) => t.assigned_date === dateStr
          );
          const draft = draftsByDay[dateStr] ?? "";

          return (
            <div
              key={dateStr}
              data-task-drop-zone={`day:${dateStr}`}
              className={`py-2 flex gap-2 ${
                today ? "bg-hobo-redSoft/30" : ""
              }`}
            >
              {/* Left Day Label Column */}
              <button
                type="button"
                onClick={() => onSelectDayForEvents?.(dateStr)}
                className="w-8 shrink-0 text-left flex flex-col items-start pt-0.5 bg-transparent border-0"
              >
                <span
                  className={`text-xl leading-none font-light ${
                    today
                      ? "text-hobo-red font-normal"
                      : isSaturday || isSunday
                      ? "text-hobo-muted font-light"
                      : "text-hobo-ink font-light"
                  }`}
                >
                  {format(dateObj, "d")}
                </span>
                <span
                  className={`mt-0.5 text-[10px] uppercase tracking-[0.12em] ${
                    today ? "text-hobo-red" : "text-hobo-muted"
                  }`}
                >
                  {format(dateObj, "EEE")}
                </span>
              </button>

              {/* Right Content Column: Events + Tasks + Inline Add */}
              <div className="min-w-0 flex-1 space-y-0">
                {dayEvents.length > 0 && (
                  <div className="space-y-0 pb-0.5">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.instance_key}
                        type="button"
                        onClick={() => onSelectDayForEvents?.(dateStr)}
                        className="w-full px-0 py-0 bg-transparent border-0 text-left flex items-baseline gap-1.5 text-[11px] leading-[16px] text-hobo-red select-none"
                      >
                        <span className="shrink-0 font-normal text-[10px] tracking-tight opacity-90">
                          {formatEventTimeShort(ev)}
                        </span>
                        <span className="truncate font-light">{ev.title}</span>
                      </button>
                    ))}
                  </div>
                )}

                {dayTasks.map((task) => (
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
                    if (!draft.trim()) return;
                    onAddTaskInDay(dateStr, draft.trim());
                    setDraftsByDay((prev) => ({ ...prev, [dateStr]: "" }));
                  }}
                  className="flex items-center gap-1.5 pt-0.5"
                >
                  <Plus className="w-3.5 h-3.5 text-hobo-faint shrink-0" />
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) =>
                      setDraftsByDay((prev) => ({
                        ...prev,
                        [dateStr]: e.target.value,
                      }))
                    }
                    className="w-full text-[12px] bg-transparent text-hobo-ink outline-none py-0.5"
                  />
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
