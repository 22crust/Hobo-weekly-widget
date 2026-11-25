import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseTextWithLinks } from "../../../shared/textLinks";

interface LinkedTextAreaProps {
  value: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (nextVal: string) => void;
  onBlur?: () => void;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
  viewClassName?: string;
  placeholder?: string;
  rows?: number;
}

function getClickedRawOffset(
  container: HTMLElement,
  clientX: number,
  clientY: number,
  fallbackLength: number
): number {
  try {
    let rangeNode: Node | null = null;
    let rangeOffset = 0;

    const docWithCaret = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };

    if (typeof docWithCaret.caretPositionFromPoint === "function") {
      const pos = docWithCaret.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        rangeNode = pos.offsetNode;
        rangeOffset = pos.offset;
      }
    } else if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range) {
        rangeNode = range.startContainer;
        rangeOffset = range.startOffset;
      }
    }

    if (!rangeNode || !container.contains(rangeNode)) {
      return fallbackLength;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let totalOffset = 0;
    let current = walker.nextNode();
    while (current) {
      if (current === rangeNode) {
        return totalOffset + rangeOffset;
      }
      totalOffset += current.textContent?.length ?? 0;
      current = walker.nextNode();
    }
  } catch {
    // Fallback below
  }
  return fallbackLength;
}

export const LinkedTextArea: React.FC<LinkedTextAreaProps> = ({
  value,
  textareaRef,
  onChange,
  onBlur,
  onEditingChange,
  className = "",
  viewClassName,
  placeholder = "",
  rows,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const pendingCursorPosRef = useRef<number | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);

  const segments = useMemo(() => parseTextWithLinks(value), [value]);

  useEffect(() => {
    onEditingChange?.(isEditing);
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      const pos = pendingCursorPosRef.current;
      pendingCursorPosRef.current = null;
      if (pos !== null) {
        const clamped = Math.max(0, Math.min(value.length, pos));
        ta.setSelectionRange(clamped, clamped);
      }
    }
  }, [isEditing, onEditingChange, textareaRef]);

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
      ref={viewRef}
      onClick={(e) => {
        pendingCursorPosRef.current = viewRef.current
          ? getClickedRawOffset(
              viewRef.current,
              e.clientX,
              e.clientY,
              value.length
            )
          : value.length;
        setIsEditing(true);
      }}
      className={`${
        viewClassName ?? className
      } whitespace-pre-wrap break-words cursor-text min-h-full`}
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void invoke("open_external_url", { url: seg.href }).catch(() => {
                  window.open(seg.href, "_blank", "noopener,noreferrer");
                });
              }}
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
