import React, { useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  RefreshCw,
  Settings,
} from "lucide-react";
import { GithubSyncStatusPayload } from "../../types/planner";

interface WidgetTitlebarProps {
  title?: string;
  isSyncing?: boolean;
  onManualSync?: () => void;
  isCollapsed: boolean;
  onToggleCollapse: (nextCollapsed: boolean) => void;
  isCalendarOpen?: boolean;
  onToggleCalendar?: () => void;
  isNotesOpen?: boolean;
  onToggleNotes?: () => void;
  onOpenSettings?: () => void;
  githubSyncStatus?: GithubSyncStatusPayload;
  defaultExpandedHeight?: number;
}

export const WidgetTitlebar: React.FC<WidgetTitlebarProps> = ({
  title = "WEEKLY PLANNER",
  isSyncing = false,
  onManualSync,
  isCollapsed,
  onToggleCollapse,
  isCalendarOpen = false,
  onToggleCalendar,
  isNotesOpen = false,
  onToggleNotes,
  onOpenSettings,
  githubSyncStatus,
  defaultExpandedHeight = 760,
}) => {
  const savedSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [isTogglingSize, setIsTogglingSize] = useState(false);

  const handleToggleCollapse = async () => {
    if (isTogglingSize) return;
    setIsTogglingSize(true);
    const nextCollapsed = !isCollapsed;
    onToggleCollapse(nextCollapsed);

    try {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const physicalSize = await win.innerSize();
      const logicalWidth = Math.round(physicalSize.width / factor);
      const logicalHeight = Math.round(physicalSize.height / factor);

      if (nextCollapsed) {
        if (logicalHeight > 60) {
          savedSizeRef.current = { width: logicalWidth, height: logicalHeight };
        }
        await win.setSize(new LogicalSize(logicalWidth, 28));
      } else {
        const restoreHeight = savedSizeRef.current?.height ?? defaultExpandedHeight;
        const restoreWidth = savedSizeRef.current?.width ?? logicalWidth;
        await win.setSize(new LogicalSize(restoreWidth, restoreHeight));
      }
    } catch {
      // Fallback in standard browser preview
    } finally {
      setIsTogglingSize(false);
    }
  };

  const handleHideToTray = async () => {
    try {
      await getCurrentWindow().hide();
    } catch {
      // Ignore outside Tauri
    }
  };

  const formatGithubTooltip = (st: GithubSyncStatusPayload): string => {
    if (st.status === "syncing") return "Syncing to GitHub...";
    if (st.status === "error")
      return `GitHub sync error${st.message ? `: ${st.message}` : ""}`;
    if (st.status === "synced" && st.last_synced_at) {
      try {
        const d = new Date(st.last_synced_at);
        if (!Number.isNaN(d.getTime())) {
          return `GitHub synced at ${d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`;
        }
      } catch {
        // Fallback
      }
      return "GitHub synced";
    }
    return "GitHub backup active";
  };

  const getDotColorClass = (status: GithubSyncStatusPayload["status"]) => {
    switch (status) {
      case "syncing":
        return "bg-amber-500 animate-pulse";
      case "synced":
        return "bg-emerald-600";
      case "error":
        return "bg-hobo-red";
      default:
        return "bg-hobo-muted/60";
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="h-6 flex items-center bg-transparent text-hobo-muted select-none shrink-0"
    >
      {/* When the Monthly Calendar sidebar is open, show "CALENDAR" directly above the 340px monthly column */}
      {isCalendarOpen && (
        <div
          data-tauri-drag-region
          className="w-[340px] shrink-0 h-full px-3.5 flex items-center cursor-move"
        >
          <span
            data-tauri-drag-region
            className="text-[10px] leading-none tracking-[0.16em] uppercase text-hobo-muted/80"
          >
            CALENDAR
          </span>
        </div>
      )}

      {/* Main Weekly Planner Titlebar Header */}
      <div
        data-tauri-drag-region
        className="flex-1 h-full px-2.5 flex items-center justify-between cursor-move"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-1.5"
        >
          {onToggleCalendar && (
            <button
              type="button"
              onClick={onToggleCalendar}
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-red hover:opacity-75 transition-opacity bg-transparent border-0 outline-none cursor-pointer"
            >
              {isCalendarOpen ? (
                <ChevronRight className="w-3.5 h-3.5 stroke-[1.75]" />
              ) : (
                <ChevronLeft className="w-3.5 h-3.5 stroke-[1.75]" />
              )}
            </button>
          )}
          <span
            data-tauri-drag-region
            className="text-[10px] leading-none tracking-[0.16em] uppercase text-hobo-muted/80"
          >
            {title}
          </span>
        </div>

        {/* Right: GitHub sync status dot (only when GitHub mode is active) + Settings gear + utility icons */}
        <div className="flex items-center gap-2">
          {githubSyncStatus && githubSyncStatus.status !== "disabled" && (
            <div className="group/ghstatus relative flex items-center justify-center">
              <span
                className={`w-2 h-2 rounded-full block ${getDotColorClass(
                  githubSyncStatus.status
                )}`}
              />
              <span className="pointer-events-none opacity-0 group-hover/ghstatus:opacity-100 transition-opacity absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-hobo-red font-normal z-40">
                {formatGithubTooltip(githubSyncStatus)}
              </span>
            </div>
          )}

          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center p-0.5 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0 outline-none"
            >
              <Settings className="w-3 h-3 stroke-[1.5]" />
            </button>
          )}

          {onManualSync && (
            <button
              type="button"
              onClick={onManualSync}
              disabled={isSyncing}
              className="inline-flex items-center justify-center p-0.5 text-hobo-muted hover:text-hobo-red transition-colors bg-transparent border-0 outline-none"
            >
              <RefreshCw
                className={`w-3 h-3 stroke-[1.5] ${
                  isSyncing ? "animate-spin text-hobo-red" : ""
                }`}
              />
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleCollapse}
            className="inline-flex items-center justify-center p-0.5 text-hobo-muted hover:text-hobo-ink transition-colors bg-transparent border-0 outline-none"
          >
            {isCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5 stroke-[1.5]" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 stroke-[1.5]" />
            )}
          </button>

          {onToggleNotes && (
            <button
              type="button"
              onClick={onToggleNotes}
              className="inline-flex items-center justify-center p-0.5 -translate-y-[0.5px] text-hobo-red hover:opacity-75 transition-opacity bg-transparent border-0 outline-none cursor-pointer"
            >
              {isNotesOpen ? (
                <ChevronLeft className="w-3.5 h-3.5 stroke-[1.75]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 stroke-[1.75]" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* When the Notes sidebar is open, reserve the matching 340px drag-region strip on the right */}
      {isNotesOpen && (
        <div
          data-tauri-drag-region
          className="w-[340px] shrink-0 h-full px-3.5 flex items-center cursor-move"
        />
      )}
    </div>
  );
};
