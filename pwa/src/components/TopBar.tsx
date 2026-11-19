import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Loader2,
  RefreshCw,
  Settings,
} from "lucide-react";
import { GithubSyncStatusPayload } from "../types/planner";

interface TopBarProps {
  showCalendarToggle: boolean;
  isCalendarExpanded: boolean;
  onToggleCalendar: () => void;
  githubSyncStatus: GithubSyncStatusPayload;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenGithubAuthPrompt?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  showCalendarToggle,
  isCalendarExpanded,
  onToggleCalendar,
  githubSyncStatus,
  isRefreshing,
  onRefresh,
  onOpenSettings,
  onOpenGithubAuthPrompt,
}) => {

  const renderSyncBadge = () => {
    if (githubSyncStatus.status === "disabled") {
      return (
        <button
          type="button"
          onClick={onOpenSettings}
          title="Local-only mode (GitHub sync disabled)"
          className="inline-flex items-center justify-center p-1.5 text-hobo-muted hover:text-hobo-ink transition-colors"
        >
          <CloudOff className="w-4 h-4 stroke-[1.5]" />
        </button>
      );
    }

    if (githubSyncStatus.status === "syncing") {
      return (
        <span
          title="Syncing with GitHub..."
          className="inline-flex items-center justify-center p-1.5 text-hobo-muted"
        >
          <Loader2 className="w-4 h-4 stroke-[1.5] animate-spin" />
        </span>
      );
    }

    if (githubSyncStatus.status === "error") {
      return (
        <button
          type="button"
          onClick={() => {
            if (onOpenGithubAuthPrompt) onOpenGithubAuthPrompt();
            else onOpenSettings();
          }}
          title={githubSyncStatus.message || "GitHub sync error"}
          className="inline-flex items-center justify-center p-1.5 text-hobo-red hover:opacity-80 transition-opacity"
        >
          <AlertTriangle className="w-4 h-4 stroke-[1.75]" />
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={onOpenSettings}
        title={
          githubSyncStatus.last_synced_at
            ? `Synced with GitHub (${new Date(githubSyncStatus.last_synced_at).toLocaleTimeString()})`
            : "GitHub sync ready"
        }
        className="inline-flex items-center justify-center p-1.5 text-emerald-700 hover:opacity-80 transition-opacity"
      >
        <CheckCircle2 className="w-4 h-4 stroke-[1.6]" />
      </button>
    );
  };

  return (
    <header
      className={`sticky top-0 z-30 safe-top ${
        showCalendarToggle && isCalendarExpanded
          ? "bg-hobo-paperSolid"
          : "bg-hobo-paper/95 backdrop-blur-sm border-b border-hobo-lineDark"
      }`}
    >
      <div className="px-3.5 h-11 flex items-center justify-between">
        {/* Top-Left: Collapsible Calendar Toggle (Planner tab only) */}
        {showCalendarToggle ? (
          <button
            type="button"
            onClick={onToggleCalendar}
            className="inline-flex items-center gap-1.5 py-1 text-left text-hobo-ink hover:text-hobo-red transition-colors bg-transparent border-0"
          >
            {isCalendarExpanded ? (
              <ChevronUp className="w-4 h-4 stroke-[1.75] text-hobo-red" />
            ) : (
              <ChevronDown className="w-4 h-4 stroke-[1.75] text-hobo-red" />
            )}
            <span className="text-sm leading-none tracking-[0.06em] font-normal uppercase">
              CALENDAR
            </span>
          </button>
        ) : (
          <span />
        )}

        {/* Top-Right: GitHub status, Refresh, Settings */}
        <div className="flex items-center gap-1">
          {renderSyncBadge()}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh & Sync"
            className="inline-flex items-center justify-center p-1.5 text-hobo-muted hover:text-hobo-red transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 stroke-[1.5] ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            className="inline-flex items-center justify-center p-1.5 text-hobo-muted hover:text-hobo-red transition-colors"
          >
            <Settings className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>
      </div>
    </header>
  );
};
