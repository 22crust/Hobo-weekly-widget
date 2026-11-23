import React, { useCallback, useEffect, useState } from "react";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { Pencil, X } from "lucide-react";
import { useDatabaseSubscription } from "../../hooks/useDatabaseSubscription";
import {
  createDateCounter,
  deleteDateCounter,
  getActiveDateCounters,
  updateDateCounter,
} from "../../db/calendarToolsRepo";
import type { DateCounter } from "../../types/planner";

interface DateCountersToolProps {
  isAddingExternal?: boolean;
  onCloseAddExternal?: () => void;
  onContextMenuOpen: (e: React.MouseEvent) => void;
}

function formatCounterText(counter: DateCounter): string {
  const today = startOfDay(new Date());
  const target = startOfDay(parseISO(counter.target_date));
  const diff = differenceInCalendarDays(target, today);

  if (diff === 0) {
    return `Today: ${counter.title}`;
  }
  if (diff > 0) {
    return `${diff} day${diff === 1 ? "" : "s"} until ${counter.title}`;
  }
  const abs = Math.abs(diff);
  return `${abs} day${abs === 1 ? "" : "s"} since ${counter.title}`;
}

function formatCounterDateLabel(targetDate: string): string {
  try {
    return format(parseISO(targetDate), "MMM d, yyyy").toUpperCase();
  } catch {
    return targetDate.toUpperCase();
  }
}

export const DateCountersTool: React.FC<DateCountersToolProps> = ({
  isAddingExternal = false,
  onCloseAddExternal,
  onContextMenuOpen,
}) => {
  const [counters, setCounters] = useState<DateCounter[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );

  const loadCounters = useCallback(async () => {
    try {
      const list = await getActiveDateCounters();
      setCounters(list);
    } catch (err) {
      console.warn("[DateCountersTool] Failed to load counters:", err);
    }
  }, []);

  useEffect(() => {
    void loadCounters();
  }, [loadCounters]);

  useDatabaseSubscription((source) => {
    if (
      source?.startsWith("date_counters:") ||
      source?.startsWith("calendar_tools:") ||
      source?.startsWith("github_sync:")
    ) {
      void loadCounters();
    }
  });

  useEffect(() => {
    if (isAddingExternal) {
      setEditingId(null);
      setDraftTitle("");
      setDraftDate(format(new Date(), "yyyy-MM-dd"));
    }
  }, [isAddingExternal]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftTitle.trim();
    if (!trimmed || !draftDate) return;

    if (editingId) {
      await updateDateCounter(editingId, trimmed, draftDate);
      setEditingId(null);
    } else {
      await createDateCounter(trimmed, draftDate);
      onCloseAddExternal?.();
    }
    setDraftTitle("");
  };

  const handleCancel = () => {
    setEditingId(null);
    setDraftTitle("");
    onCloseAddExternal?.();
  };

  const isFormOpen = isAddingExternal || editingId !== null;

  return (
    <div
      onContextMenu={onContextMenuOpen}
      className="px-3.5 py-2.5 select-none min-h-[36px]"
    >
      {counters.length === 0 && !isFormOpen && (
        <div className="text-[10px] text-hobo-faint">
          Right-click to add a date counter
        </div>
      )}

      {counters.length > 0 && (
        <div className="space-y-1">
          {counters.map((counter) => (
            <div
              key={counter.id}
              className="group flex items-baseline justify-between gap-2 text-[11px] leading-snug text-hobo-red"
            >
              <div className="min-w-0 flex items-baseline gap-1.5 truncate">
                <span className="truncate font-light">
                  {formatCounterText(counter)}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-hobo-muted">
                  {formatCounterDateLabel(counter.target_date)}
                </span>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onCloseAddExternal?.();
                    setEditingId(counter.id);
                    setDraftTitle(counter.title);
                    setDraftDate(counter.target_date);
                  }}
                  className="p-0.5 text-hobo-muted hover:text-hobo-ink bg-transparent border-0"
                >
                  <Pencil className="w-2.5 h-2.5 stroke-[1.5]" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteDateCounter(counter.id)}
                  className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0"
                >
                  <X className="w-3 h-3 stroke-[1.5]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <form
          onSubmit={(e) => void handleSave(e)}
          className="mt-2 p-2 bg-white/60 border border-hobo-lineDark space-y-1.5"
        >
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Event name..."
            autoFocus
            className="w-full bg-white/80 border border-hobo-lineDark px-1.5 py-1 text-[11px] text-hobo-ink placeholder:text-hobo-faint outline-none focus:border-hobo-red"
          />
          <div className="flex items-center justify-between gap-1.5">
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              className="bg-white/80 border border-hobo-lineDark px-1.5 py-0.5 text-[10px] text-hobo-ink outline-none focus:border-hobo-red"
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCancel}
                className="px-2 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-hobo-muted hover:text-hobo-ink bg-transparent border border-hobo-lineDark"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-2 py-0.5 text-[9.5px] uppercase tracking-[0.08em] bg-hobo-red text-white border border-hobo-red hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
};
