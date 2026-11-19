import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface GithubAuthPromptModalProps {
  isOpen: boolean;
  errorMessage: string | null;
  onDismissForToday: () => void;
  onUpdateToken: () => void;
  onSwitchToLocal: () => void;
}

export const GithubAuthPromptModal: React.FC<GithubAuthPromptModalProps> = ({
  isOpen,
  errorMessage,
  onDismissForToday,
  onUpdateToken,
  onSwitchToLocal,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-hobo-paperSolid border border-hobo-lineDark p-4 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-hobo-red font-medium uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            <span>GitHub Sync Stopped</span>
          </div>
          <button
            type="button"
            onClick={onDismissForToday}
            className="p-1 text-hobo-muted hover:text-hobo-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-hobo-ink leading-relaxed">
          Unable to publish to GitHub ({errorMessage || "token expired or unauthorized"}).
          Update your access token or switch to local storage to stop receiving
          this pop-up.
        </p>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onUpdateToken}
            className="w-full py-2 bg-hobo-red text-white uppercase tracking-wider"
          >
            Update Access Token
          </button>
          <button
            type="button"
            onClick={onSwitchToLocal}
            className="w-full py-2 border border-hobo-lineDark text-hobo-ink"
          >
            Switch to Local Storage
          </button>
          <button
            type="button"
            onClick={onDismissForToday}
            className="w-full py-1.5 text-hobo-muted hover:text-hobo-ink"
          >
            Remind Me Tomorrow
          </button>
        </div>
      </div>
    </div>
  );
};
