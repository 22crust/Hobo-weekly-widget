import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  ALL_CALENDAR_TOOLS,
  CalendarToolId,
} from "../../../shared/calendarTools";

interface ManageToolsModalProps {
  isOpen: boolean;
  visibleTools: CalendarToolId[];
  onToggleTool: (toolId: CalendarToolId, nextVisible: boolean) => void;
  onClose: () => void;
}

export const ManageToolsModal: React.FC<ManageToolsModalProps> = ({
  isOpen,
  visibleTools,
  onToggleTool,
  onClose,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4 select-none pointer-events-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[330px] bg-hobo-paperSolid border border-hobo-lineDark shadow-lg overflow-hidden text-xs font-light"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3.5 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.16em] text-hobo-ink font-normal">
              Manage Tools
            </h3>
            <p className="text-[9px] text-hobo-muted mt-0.5">
              Tools appear in the order they are enabled.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        {/* Tools List */}
        <div className="p-3.5 max-h-[300px] overflow-y-auto space-y-1">
          {ALL_CALENDAR_TOOLS.map((tool) => {
            const isVisible = visibleTools.includes(tool.id);

            return (
              <div
                key={tool.id}
                className="py-1.5 min-h-[32px] flex items-center gap-2.5"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={isVisible}
                  onClick={() => onToggleTool(tool.id, !isVisible)}
                  className={`relative inline-flex items-center w-6 h-3.5 rounded-full transition-colors shrink-0 border-0 p-[3px] ${
                    isVisible
                      ? "bg-hobo-red"
                      : "bg-hobo-line/70 ring-1 ring-inset ring-hobo-lineDark"
                  }`}
                >
                  <span
                    className={`block w-2 h-2 rounded-full bg-white shadow-sm transition-transform ${
                      isVisible ? "translate-x-[10px]" : "translate-x-0"
                    }`}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[11px] uppercase tracking-[0.1em] ${
                      isVisible ? "text-hobo-ink" : "text-hobo-muted"
                    }`}
                  >
                    {tool.title}
                  </div>
                  <div className="text-[9.5px] text-hobo-faint leading-tight">
                    {tool.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
};
