import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseTextWithLinks } from "../../../shared/textLinks";

interface LinkedTextAreaProps {
  value: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (nextVal: string) => void;
  onBlur?: () => void;
  className?: string;
  placeholder?: string;
  rows?: number;
}

export const LinkedTextArea: React.FC<LinkedTextAreaProps> = ({
  value,
  textareaRef,
  onChange,
  onBlur,
  className = "",
  placeholder = "",
  rows,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const pendingCursorEndRef = useRef(false);

  const segments = useMemo(() => parseTextWithLinks(value), [value]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      if (pendingCursorEndRef.current) {
        pendingCursorEndRef.current = false;
        const len = value.length;
        ta.setSelectionRange(len, len);
      }
    }
  }, [isEditing, textareaRef]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          onBlur?.();
          setIsEditing(false);
        }}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div
      onClick={() => {
        pendingCursorEndRef.current = true;
        setIsEditing(true);
      }}
      className={`${className} whitespace-pre-wrap break-words cursor-text min-h-full`}
    >
      {segments.length === 0 ? (
        <span className="invisible">&nbsp;</span>
      ) : (
        segments.map((seg, idx) =>
          seg.type === "link" ? (
            <a
              key={idx}
              href={seg.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-hobo-red no-underline hover:opacity-80 transition-opacity cursor-pointer"
            >
              {seg.label}
            </a>
          ) : (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          )
        )
      )}
    </div>
  );
};
