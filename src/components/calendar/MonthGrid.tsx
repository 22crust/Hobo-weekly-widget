import React from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MonthGridProps {
  currentMonth: Date;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  onJumpToDate?: (dateStr: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onResetToday: () => void;
  eventDatesSet: Set<string>;
}

const WEEKDAYS = [
  { kanji: "月", eng: "MON", isSunday: false },
  { kanji: "火", eng: "TUE", isSunday: false },
  { kanji: "水", eng: "WED", isSunday: false },
  { kanji: "木", eng: "THU", isSunday: false },
  { kanji: "金", eng: "FRI", isSunday: false },
  { kanji: "土", eng: "SAT", isSunday: false },
  { kanji: "日", eng: "SUN", isSunday: true },
];

export const MonthGrid: React.FC<MonthGridProps> = ({
  currentMonth,
  selectedDate,
  onSelectDate,
  onJumpToDate,
  onPrevMonth,
  onNextMonth,
  onResetToday,
  eventDatesSet,
}) => {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const monthNumber = format(currentMonth, "M");
  const monthNameUpper = format(currentMonth, "MMMM").toUpperCase();
  const yearStr = format(currentMonth, "yyyy");

  return (
    <div className="px-3.5 pb-2 select-none pointer-events-none">
      {/* Hobonichi Monthly Header: "JUNE 6月 2027" + < Today > (pt-1 pb-1.5 matches WeekBoard top line) */}
      <div className="relative z-10 pt-1 pb-1.5 flex items-center justify-between pointer-events-auto">
        <div className="flex items-baseline gap-2">
          <span className="text-lg leading-none tracking-[0.06em] font-normal text-hobo-ink">
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
            className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
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
            className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            <ChevronRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </div>

      {/* 7-column Mon–Sun boxed table (borders at default layer so stickers sit over lines, text at z-10) */}
      <div className="border-t border-l border-hobo-lineDark">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd.eng}
              className={`border-r border-b border-hobo-lineDark py-1 px-1 flex items-center justify-center gap-1 text-[9px] tracking-[0.08em] ${
                wd.isSunday ? "text-hobo-red" : "text-hobo-ink"
              }`}
            >
              <span className="relative z-10 opacity-80">{wd.kanji}</span>
              <span className="relative z-10 font-normal">{wd.eng}</span>
            </div>
          ))}
        </div>

        {/* Date Cells */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, currentMonth);
            const isToday = dateStr === todayStr;
            const isSelected = selectedDate === dateStr;
            const hasEvents = eventDatesSet.has(dateStr);
            const isSunday = idx % 7 === 6;

            return (
              <div
                key={dateStr}
                onClick={() => onSelectDate(dateStr)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onJumpToDate?.(dateStr);
                }}
                className={`relative h-11 border-r border-b border-hobo-lineDark flex flex-col items-start justify-between p-1 text-left transition-colors pointer-events-auto cursor-pointer hover:bg-hobo-Divide/40 ${
                  isToday ? "bg-hobo-redSoft" : ""
                } ${
                  isSelected
                    ? "ring-1 ring-inset ring-hobo-ink"
                    : ""
                }`}
              >
                <div className="relative z-10 w-full flex items-center justify-between px-0.5 leading-none pointer-events-none">
                  <span
                    className={`text-[11px] ${
                      !inMonth
                        ? "text-hobo-faint"
                        : isToday || isSunday
                        ? "text-hobo-red font-normal"
                        : "text-hobo-ink"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {hasEvents && (
                    <span className="w-1.5 h-1.5 rounded-full bg-hobo-red block shrink-0" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
