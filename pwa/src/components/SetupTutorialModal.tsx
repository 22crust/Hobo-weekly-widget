import React from "react";
import { X } from "lucide-react";
import tutorialData from "../../../shared/setupTutorial.json";

interface SetupTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SetupTutorialModal: React.FC<SetupTutorialModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const subtitle = (tutorialData as { subtitle?: string }).subtitle;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[88vh] flex flex-col bg-hobo-paperSolid border border-hobo-lineDark overflow-hidden text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <div>
            <h3 className="text-xs uppercase tracking-[0.14em] text-hobo-ink font-medium">
              {tutorialData.title}
            </h3>
            {subtitle && (
              <p className="text-[10px] text-hobo-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-hobo-muted hover:text-hobo-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {tutorialData.sections.map((section) => (
            <div key={section.heading} className="space-y-1.5">
              <h4 className="text-[11px] uppercase tracking-[0.12em] text-hobo-red font-medium">
                {section.heading}
              </h4>
              <ol className="list-decimal list-inside space-y-1.5 text-[11.5px] leading-relaxed text-hobo-ink">
                {section.steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
