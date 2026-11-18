import React, { useMemo } from "react";

interface CrispSquareGridProps {
  /** Exact square cell size in CSS pixels (dependent ONLY on window height) */
  cellSizePx: number;
  /** Number of vertical grid squares (`height = rows * cellSizePx`) */
  rows: number;
  /** Width of the container in CSS pixels */
  widthPx: number;
}

/**
 * Renders a razor-sharp, 100% square grid where:
 * - Every grid line is strictly 1 physical device pixel thick (`1 / devicePixelRatio` CSS px)
 *   and aligned on the device-pixel half-offset (`(Math.round(pos * dpr) + 0.5) / dpr`) so it
 *   never spans 2 pixels or blurs at 100%, 125%, 150%, or 200% Windows scaling.
 * - All vertical and horizontal grid lines share the exact same uniform color (`#DFDBD0`) —
 *   no darker second vertical line.
 * - Grid cell size (`cellSizePx`) depends strictly on window height; expanding the window
 *   horizontally simply reveals additional square columns to the right.
 */
export const CrispSquareGrid: React.FC<CrispSquareGridProps> = ({
  cellSizePx,
  rows,
  widthPx,
}) => {
  const heightPx = rows * cellSizePx;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const onePhysicalPxInCss = 1 / dpr;

  const { horizontalYs, verticalXs } = useMemo(() => {
    const snapToSingleDevicePixelCenter = (cssCoord: number) => {
      const phys = Math.round(cssCoord * dpr);
      return (phys + 0.5) / dpr;
    };

    const hYs: number[] = [];
    for (let r = 1; r < rows; r++) {
      hYs.push(snapToSingleDevicePixelCenter(r * cellSizePx));
    }

    // Reveal as many square columns as fit in widthPx; cellSizePx never changes with width
    const cols = Math.floor(widthPx / cellSizePx);
    const vXs: number[] = [];
    for (let c = 1; c <= cols; c++) {
      const x = c * cellSizePx;
      if (widthPx - x > 1.5) {
        vXs.push(snapToSingleDevicePixelCenter(x));
      }
    }

    return {
      horizontalYs: hYs,
      verticalXs: vXs,
    };
  }, [cellSizePx, rows, widthPx, dpr]);

  if (widthPx <= 0 || heightPx <= 0) return null;

  return (
    <svg
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      className="absolute inset-0 pointer-events-none select-none"
    >
      {/* Vertical square grid lines (all uniform #DFDBD0, strictly 1 physical pixel wide) */}
      {verticalXs.map((x, idx) => (
        <line
          key={`v-${idx}`}
          x1={x}
          y1={0}
          x2={x}
          y2={heightPx}
          stroke="#DFDBD0"
          strokeWidth={onePhysicalPxInCss}
        />
      ))}

      {/* Horizontal square grid lines (omits y=0 and y=heightPx so top/bottom borders never double-line) */}
      {horizontalYs.map((y, idx) => (
        <line
          key={`h-${idx}`}
          x1={0}
          y1={y}
          x2={widthPx}
          y2={y}
          stroke="#DFDBD0"
          strokeWidth={onePhysicalPxInCss}
        />
      ))}
    </svg>
  );
};
