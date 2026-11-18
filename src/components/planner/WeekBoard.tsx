import React, { useEffect, useRef, useState } from "react";
import { addDays, format, getISOWeek, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  CreateWeekImageInput,
  CurrentWeatherSummary,
  DailyWeather,
  GoogleEvent,
  LocalTask,
  UpdateWeekImageInput,
  WeekImage,
} from "../../types/planner";
import { WeatherIcon } from "../common/WeatherIcon";
import {
  getActiveDraggedTaskId,
  setActiveDraggedTaskId,
  TaskItem,
} from "../common/TaskItem";
import { DayColumn } from "./DayColumn";
import { MiniMonthCalendar } from "./MiniMonthCalendar";
import { CrispSquareGrid } from "./CrispSquareGrid";
import { WeeklyImageLayer } from "./WeeklyImageLayer";

interface WeekBoardProps {
  weekStartDate: string; // Monday YYYY-MM-DD
  weekEndDate: string;   // Sunday YYYY-MM-DD
  googleEvents: GoogleEvent[];
  datedTasks: LocalTask[];
  weeklySidebarTasks: LocalTask[];
  longTermSidebarTasks: LocalTask[];
  weekImages: WeekImage[];
  dailyWeatherByDate: Record<string, DailyWeather>;
  currentWeather: CurrentWeatherSummary | null;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onResetThisWeek: () => void;
  onHideGoogleEvent: (id: number, event?: GoogleEvent) => void;
  onUnhideAllForDay: (dateStr: string) => void;
  onAddTaskInDay: (title: string, dateStr: string) => void;
  onAddWeeklySidebarTask: (title: string) => void;
  onAddLongTermSidebarTask: (title: string) => void;
  onToggleTask: (id: number, isCompleted: boolean) => void;
  onEditTaskTitle: (id: number, newTitle: string) => void;
  onDeleteTask: (id: number) => void;
  onMoveTaskToDate: (id: number, targetDateStr: string) => void;
  onMoveTaskToWeeklySidebar: (id: number) => void;
  onMoveTaskToLongTermSidebar: (id: number) => void;
  onMigrateTaskToPrevWeek: (id: number) => void;
  onMigrateTaskToNextWeek: (id: number) => void;
  onClearCompletedWeeklySidebar: () => void;
  onClearCompletedLongTermSidebar: () => void;
  onAddWeekImage: (input: CreateWeekImageInput) => void;
  onUpdateWeekImage: (id: string, updates: UpdateWeekImageInput) => void;
  onDeleteWeekImage: (id: string) => void;
  calendarHoverRef?: React.RefObject<{ xPct: number; yPct: number } | null>;
  notesHoverRef?: React.RefObject<{
    pageId: string;
    xPct: number;
    yPct: number;
  } | null>;
}

const SIDE_BORDER_PX = 16;   // 16px side border space
const BOTTOM_BORDER_PX = 24; // 1.5 * 16px = 24px bottom border space

const CELLS_PER_DAY = 5;
const TOTAL_WEEK_GRID_ROWS = 7 * CELLS_PER_DAY; // 35
const TASKS_BOX_GRID_ROWS = 6 * CELLS_PER_DAY;  // 30
const MIN_GRID_PX = 15;
const MAX_GRID_PX = 22;

const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?(#.*)?$/i;

function isLikelyImageUrl(text: string): boolean {
  if (!text.startsWith("http://") && !text.startsWith("https://")) {
    return false;
  }
  try {
    const parsed = new URL(text);
    return IMAGE_EXTENSION_REGEX.test(parsed.pathname);
  } catch {
    return false;
  }
}

function verifyUrlLoadsAsImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 5000);

    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(true);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(false);
      }
    };
    img.src = url;
  });
}

export const WeekBoard: React.FC<WeekBoardProps> = ({
  weekStartDate,
  weekEndDate,
  googleEvents,
  datedTasks,
  weeklySidebarTasks,
  longTermSidebarTasks,
  weekImages,
  dailyWeatherByDate,
  currentWeather,
  onPrevWeek,
  onNextWeek,
  onResetThisWeek,
  onHideGoogleEvent,
  onUnhideAllForDay,
  onAddTaskInDay,
  onAddWeeklySidebarTask,
  onAddLongTermSidebarTask,
  onToggleTask,
  onEditTaskTitle,
  onDeleteTask,
  onMoveTaskToDate,
  onMoveTaskToWeeklySidebar,
  onMoveTaskToLongTermSidebar,
  onMigrateTaskToPrevWeek,
  onMigrateTaskToNextWeek,
  onClearCompletedWeeklySidebar,
  onClearCompletedLongTermSidebar,
  onAddWeekImage,
  onUpdateWeekImage,
  onDeleteWeekImage,
  calendarHoverRef,
  notesHoverRef,
}) => {
  const startObj = parseISO(weekStartDate);
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    format(addDays(startObj, i), "yyyy-MM-dd")
  );

  const [weeklyDraft, setWeeklyDraft] = useState("");
  const [longTermDraft, setLongTermDraft] = useState("");

  const spreadContainerRef = useRef<HTMLDivElement | null>(null);
  const tasksBoxRef = useRef<HTMLDivElement | null>(null);
  const weeklySectionRef = useRef<HTMLDivElement | null>(null);
  const longTermSectionRef = useRef<HTMLDivElement | null>(null);

  // Track last cursor (x%, y%) over the planner spread for Ctrl+V / Cmd+V sticker placement
  const lastCursorPctRef = useRef<{ xPct: number; yPct: number } | null>(null);

  const [gridSizePx, setGridSizePx] = useState<number>(17);
  const [tasksBoxWidthPx, setTasksBoxWidthPx] = useState<number>(400);
  // Draggable vertical separator percentage (default 50% center, double-click to reset to 50%)
  const [leftSplitPct, setLeftSplitPct] = useState<number>(50);
  // Draggable horizontal split ratio between Weekly Tasks and Long-Term Tasks (default 0.5 center)
  const [tasksSplitRatio, setTasksSplitRatio] = useState<number>(0.5);

  const handleTasksSplitPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    e.preventDefault();
    e.stopPropagation();

    const tasksEl = tasksBoxRef.current;
    if (!tasksEl) return;

    const MIN_SECTION_HEIGHT_PX = 64;
    const startClientY = e.clientY;
    const initialRatio = tasksSplitRatio;

    const onPointerMove = (moveEv: PointerEvent) => {
      const rect = tasksEl.getBoundingClientRect();
      if (rect.height <= MIN_SECTION_HEIGHT_PX * 2) return;
      const minRatio = MIN_SECTION_HEIGHT_PX / rect.height;
      const maxRatio = 1 - minRatio;
      const dyRatio = (moveEv.clientY - startClientY) / rect.height;
      const nextRatio = Math.max(
        minRatio,
        Math.min(maxRatio, initialRatio + dyRatio)
      );
      setTasksSplitRatio(nextRatio);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleTasksSplitDoubleClick = (
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    setTasksSplitRatio(0.5);
  };

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = spreadContainerRef.current;
    if (!container) return;

    const MIN_PANE_WIDTH_PX = 250;

    const onPointerMove = (moveEv: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= MIN_PANE_WIDTH_PX * 2) return;
      const minPct = (MIN_PANE_WIDTH_PX / rect.width) * 100;
      const maxPct = 100 - minPct;
      const rawPct = ((moveEv.clientX - rect.left) / rect.width) * 100;
      const clampedPct = Math.max(minPct, Math.min(maxPct, rawPct));
      setLeftSplitPct(clampedPct);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleDividerDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setLeftSplitPct(50);
  };

  useEffect(() => {
    const el = spreadContainerRef.current;
    const tasksEl = tasksBoxRef.current;
    if (!el) return;

    const updateLayout = () => {
      const availableH = el.clientHeight - BOTTOM_BORDER_PX;
      if (availableH > 140) {
        const rawGrid = availableH / TOTAL_WEEK_GRID_ROWS;
        const clampedGrid = Math.max(MIN_GRID_PX, Math.min(MAX_GRID_PX, rawGrid));
        setGridSizePx(clampedGrid);
        document.documentElement.style.setProperty(
          "--hobo-grid-size",
          `${clampedGrid}px`
        );
      }
      if (tasksEl) {
        setTasksBoxWidthPx(tasksEl.clientWidth);
      }
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(el);
    if (tasksEl) observer.observe(tasksEl);
    return () => observer.disconnect();
  }, []);

  // Global Paste-Anywhere Listener (`Ctrl+V` / `Cmd+V`) for Weekly Stickers
  const weekStartRef = useRef(weekStartDate);
  weekStartRef.current = weekStartDate;
  const weekImagesRef = useRef(weekImages);
  weekImagesRef.current = weekImages;
  const onAddWeekImageRef = useRef(onAddWeekImage);
  onAddWeekImageRef.current = onAddWeekImage;

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      const rawText = e.clipboardData?.getData("text")?.trim() ?? "";
      if (!rawText.startsWith("http://") && !rawText.startsWith("https://")) {
        return;
      }

      const isImageExt = isLikelyImageUrl(rawText);
      const isValidImage = isImageExt || (await verifyUrlLoadsAsImage(rawText));
      if (!isValidImage) {
        return;
      }

      // If the cursor is currently over the Calendar sidebar, paste into the permanent calendar sticker layer!
      const calCursor = calendarHoverRef?.current;
      if (calCursor) {
        onAddWeekImageRef.current({
          week_start: "calendar-permanent",
          image_url: rawText,
          pos_x: Number(Math.max(2, Math.min(82, calCursor.xPct)).toFixed(2)),
          pos_y: Number(Math.max(2, Math.min(85, calCursor.yPct)).toFixed(2)),
          width: 140,
          height: null,
          z_index: 15,
          is_locked: false,
        });
        return;
      }

      // If the cursor is currently over the Notes sidebar, paste onto that specific note page!
      const notesCursor = notesHoverRef?.current;
      if (notesCursor) {
        onAddWeekImageRef.current({
          week_start: `note:${notesCursor.pageId}`,
          image_url: rawText,
          pos_x: Number(Math.max(2, Math.min(82, notesCursor.xPct)).toFixed(2)),
          pos_y: Number(Math.max(2, Math.min(92, notesCursor.yPct)).toFixed(2)),
          width: 140,
          height: null,
          z_index: 15,
          is_locked: false,
        });
        return;
      }

      const coords = lastCursorPctRef.current ?? { xPct: 40, yPct: 30 };
      const maxZ = weekImagesRef.current.reduce(
        (m, img) => Math.max(m, img.z_index || 10),
        10
      );

      onAddWeekImageRef.current({
        week_start: weekStartRef.current,
        image_url: rawText,
        pos_x: Number(Math.max(2, Math.min(85, coords.xPct)).toFixed(2)),
        pos_y: Number(Math.max(2, Math.min(85, coords.yPct)).toFixed(2)),
        width: 180,
        height: null,
        z_index: maxZ + 1,
        is_locked: false,
      });
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => window.removeEventListener("paste", handleGlobalPaste);
  }, []);

  const moveWeeklyRef = useRef(onMoveTaskToWeeklySidebar);
  moveWeeklyRef.current = onMoveTaskToWeeklySidebar;
  const moveLongTermRef = useRef(onMoveTaskToLongTermSidebar);
  moveLongTermRef.current = onMoveTaskToLongTermSidebar;

  // Pointer-based drop listeners for Weekly Tasks and Long-Term Tasks sections
  useEffect(() => {
    const weeklyEl = weeklySectionRef.current;
    const longTermEl = longTermSectionRef.current;

    const handleWeeklyPointerDrop = (e: Event) => {
      const custom = e as CustomEvent<{ taskId: number }>;
      const taskId = custom.detail?.taskId ?? getActiveDraggedTaskId();
      if (taskId && taskId > 0) {
        moveWeeklyRef.current(taskId);
        setActiveDraggedTaskId(null);
      }
    };

    const handleLongTermPointerDrop = (e: Event) => {
      const custom = e as CustomEvent<{ taskId: number }>;
      const taskId = custom.detail?.taskId ?? getActiveDraggedTaskId();
      if (taskId && taskId > 0) {
        moveLongTermRef.current(taskId);
        setActiveDraggedTaskId(null);
      }
    };

    weeklyEl?.addEventListener(
      "planner:task-pointer-drop",
      handleWeeklyPointerDrop
    );
    longTermEl?.addEventListener(
      "planner:task-pointer-drop",
      handleLongTermPointerDrop
    );

    return () => {
      weeklyEl?.removeEventListener(
        "planner:task-pointer-drop",
        handleWeeklyPointerDrop
      );
      longTermEl?.removeEventListener(
        "planner:task-pointer-drop",
        handleLongTermPointerDrop
      );
    };
  }, []);

  const handleSpreadMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = spreadContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    lastCursorPctRef.current = { xPct, yPct };
  };

  const dayRowHeightPx = CELLS_PER_DAY * gridSizePx;
  const totalSevenDaysHeightPx = TOTAL_WEEK_GRID_ROWS * gridSizePx;
  const tasksBoxHeightPx = TASKS_BOX_GRID_ROWS * gridSizePx;
  const weeklySectionHeightPx = Math.round(tasksBoxHeightPx * tasksSplitRatio);
  const longTermSectionHeightPx = tasksBoxHeightPx - weeklySectionHeightPx;

  const monthNameUpper = format(startObj, "MMMM").toUpperCase();
  const monthNum = format(startObj, "M");
  const yearStr = format(startObj, "yyyy");
  const isoWeekNum = getISOWeek(startObj);

  const getOrdinalSuffix = (n: number) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  };

  const completedWeeklyCount = weeklySidebarTasks.filter(
    (t) => t.is_completed
  ).length;
  const completedLongTermCount = longTermSidebarTasks.filter(
    (t) => t.is_completed
  ).length;

  return (
    <div
      style={{ "--hobo-grid-size": `${gridSizePx}px` } as React.CSSProperties}
      className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
    >
      {/* Top Headers Row (Left: Month + Week # | Right: Week Range + < This Week >) */}
      <div
        style={{
          gridTemplateColumns: `${leftSplitPct}% ${100 - leftSplitPct}%`,
        }}
        className="relative grid shrink-0"
      >
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 pt-1 pb-1.5 flex items-center justify-between select-none border-r border-hobo-lineDark"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-lg leading-none tracking-[0.06em] font-normal text-hobo-ink">
              {monthNameUpper}
            </span>
            <span className="text-[11px] leading-none text-hobo-muted tracking-wide">
              {monthNum}月 {yearStr}
            </span>
          </div>

          <span className="text-[10px] leading-none tracking-[0.12em] uppercase text-hobo-ink">
            {getOrdinalSuffix(isoWeekNum)} WEEK
          </span>
        </div>

        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 pt-1 pb-1.5 flex items-center justify-between select-none"
        >
          <span className="text-[11px] leading-none tracking-[0.1em] uppercase text-hobo-muted truncate">
            {format(parseISO(weekStartDate), "MMM d")} –{" "}
            {format(parseISO(weekEndDate), "MMM d, yyyy")}
          </span>

          {/* Week Switcher with vertically centered arrows */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onPrevWeek}
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
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
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
            >
              <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Two-Column Spread with Weekly Sticker Layer UNDER all text */}
      <div
        ref={spreadContainerRef}
        data-sticker-drop-zone="weekly"
        onMouseMove={handleSpreadMouseMove}
        style={{
          paddingBottom: `${BOTTOM_BORDER_PX}px`,
          gridTemplateColumns: `${leftSplitPct}% ${100 - leftSplitPct}%`,
        }}
        className="relative flex-1 min-h-0 grid overflow-hidden"
      >
        {/* Draggable Vertical Center Separator Hit Zone (double-click to reset to 50% center) */}
        <div
          style={{ left: `calc(${leftSplitPct}% - 4px)` }}
          onPointerDown={handleDividerPointerDown}
          onDoubleClick={handleDividerDoubleClick}
          className="absolute top-0 bottom-0 w-[8px] z-30 cursor-ew-resize select-none"
        />

        {/* Weekly Sticker Layer rendered underneath the text layer */}
        <WeeklyImageLayer
          images={weekImages}
          containerRef={spreadContainerRef}
          onUpdateImage={onUpdateWeekImage}
          onDeleteImage={onDeleteWeekImage}
        />

        {/* LEFT PAGE: 7-Day Horizontal Rows */}
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 h-full flex flex-col justify-start min-h-0 overflow-hidden border-r border-hobo-lineDark pointer-events-none"
        >
          <div
            style={{ height: `${totalSevenDaysHeightPx}px` }}
            className="border-t border-hobo-lineDark flex flex-col shrink-0 pointer-events-none"
          >
            {weekDays.map((dStr, idx) => {
              const dayEvents = googleEvents.filter(
                (ev) => ev.event_date === dStr
              );
              const dayTasks = datedTasks.filter(
                (t) => t.assigned_date === dStr && t.show_in_weekly
              );

              return (
                <DayColumn
                  key={dStr}
                  dateStr={dStr}
                  dayIndex={idx}
                  rowHeightPx={dayRowHeightPx}
                  events={dayEvents}
                  tasks={dayTasks}
                  weather={dailyWeatherByDate[dStr]}
                  onHideGoogleEvent={onHideGoogleEvent}
                  onUnhideAllForDay={onUnhideAllForDay}
                  onAddTask={onAddTaskInDay}
                  onToggleTask={onToggleTask}
                  onEditTaskTitle={onEditTaskTitle}
                  onDeleteTask={onDeleteTask}
                  onMoveTaskToDate={onMoveTaskToDate}
                  onMoveTaskToWeeklySidebar={onMoveTaskToWeeklySidebar}
                  onMoveTaskToLongTermSidebar={onMoveTaskToLongTermSidebar}
                />
              );
            })}
          </div>
        </div>

        {/* RIGHT PAGE: Tasks Box (30 * gridSizePx, aligned with Sat/Sun divider) + Footer (5 * gridSizePx, aligned with Sunday row) */}
        <div
          style={{
            paddingLeft: `${SIDE_BORDER_PX}px`,
            paddingRight: `${SIDE_BORDER_PX}px`,
          }}
          className="min-w-0 h-full flex flex-col justify-start min-h-0 overflow-hidden pointer-events-none"
        >
          <div
            style={{ height: `${totalSevenDaysHeightPx}px` }}
            className="flex flex-col justify-between shrink-0 pointer-events-none"
          >
            {/* Tasks Box with 100% Square Crisp SVG Grid */}
            <div
              ref={tasksBoxRef}
              style={{ height: `${tasksBoxHeightPx}px` }}
              className="border-t border-b border-hobo-lineDark relative flex flex-col shrink-0 overflow-hidden"
            >
              <CrispSquareGrid
                cellSizePx={gridSizePx}
                rows={TASKS_BOX_GRID_ROWS}
                widthPx={tasksBoxWidthPx}
              />

              {/* SECTION 1: WEEKLY TASKS */}
              <div
                ref={weeklySectionRef}
                data-task-drop-zone="weekly"
                style={{ height: `${weeklySectionHeightPx}px` }}
                className="relative z-10 shrink-0 flex flex-col px-3 py-1.5 overflow-hidden pointer-events-none"
              >
                <div className="flex items-center justify-between mb-1 select-none pointer-events-auto">
                  <span className="text-[10px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
                    WEEKLY TASKS
                  </span>

                  {completedWeeklyCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearCompletedWeeklySidebar}
                      className="text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
                    >
                      Clear completed
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1 pointer-events-none">
                  <div className="space-y-0.5 pointer-events-auto">
                    {weeklySidebarTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onToggleComplete={onToggleTask}
                        onEditTitle={onEditTaskTitle}
                        onDelete={onDeleteTask}
                        onMoveToDate={onMoveTaskToDate}
                        onMoveToLongTermSidebar={onMoveTaskToLongTermSidebar}
                        onMigratePrevWeek={onMigrateTaskToPrevWeek}
                        onMigrateNextWeek={onMigrateTaskToNextWeek}
                        showMigrationArrows
                      />
                    ))}
                  </div>

                  {/* "+" Task prompt directly underneath existing tasks */}
                  <div className="flex items-center gap-1 py-[1px] pointer-events-auto">
                    <Plus className="w-2.5 h-2.5 text-hobo-muted shrink-0 stroke-[1.5]" />
                    <input
                      type="text"
                      value={weeklyDraft}
                      onChange={(e) => setWeeklyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && weeklyDraft.trim()) {
                          e.preventDefault();
                          onAddWeeklySidebarTask(weeklyDraft.trim());
                          setWeeklyDraft("");
                        }
                      }}
                      placeholder=""
                      className="w-full bg-transparent text-[12px] leading-[16px] text-hobo-ink outline-none border-0 p-0 font-light"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: LONG-TERM TASKS (header is draggable up/down, double-click resets to center) */}
              <div
                ref={longTermSectionRef}
                data-task-drop-zone="longterm"
                style={{ height: `${longTermSectionHeightPx}px` }}
                className="relative z-10 shrink-0 flex flex-col px-3 py-1.5 overflow-hidden pointer-events-none"
              >
                <div
                  onPointerDown={handleTasksSplitPointerDown}
                  onDoubleClick={handleTasksSplitDoubleClick}
                  className="flex items-center justify-between mb-1 select-none pointer-events-auto cursor-ns-resize"
                >
                  <span className="text-[10px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
                    LONG-TERM TASKS
                  </span>

                  {completedLongTermCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearCompletedLongTermSidebar}
                      className="text-[9px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-red bg-transparent border-0 p-0 transition-colors"
                    >
                      Clear completed
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1 pointer-events-none">
                  <div className="space-y-0.5 pointer-events-auto">
                    {longTermSidebarTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onToggleComplete={onToggleTask}
                        onEditTitle={onEditTaskTitle}
                        onDelete={onDeleteTask}
                        onMoveToDate={onMoveTaskToDate}
                        onMoveToWeeklySidebar={onMoveTaskToWeeklySidebar}
                      />
                    ))}
                  </div>

                  {/* "+" Task prompt directly underneath existing tasks */}
                  <div className="flex items-center gap-1 py-[1px] pointer-events-auto">
                    <Plus className="w-2.5 h-2.5 text-hobo-muted shrink-0 stroke-[1.5]" />
                    <input
                      type="text"
                      value={longTermDraft}
                      onChange={(e) => setLongTermDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && longTermDraft.trim()) {
                          e.preventDefault();
                          onAddLongTermSidebarTask(longTermDraft.trim());
                          setLongTermDraft("");
                        }
                      }}
                      placeholder=""
                      className="w-full bg-transparent text-[12px] leading-[16px] text-hobo-ink outline-none border-0 p-0 font-light"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Page Bottom Footer: Sits inside the 7th slot (`height = dayRowHeightPx`), aligned at the bottom above the 24px border */}
            <div
              style={{ height: `${dayRowHeightPx}px` }}
              className="relative z-10 shrink-0 pt-1 flex items-end justify-between gap-2 select-none overflow-hidden pointer-events-none"
            >
              <div className="min-w-0 flex-1 text-[10px] leading-snug text-hobo-muted pointer-events-auto">
                {currentWeather && (
                  <div className="group/curweather flex items-start gap-2">
                    <WeatherIcon
                      code={currentWeather.weatherCode}
                      className="mt-0.5 w-3.5 h-3.5 shrink-0 stroke-[1.4] text-hobo-ink group-hover/curweather:text-hobo-red transition-colors"
                    />
                    <span className="group-hover/curweather:text-hobo-red transition-colors">
                      Today in{" "}
                      <strong className="font-normal text-hobo-ink group-hover/curweather:text-hobo-red">
                        {currentWeather.city}
                      </strong>
                      :{" "}
                      <strong className="font-normal text-hobo-ink group-hover/curweather:text-hobo-red">
                        {currentWeather.temperature}°C
                      </strong>
                      , {currentWeather.conditionLabel.toLowerCase()}.
                      <br />
                      High {currentWeather.tempMax}°C · Low {currentWeather.tempMin}°C.
                    </span>
                  </div>
                )}
              </div>

              <div className="shrink-0">
                <MiniMonthCalendar
                  weekStartDate={weekStartDate}
                  weekEndDate={weekEndDate}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
