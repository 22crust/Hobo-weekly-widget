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
      className="fixed inset-0 z-[60] bg-black/35 flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] max-h-[85vh] flex flex-col bg-hobo-paperSolid border border-hobo-lineDark shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2.5 border-b border-hobo-lineDark flex items-center justify-between">
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.16em] text-hobo-ink font-normal">
              {tutorialData.title}
            </h3>
            {subtitle && (
              <p className="text-[10px] text-hobo-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 text-hobo-muted hover:text-hobo-red bg-transparent border-0 outline-none"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto text-xs font-light select-text">
          {tutorialData.sections.map((section) => (
            <div key={section.heading} className="space-y-1.5">
              <h4 className="text-[10px] uppercase tracking-[0.14em] text-hobo-red font-normal">
                {section.heading}
              </h4>
              <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-hobo-ink">
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
