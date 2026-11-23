import React from "react";
import { useDebouncedTextDraft } from "../../hooks/useDebouncedTextDraft";

interface BucketTextEditorProps {
  bucketId: string;
  weekStartDate: string;
  value: string;
  onSave: (
    bucketId: string,
    weekStartDate: string,
    content: string
  ) => Promise<void> | void;
}

export const BucketTextEditor: React.FC<BucketTextEditorProps> = ({
  bucketId,
  weekStartDate,
  value,
  onSave,
}) => {
  const { draft, textareaRef, handleChange, handleBlur } =
    useDebouncedTextDraft({
      keyId: `${bucketId}::${weekStartDate}`,
      value,
      onSave: async (_key, text) => {
        await onSave(bucketId, weekStartDate, text);
      },
    });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pointer-events-auto">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        placeholder=""
        className="block w-full min-h-full bg-transparent border-0 outline-none resize-none py-0.5 text-[12px] leading-[17px] font-light text-hobo-ink"
      />
    </div>
  );
};
