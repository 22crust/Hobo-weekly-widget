import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, KeyRound, X } from "lucide-react";

interface GithubAuthPromptModalProps {
  isOpen: boolean;
  errorMessage: string | null;
  onUpdateToken: () => void;
  onSwitchToLocal: () => void;
  onDismiss: () => void;
}

export const GithubAuthPromptModal: React.FC<GithubAuthPromptModalProps> = ({
  isOpen,
  errorMessage,
  onUpdateToken,
  onSwitchToLocal,
  onDismiss,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/25 select-none p-4">
      <div className="w-full max-w-[380px] bg-hobo-paper border border-hobo-lineDark text-hobo-ink flex flex-col overflow-hidden shadow-sm">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-hobo-red">
            <AlertTriangle className="w-3.5 h-3.5 stroke-[1.75]" />
            <span className="text-[11px] uppercase tracking-[0.16em] font-normal">
              GITHUB SYNC PAUSED
            </span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-2.5 text-xs font-light">
          <p className="text-[11px] text-hobo-ink leading-relaxed">
            Local Planner can no longer publish backups to GitHub because your Personal Access Token is expired or invalid. Your data is still safely saved locally on this PC.
          </p>
          <p className="text-[11px] text-hobo-ink leading-relaxed">
            Update your access token or switch to local storage to stop receiving this pop-up.
          </p>
          {errorMessage && (
            <div className="px-2 py-1 text-[10px] border border-hobo-line bg-white/50 text-hobo-muted">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-hobo-lineDark flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-hobo-muted hover:text-hobo-ink bg-transparent border border-hobo-lineDark transition-colors"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onSwitchToLocal}
            className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent border border-hobo-lineDark transition-colors"
          >
            Switch to Local
          </button>
          <button
            type="button"
            onClick={onUpdateToken}
            className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] bg-hobo-red text-white hover:opacity-90 transition-opacity border border-hobo-red inline-flex items-center gap-1.5"
          >
            <KeyRound className="w-3 h-3 stroke-[1.75]" />
            <span>Update Token</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
