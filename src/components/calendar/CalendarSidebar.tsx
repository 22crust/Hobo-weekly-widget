import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  CalendarToolId,
  getSavedCalendarTools,
  saveCalendarTools,
  subscribeCalendarTools,
  toggleCalendarToolInOrder,
} from "../../../shared/calendarTools";
import { usePlannerData } from "../../hooks/usePlannerData";
import { subscribeMidnightRollover } from "../../../shared/plannerCore";
import { queueDebouncedGithubPush } from "../../services/githubSyncService";
import { WeeklyImageLayer } from "../planner/WeeklyImageLayer";
import { MonthGrid } from "./MonthGrid";
import { AgendaList } from "./AgendaList";
import { YearProgressGrid } from "./YearProgressGrid";
import { MoodTrackerTool } from "./MoodTrackerTool";
import { DateCountersTool } from "./DateCountersTool";
import { ManageToolsModal } from "./ManageToolsModal";

export const CALENDAR_PERMANENT_STICKER_SCOPE = "calendar-permanent";

interface CalendarSidebarProps {
  onHoverChange?: (
    cursor: { xPct: number; yPct: number } | null
  ) => void;
}

/**
 * Expandable Left Monthly Calendar Sidebar.
 * Includes its own permanent sticker layer (`week_start = "calendar-permanent"`) rendered
 * above the calendar borders/lines and underneath all text elements.
 */
export const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  onHoverChange,
}) => {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [visibleTools, setVisibleTools] = useState<CalendarToolId[]>(() =>
    getSavedCalendarTools()
  );
  const [isManageToolsOpen, setIsManageToolsOpen] = useState(false);
  const [isAddingCounter, setIsAddingCounter] = useState(false);
  const [counterContextMenu, setCounterContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    return subscribeCalendarTools(setVisibleTools);
  }, []);

  // Automatically advance to the new current month when the real-world month rolls over
  const lastRealMonthRef = useRef<string>(format(new Date(), "yyyy-MM"));
  useEffect(() => {
    return subscribeMidnightRollover(() => {
      const now = new Date();
      const nowMonth = format(now, "yyyy-MM");
      if (nowMonth !== lastRealMonthRef.current) {
        lastRealMonthRef.current = nowMonth;
        setCurrentMonth(now);
      }
    });
  }, []);

  useEffect(() => {
    if (!counterContextMenu) return;
    const close = () => setCounterContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [counterContextMenu]);

  const handleToggleTool = (toolId: CalendarToolId, nextVisible: boolean) => {
    const next = toggleCalendarToolInOrder(visibleTools, toolId, nextVisible);
    saveCalendarTools(next);
    setVisibleTools(next);
    void queueDebouncedGithubPush();
  };
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  const rangeStart = format(
    startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
    "yyyy-MM-dd"
  );
  const rangeEnd = format(
    endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }),
    "yyyy-MM-dd"
  );

  const {
    googleEvents,
    datedTasks,
    calendarImages,
    addLocalEvent,
    editLocalEvent,
    editLocalEventThisOnly,
    editLocalEventFuture,
    removeLocalEvent,
    removeLocalEventThisOnly,
    removeLocalEventFuture,
    toggleTask,
    editTask,
    removeTask,
    editWeekImage,
    removeWeekImage,
  } = usePlannerData(rangeStart, rangeEnd, false);

  const eventDatesSet = useMemo(() => {
    const set = new Set<string>();
    for (const ev of googleEvents) {
      set.add(ev.event_date);
    }
    return set;
  }, [googleEvents]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return googleEvents.filter((ev) => ev.event_date === selectedDate);
  }, [googleEvents, selectedDate]);

  const selectedDayTasks = useMemo(() => {
    if (!selectedDate) return [];
    return datedTasks.filter(
      (t) => t.assigned_date === selectedDate && t.show_in_weekly
    );
  }, [datedTasks, selectedDate]);

  const handleSelectDate = (dateStr: string) => {
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr));
    try {
      const clickedDate = parseISO(dateStr);
      if (clickedDate.getMonth() !== currentMonth.getMonth()) {
        setCurrentMonth(clickedDate);
      }
    } catch {
      // Ignore parse error
    }
  };

  const handleResetToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setSelectedDate(format(now, "yyyy-MM-dd"));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = sidebarRef.current;
    if (!el || !onHoverChange) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    onHoverChange({ xPct, yPct });
  };

  return (
    <div
      ref={sidebarRef}
      data-sticker-drop-zone="calendar"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHoverChange?.(null)}
      style={{ paddingBottom: "24px" }}
      className="relative w-[340px] shrink-0 h-full flex flex-col overflow-hidden"
    >
      {/* Vertical separator line matching the weekly/task separator length (stops 24px above bottom edge) */}
      <div className="flex-1 min-h-0 flex flex-col border-r border-hobo-lineDark overflow-hidden">
        {/* Permanent Calendar Sticker Layer (persists across all months/weeks until deleted) */}
        <WeeklyImageLayer
          images={calendarImages}
          containerRef={sidebarRef}
          onUpdateImage={editWeekImage}
          onDeleteImage={removeWeekImage}
        />

        <MonthGrid
          currentMonth={currentMonth}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onPrevMonth={() => setCurrentMonth((m) => subMonths(m, 1))}
          onNextMonth={() => setCurrentMonth((m) => addMonths(m, 1))}
          onResetToday={handleResetToday}
          eventDatesSet={eventDatesSet}
        />

        {selectedDate ? (
          <AgendaList
            selectedDate={selectedDate}
            events={selectedDayEvents}
            tasks={selectedDayTasks}
            onClearSelection={() => setSelectedDate(null)}
            onCreateLocalEvent={async (input) => {
              await addLocalEvent(input);
            }}
            onUpdateLocalEvent={editLocalEvent}
            onUpdateLocalEventThisOnly={editLocalEventThisOnly}
            onUpdateLocalEventFuture={editLocalEventFuture}
            onDeleteLocalEvent={removeLocalEvent}
            onDeleteLocalEventThisOnly={removeLocalEventThisOnly}
            onDeleteLocalEventFuture={removeLocalEventFuture}
            onToggleTask={toggleTask}
            onEditTaskTitle={(id, title) => editTask(id, { title })}
            onDeleteTask={removeTask}
          />
        ) : (
          <div
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCounterContextMenu(null);
              setIsManageToolsOpen(true);
            }}
            className="flex-1 min-h-0 overflow-y-auto divide-y divide-hobo-line/70"
          >
            {visibleTools.map((toolId) => {
              if (toolId === "year_in_days") {
                return (
                  <YearProgressGrid
                    key={toolId}
                    yearDate={currentMonth}
                    onSelectDate={handleSelectDate}
                  />
                );
              }
              if (toolId === "mood_tracker") {
                return (
                  <MoodTrackerTool
                    key={toolId}
                    initialYear={currentMonth.getFullYear()}
                  />
                );
              }
              if (toolId === "date_counters") {
                return (
                  <DateCountersTool
                    key={toolId}
                    isAddingExternal={isAddingCounter}
                    onCloseAddExternal={() => setIsAddingCounter(false)}
                    onContextMenuOpen={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCounterContextMenu({ x: e.clientX, y: e.clientY });
                    }}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* Right-Click Menu on Date Counters Tool */}
      {counterContextMenu &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(counterContextMenu.x, window.innerWidth - 140)}px`,
              top: `${Math.min(counterContextMenu.y, window.innerHeight - 90)}px`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="z-[80] w-fit bg-hobo-paperSolid border border-hobo-lineDark shadow-md py-1 text-[11px] font-light select-none"
          >
            <button
              type="button"
              onClick={() => {
                setCounterContextMenu(null);
                setIsAddingCounter(true);
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Add date counter
            </button>
            <button
              type="button"
              onClick={() => {
                setCounterContextMenu(null);
                setIsManageToolsOpen(true);
              }}
              className="block w-full text-left px-2.5 py-1 whitespace-nowrap text-hobo-ink hover:bg-hobo-paperHover hover:text-hobo-red bg-transparent border-0 transition-colors"
            >
              Manage tools
            </button>
          </div>,
          document.body
        )}

      <ManageToolsModal
        isOpen={isManageToolsOpen}
        visibleTools={visibleTools}
        onToggleTool={handleToggleTool}
        onClose={() => setIsManageToolsOpen(false)}
      />
    </div>
  );
};
