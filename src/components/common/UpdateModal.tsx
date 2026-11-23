import React from "react";
import { Download, Loader2, X } from "lucide-react";
import { Update } from "@tauri-apps/plugin-updater";

interface UpdateModalProps {
  update: Update | null;
  isOpen: boolean;
  isInstalling: boolean;
  progressPct: number | null;
  error: string | null;
  onUpdate: () => void;
  onSkip: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  update,
  isOpen,
  isInstalling,
  progressPct,
  error,
  onUpdate,
  onSkip,
}) => {
  if (!isOpen || !update) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 select-none p-4">
      <div className="w-full max-w-[360px] bg-hobo-paper border border-hobo-lineDark text-hobo-ink flex flex-col overflow-hidden shadow-sm">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.16em] font-normal text-hobo-ink">
            UPDATE AVAILABLE
          </span>
          {!isInstalling && (
            <button
              type="button"
              onClick={onSkip}
              className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
            >
              <X className="w-3.5 h-3.5 stroke-[1.5]" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-4 space-y-2.5 text-xs font-light">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-normal text-hobo-red tracking-wide">
              Version {update.version}
            </span>
            {update.currentVersion && (
              <span className="text-[10px] text-hobo-muted">
                Current: v{update.currentVersion}
              </span>
            )}
          </div>

          <p className="text-[11px] text-hobo-ink leading-relaxed">
            A new version of Hobo weekly is ready to download and install. Your tasks, events, notes, and stickers will be preserved.
          </p>

          {update.body && update.body.trim().length > 0 && (
            <div className="p-2.5 bg-white/55 border border-hobo-line text-[11px] text-hobo-ink leading-relaxed whitespace-pre-line max-h-40 overflow-y-auto">
              {update.body.trim()}
            </div>
          )}

          {isInstalling && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[10px] text-hobo-muted">
                <span>Downloading &amp; installing update...</span>
                {progressPct !== null && <span>{progressPct}%</span>}
              </div>
              <div className="w-full h-1.5 bg-hobo-line overflow-hidden">
                <div
                  style={{ width: `${progressPct ?? 100}%` }}
                  className={`h-full bg-hobo-red transition-all ${
                    progressPct === null ? "animate-pulse" : ""
                  }`}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="px-2 py-1.5 text-[10px] border border-hobo-red bg-hobo-redSoft text-hobo-red">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-hobo-lineDark flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isInstalling}
            onClick={onSkip}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-hobo-muted hover:text-hobo-ink disabled:opacity-40 bg-transparent border border-hobo-lineDark transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={isInstalling}
            onClick={onUpdate}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] bg-hobo-red text-white hover:opacity-90 disabled:opacity-60 transition-opacity border border-hobo-red inline-flex items-center gap-1.5"
          >
            {isInstalling ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3 stroke-[1.75]" />
            )}
            <span>{isInstalling ? "Updating..." : "Update"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
