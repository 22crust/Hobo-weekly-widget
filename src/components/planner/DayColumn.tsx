import React, { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, Plus } from "lucide-react";
import { DailyWeather, GoogleEvent, LocalTask } from "../../types/planner";
import { GoogleEventCard } from "../common/GoogleEventCard";
import {
  getActiveDraggedTaskId,
  setActiveDraggedTaskId,
  TaskItem,
} from "../common/TaskItem";
import { WeatherIcon } from "../common/WeatherIcon";
import { formatTemperature, TemperatureUnit } from "../../services/weatherService";

interface DayColumnProps {
  dateStr: string; // YYYY-MM-DD
  dayIndex: number; // 0 = Mon .. 6 = Sun
  rowHeightPx: number;
  events: GoogleEvent[];
  tasks: LocalTask[];
  weather?: DailyWeather;
  temperatureUnit?: TemperatureUnit;
  onHideGoogleEvent: (id: number, event?: GoogleEvent) => void;
  onUnhideAllForDay: (dateStr: string) => void;
  onAddTask: (title: string, dateStr: string) => void;
  onToggleTask: (id: number, isCompleted: boolean) => void;
  onEditTaskTitle: (id: number, newTitle: string) => void;
  onDeleteTask: (id: number) => void;
  onMoveTaskToDate: (id: number, targetDateStr: string) => void;
  onMoveTaskToWeeklySidebar: (id: number) => void;
  onMoveTaskToLongTermSidebar: (id: number) => void;
}

const KANJI_BY_INDEX = ["月", "火", "水", "木", "金", "土", "日"];
const ENG_BY_INDEX = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const DayColumn: React.FC<DayColumnProps> = ({
  dateStr,
  dayIndex,
  rowHeightPx,
  events,
  tasks,
  weather,
  temperatureUnit = "C",
  onHideGoogleEvent,
  onUnhideAllForDay,
  onAddTask,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onMoveTaskToDate,
  onMoveTaskToWeeklySidebar,
  onMoveTaskToLongTermSidebar,
}) => {
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const rowRef = useRef<HTMLDivElement | null>(null);

  const dateObj = parseISO(dateStr);
  const dayNum = format(dateObj, "d");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isToday = dateStr === todayStr;
  const isSunday = dayIndex === 6;

  const visibleEvents = events.filter((ev) => !ev.is_hidden);
  const hiddenCount = events.length - visibleEvents.length;

  const onMoveRef = useRef(onMoveTaskToDate);
  onMoveRef.current = onMoveTaskToDate;

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    const handlePointerDrop = (e: Event) => {
      const custom = e as CustomEvent<{ taskId: number }>;
      const taskId = custom.detail?.taskId ?? getActiveDraggedTaskId();
      if (taskId && taskId > 0) {
        onMoveRef.current(taskId, dateStr);
        setActiveDraggedTaskId(null);
      }
    };

    el.addEventListener("planner:task-pointer-drop", handlePointerDrop);
    return () =>
      el.removeEventListener("planner:task-pointer-drop", handlePointerDrop);
  }, [dateStr]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && newTaskTitle.trim()) {
      e.preventDefault();
      onAddTask(newTaskTitle.trim(), dateStr);
      setNewTaskTitle("");
    }
  };

  return (
    <div
      ref={rowRef}
      data-task-drop-zone={`day:${dateStr}`}
      style={{ height: dayIndex < 6 ? `${rowHeightPx}px` : undefined }}
      className={`relative flex transition-colors ${
        dayIndex < 6 ? "shrink-0 border-b border-hobo-lineDark" : "flex-1 min-h-0"
      } ${isToday ? "bg-hobo-redSoft" : "bg-transparent"}`}
    >
      {/* Left Date Column matching Hobonichi Weeks (21 / MON / 月 / Weather Icon + custom red-text hover)
          Note: border-r is at the default layer (no z-10) so stickers render on top of the day separator line,
          while each text/icon child has relative z-10 so text stays on top of stickers! */}
      <div className="w-12 shrink-0 border-r border-hobo-line flex flex-col items-center justify-start pt-1.5 pb-1 select-none pointer-events-none">
        <span
          className={`relative z-10 text-[20px] leading-none font-light tracking-tight ${
            isSunday || isToday ? "text-hobo-red" : "text-hobo-ink"
          }`}
        >
          {dayNum}
        </span>
        <span
          className={`relative z-10 mt-0.5 text-[8px] tracking-[0.12em] ${
            isSunday || isToday ? "text-hobo-red" : "text-hobo-ink"
          }`}
        >
          {ENG_BY_INDEX[dayIndex]}
        </span>
        <span
          className={`relative z-10 text-[8px] leading-tight ${
            isSunday || isToday ? "text-hobo-red/85" : "text-hobo-muted"
          }`}
        >
          {KANJI_BY_INDEX[dayIndex]}
        </span>

        {/* Minimalist weather forecast icon with custom borderless red-text hover */}
        <div className="group/weather relative z-10 mt-1 flex flex-col items-center pointer-events-auto">
          <WeatherIcon
            code={weather?.weatherCode ?? 0}
            className={`w-3 h-3 stroke-[1.35] transition-colors ${
              isSunday || isToday
                ? "text-hobo-red/85 group-hover/weather:text-hobo-red"
                : "text-hobo-ink/75 group-hover/weather:text-hobo-red"
            }`}
          />
          {weather && (
            <span className="pointer-events-none opacity-0 group-hover/weather:opacity-100 transition-opacity absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-hobo-red font-normal z-30">
              {formatTemperature(weather.tempMax, temperatureUnit)} /{" "}
              {formatTemperature(weather.tempMin, temperatureUnit)}
            </span>
          )}
        </div>
      </div>

      {/* Right Unified Schedule + Local Tasks Zone */}
      <div className="relative flex-1 min-w-0 flex flex-col justify-start px-2 py-1 overflow-y-auto pointer-events-none">
        {/* Stylistic dots dividing the top line into equal thirds from the day separation line */}
        <span className="absolute -top-[1.5px] left-1/3 w-[2px] h-[2px] rounded-full bg-hobo-ink/60 pointer-events-none" />
        <span className="absolute -top-[1.5px] left-2/3 w-[2px] h-[2px] rounded-full bg-hobo-ink/60 pointer-events-none" />

        {/* Floating red down arrow on the right-hand side when any Google Calendar event is hidden (takes 0 rows of task space) */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => onUnhideAllForDay(dateStr)}
            className="absolute top-1 right-1.5 z-20 p-0.5 text-hobo-red hover:opacity-75 transition-opacity bg-transparent border-0 outline-none pointer-events-auto"
          >
            <ChevronDown className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>
        )}

        {/* Top Zone: Locked Google Calendar Events */}
        {visibleEvents.length > 0 && (
          <div className="relative z-10 space-y-0.5 mb-0.5 pr-4 pointer-events-auto">
            {visibleEvents.map((ev) => (
              <GoogleEventCard
                key={ev.instance_key}
                event={ev}
                onHide={onHideGoogleEvent}
                compact
              />
            ))}
          </div>
        )}

        {/* Existing Local Tasks */}
        <div className="relative z-10 space-y-0.5 pointer-events-auto">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onToggleComplete={onToggleTask}
              onEditTitle={onEditTaskTitle}
              onDelete={onDeleteTask}
              onMoveToDate={onMoveTaskToDate}
              onMoveToWeeklySidebar={onMoveTaskToWeeklySidebar}
              onMoveToLongTermSidebar={onMoveTaskToLongTermSidebar}
            />
          ))}
        </div>

        {/* "+" Task prompt positioned right underneath existing tasks, only a plus sign */}
        <div className="relative z-10 flex items-center gap-1 py-[1px] pointer-events-auto">
          <Plus className="w-2.5 h-2.5 text-hobo-muted shrink-0 stroke-[1.5]" />
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder=""
            className="w-full bg-transparent text-[12px] leading-[16px] text-hobo-ink outline-none border-0 p-0 font-light"
          />
        </div>
      </div>
    </div>
  );
};
