import React from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

interface MiniMonthCalendarProps {
  weekStartDate: string; // YYYY-MM-DD (Monday)
  weekEndDate: string;   // YYYY-MM-DD (Sunday)
}

const HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Compact Hobonichi Weeks bottom-right miniature reference calendar:
 * - Both the M T W T F S S header row and every week row use the exact same
 *   `px-1` horizontal padding and 7 fixed-width `w-[13px]` columns so letters
 *   and numbers align vertically column-for-column.
 * - Weekday numbers (Mon–Fri) are bold (`font-semibold`), while Sat/Sun stay light.
 * - Sized compactly (`text-[7.5px] leading-[9.5px]`) so even 6-week months never
 *   overlap the bottom border of the Tasks grid above it.
 */
export const MiniMonthCalendar: React.FC<MiniMonthCalendarProps> = ({
  weekStartDate,
  weekEndDate,
}) => {
  const refDate = parseISO(weekStartDate);
  const wStart = parseISO(weekStartDate);
  const wEnd = parseISO(weekEndDate);

  const mStart = startOfMonth(refDate);
  const mEnd = endOfMonth(refDate);
  const gStart = startOfWeek(mStart, { weekStartsOn: 1 });
  const gEnd = endOfWeek(mEnd, { weekStartsOn: 1 });

  const allDays = eachDayOfInterval({ start: gStart, end: gEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }

  return (
    <div className="select-none text-[7.5px] leading-[9.5px] text-hobo-ink">
      {/* Weekday single-letter row — identical px-1 and column widths as number rows */}
      <div className="grid grid-cols-7 px-1 border border-transparent text-center mb-[1px] text-hobo-muted font-normal">
        {HEADERS.map((h, i) => (
          <span
            key={i}
            className={`w-[13px] text-center ${i === 6 ? "text-hobo-red" : ""}`}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Week rows with pill border around active week */}
      <div className="space-y-0">
        {weeks.map((weekDays, rIdx) => {
          const isCurrentWeekRow = weekDays.some((d) =>
            isWithinInterval(d, { start: wStart, end: wEnd })
          );

          return (
            <div
              key={rIdx}
              className="relative grid grid-cols-7 items-center px-1 h-[10px] text-center"
            >
              {isCurrentWeekRow && (
                <div className="pointer-events-none absolute inset-x-[2px] -top-[0.5px] bottom-[0.5px] border border-hobo-ink/75 rounded-full" />
              )}
              {weekDays.map((d, cIdx) => {
                const inMonth = isSameMonth(d, refDate);
                const isSun = cIdx === 6;
                const isWeekday = cIdx < 5;
                return (
                  <span
                    key={d.toISOString()}
                    className={`w-[13px] text-center leading-none ${
                      !inMonth
                        ? "opacity-0 pointer-events-none"
                        : isSun
                        ? "text-hobo-red font-normal"
                        : isWeekday
                        ? "text-hobo-ink font-semibold"
                        : "text-hobo-ink font-normal"
                    }`}
                  >
                    {format(d, "d")}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
