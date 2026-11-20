import React, { useEffect, useRef, useState } from "react";

interface MobileColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#C94A38";
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function rgbToHsv(
  r: number,
  g: number,
  b: number
): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(
  h: number,
  s: number,
  v: number
): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export const MobileColorPicker: React.FC<MobileColorPickerProps> = ({
  value,
  onChange,
}) => {
  const initialRgb = hexToRgb(value);
  const [hsv, setHsv] = useState(() =>
    rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b)
  );
  const svBoxRef = useRef<HTMLDivElement | null>(null);
  const hueBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rgb = hexToRgb(value);
    const currentRgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    if (
      rgb.r !== currentRgb.r ||
      rgb.g !== currentRgb.g ||
      rgb.b !== currentRgb.b
    ) {
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    }
  }, [value]);

  const emitHsv = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    const rgb = hsvToRgb(next.h, next.s, next.v);
    onChange(rgbToHex(rgb.r, rgb.g, rgb.b));
  };

  const handleSvPointer = (clientX: number, clientY: number) => {
    const el = svBoxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    emitHsv({ ...hsv, s, v });
  };

  const handleHuePointer = (clientX: number) => {
    const el = hueBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    emitHsv({ ...hsv, h: ratio * 360 });
  };

  const startDrag = (
    e: React.PointerEvent,
    onMove: (x: number, y: number) => void
  ) => {
    e.preventDefault();
    onMove(e.clientX, e.clientY);
    const handleMove = (me: PointerEvent) => onMove(me.clientX, me.clientY);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  const currentRgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const pureHueRgb = hsvToRgb(hsv.h, 1, 1);
  const pureHueCss = `rgb(${pureHueRgb.r}, ${pureHueRgb.g}, ${pureHueRgb.b})`;
  const currentCss = `rgb(${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b})`;

  const updateChannel = (channel: "r" | "g" | "b", raw: string) => {
    const parsed = clamp(parseInt(raw.replace(/[^0-9]/g, ""), 10) || 0, 0, 255);
    const nextRgb = { ...currentRgb, [channel]: parsed };
    const nextHsv = rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b);
    setHsv(nextHsv);
    onChange(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  return (
    <div className="mt-2 p-2.5 border border-hobo-lineDark bg-white shadow-md space-y-3 select-none">
      {/* 2D Saturation / Value Square */}
      <div
        ref={svBoxRef}
        onPointerDown={(e) => startDrag(e, handleSvPointer)}
        style={{ backgroundColor: pureHueCss }}
        className="relative w-full h-36 touch-none cursor-crosshair overflow-hidden"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, #fff, rgba(255,255,255,0))",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to top, #000, rgba(0,0,0,0))",
          }}
        />
        <div
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: currentCss,
          }}
          className="absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black/70 pointer-events-none"
        />
      </div>

      {/* Preview Circle + Rainbow Hue Slider */}
      <div className="flex items-center gap-3">
        <div
          style={{ backgroundColor: currentCss }}
          className="w-8 h-8 rounded-full border border-hobo-lineDark shrink-0"
        />
        <div
          ref={hueBarRef}
          onPointerDown={(e) => startDrag(e, (x) => handleHuePointer(x))}
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
          className="relative flex-1 h-3 rounded-full touch-none cursor-pointer"
        >
          <div
            style={{
              left: `${(hsv.h / 360) * 100}%`,
              backgroundColor: pureHueCss,
            }}
            className="absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/40 pointer-events-none"
          />
        </div>
      </div>

      {/* R G B Inputs */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {(["r", "g", "b"] as const).map((ch) => (
          <div key={ch} className="space-y-0.5">
            <input
              type="text"
              inputMode="numeric"
              value={currentRgb[ch]}
              onChange={(e) => updateChannel(ch, e.target.value)}
              className="w-full py-1 text-center border border-hobo-lineDark bg-white text-xs text-hobo-ink outline-none focus:border-hobo-red"
            />
            <div className="text-[10px] uppercase text-hobo-muted">{ch}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
