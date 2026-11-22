import React, { useMemo } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GoogleEvent } from "../types/planner";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CollapsibleMonthCalendarProps {
  currentMonthDate: Date;
  selectedDate: string | null;
  monthEvents: GoogleEvent[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onResetToday: () => void;
  onSelectDate: (dateStr: string) => void;
}

export const CollapsibleMonthCalendar: React.FC<
  CollapsibleMonthCalendarProps
> = ({
  currentMonthDate,
  selectedDate,
  monthEvents,
  onPrevMonth,
  onNextMonth,
  onResetToday,
  onSelectDate,
}) => {
  const monthStart = startOfMonth(currentMonthDate);
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventDates = useMemo(() => {
    const set = new Set<string>();
    for (const ev of monthEvents) {
      if (!ev.is_hidden) set.add(ev.event_date);
    }
    return set;
  }, [monthEvents]);

  const monthNumber = format(currentMonthDate, "M");
  const monthNameUpper = format(currentMonthDate, "MMMM").toUpperCase();
  const yearStr = format(currentMonthDate, "yyyy");

  return (
    <div className="px-3.5 pt-1 pb-3 bg-hobo-paperSolid border-b border-hobo-lineDark select-none">
      {/* Header matching desktop MonthGrid: "JUNE 6月 2027" + < Today > */}
      <div className="pb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-base leading-none tracking-[0.06em] font-normal text-hobo-ink">
            {monthNameUpper}
          </span>
          <span className="text-[11px] leading-none text-hobo-muted tracking-wide">
            {monthNumber}月 {yearStr}
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={onPrevMonth}
            className="inline-flex items-center justify-center p-1 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            <ChevronLeft className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
          <button
            type="button"
            onClick={onResetToday}
            className="inline-flex items-center justify-center px-1 py-0 text-[10px] leading-none uppercase tracking-[0.12em] text-hobo-ink hover:text-hobo-red bg-transparent border-0 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="inline-flex items-center justify-center p-1 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* 7-column Mon–Sun grid (no day-of-year counter, no weather) */}
      <div className="border-t border-l border-hobo-lineDark">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className={`border-r border-b border-hobo-lineDark py-1 text-center text-[10px] uppercase tracking-[0.1em] ${
                wd === "Sun" ? "text-hobo-red" : "text-hobo-muted"
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, currentMonthDate);
            const today = isToday(day);
            const selected = selectedDate === dateStr;
            const hasEvents = eventDates.has(dateStr);
            const isSunday = idx % 7 === 6;

            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => onSelectDate(dateStr)}
                className={`relative h-10 border-r border-b border-hobo-lineDark flex items-center justify-center transition-colors ${
                  today ? "bg-hobo-redSoft" : "hover:bg-hobo-paperHover"
                } ${selected ? "ring-1 ring-inset ring-hobo-ink" : ""}`}
              >
                <span
                  className={`text-xs leading-none ${
                    !inMonth
                      ? "text-hobo-faint"
                      : today || isSunday
                      ? "text-hobo-red font-normal"
                      : "text-hobo-ink"
                  }`}
                >
                  {format(day, "d")}
                </span>
                {hasEvents && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-hobo-red block" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
