import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { ImageOff, Lock, RotateCw, Unlock, X } from "lucide-react";
import { UpdateWeekImageInput, WeekImage } from "../../types/planner";

interface WeeklyImageLayerProps {
  images: WeekImage[];
  containerRef: React.RefObject<HTMLElement | null>;
  onUpdateImage: (id: string, updates: UpdateWeekImageInput) => void;
  onDeleteImage: (id: string) => void;
}

interface StickerItemProps {
  sticker: WeekImage;
  containerRef: React.RefObject<HTMLElement | null>;
  maxZIndex: number;
  onUpdateImage: (id: string, updates: UpdateWeekImageInput) => void;
  onDeleteImage: (id: string) => void;
}

const MIN_STICKER_WIDTH = 48;
const MAX_STICKER_WIDTH = 680;
const MAX_TOTAL_CROP_PCT = 82; // Keep at least 18% of image visible
const SNAP_90_THRESHOLD_DEG = 6; // Soft-click into place within ±6° of 0°, 90°, 180°, 270°

/**
 * Normalizes an angle in degrees to `[-180, 180]` and applies a soft-snap
 * within `±6°` of every `90°` increment (`-180°, -90°, 0°, 90°, 180°`).
 */
function snapAngleTo90Degrees(rawDeg: number): number {
  let norm = ((rawDeg + 180) % 360 + 360) % 360 - 180;
  for (const target of [-180, -90, 0, 90, 180]) {
    if (Math.abs(norm - target) <= SNAP_90_THRESHOLD_DEG) {
      norm = target === -180 ? 180 : target;
      break;
    }
  }
  return Number(norm.toFixed(1));
}

const StickerItem: React.FC<StickerItemProps> = ({
  sticker,
  containerRef,
  maxZIndex,
  onUpdateImage,
  onDeleteImage,
}) => {
  const stickerBoxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [posX, setPosX] = useState<number>(sticker.pos_x);
  const [posY, setPosY] = useState<number>(sticker.pos_y);
  const [widthPx, setWidthPx] = useState<number>(sticker.width || 180);
  const [rotationDeg, setRotationDeg] = useState<number>(sticker.rotation ?? 0);
  const [cropTop, setCropTop] = useState<number>(sticker.crop_top ?? 0);
  const [cropRight, setCropRight] = useState<number>(sticker.crop_right ?? 0);
  const [cropBottom, setCropBottom] = useState<number>(sticker.crop_bottom ?? 0);
  const [cropLeft, setCropLeft] = useState<number>(sticker.crop_left ?? 0);
  const [opacityLevel, setOpacityLevel] = useState<number>(
    sticker.opacity ?? 10
  );
  const [naturalRatio, setNaturalRatio] = useState<number>(1); // height / width

  const [hasError, setHasError] = useState<boolean>(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    sticker.is_local_only ? null : sticker.image_url
  );
  const [isInteracting, setIsInteracting] = useState<boolean>(false);
  const [unlockMenuPos, setUnlockMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!isInteracting) {
      setPosX(sticker.pos_x);
      setPosY(sticker.pos_y);
      setWidthPx(sticker.width || 180);
      setRotationDeg(sticker.rotation ?? 0);
      setCropTop(sticker.crop_top ?? 0);
      setCropRight(sticker.crop_right ?? 0);
      setCropBottom(sticker.crop_bottom ?? 0);
      setCropLeft(sticker.crop_left ?? 0);
      setOpacityLevel(sticker.opacity ?? 10);
    }
  }, [
    sticker.pos_x,
    sticker.pos_y,
    sticker.width,
    sticker.rotation,
    sticker.crop_top,
    sticker.crop_right,
    sticker.crop_bottom,
    sticker.crop_left,
    sticker.opacity,
    isInteracting,
  ]);

  useEffect(() => {
    setHasError(false);
    if (!sticker.is_local_only) {
      setResolvedSrc(sticker.image_url);
      const el = imgRef.current;
      if (el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
        setNaturalRatio(el.naturalHeight / el.naturalWidth);
      }
      return;
    }

    let cancelled = false;
    void invoke<string>("read_local_image_data_url", {
      path: sticker.image_url,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setResolvedSrc(dataUrl);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("FILE_NOT_FOUND")) {
          // Original local file was deleted/removed -> automatically remove sticker
          onDeleteImage(sticker.id);
        } else {
          setHasError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sticker.id, sticker.image_url, sticker.is_local_only]);

  // Close right-click "Unlock" menu on outside click
  useEffect(() => {
    if (!unlockMenuPos) return;
    const close = () => setUnlockMenuPos(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [unlockMenuPos]);

  // Listen for right-click anywhere over this locked sticker's bounding box
  useEffect(() => {
    if (!sticker.is_locked) {
      setUnlockMenuPos(null);
      return;
    }

    const handleGlobalContextMenu = (e: MouseEvent) => {
      const box = stickerBoxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        e.preventDefault();
        e.stopPropagation();
        setUnlockMenuPos({ x: e.clientX, y: e.clientY });
      }
    };

    window.addEventListener("contextmenu", handleGlobalContextMenu, true);
    return () =>
      window.removeEventListener("contextmenu", handleGlobalContextMenu, true);
  }, [sticker.is_locked]);

  const uncroppedHeightPx = Math.max(36, widthPx * naturalRatio);
  const visibleWidthFraction = Math.max(0.18, (100 - cropLeft - cropRight) / 100);
  const visibleHeightFraction = Math.max(0.18, (100 - cropTop - cropBottom) / 100);
  const croppedBoxWidthPx = widthPx * visibleWidthFraction;
  const croppedBoxHeightPx = uncroppedHeightPx * visibleHeightFraction;

  // 1. Move / Drag Sticker Body
  const handleMovePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sticker.is_locked || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-sticker-handle]")) return;

    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    setIsInteracting(true);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialPosX = posX;
    const initialPosY = posY;
    let latestX = initialPosX;
    let latestY = initialPosY;
    const nextZ = Math.max(sticker.z_index, maxZIndex + 1);

    const onPointerMove = (moveEv: PointerEvent) => {
      const dxPct = ((moveEv.clientX - startClientX) / rect.width) * 100;
      const dyPct = ((moveEv.clientY - startClientY) / rect.height) * 100;
      latestX = Math.max(-15, Math.min(96, initialPosX + dxPct));
      latestY = Math.max(-15, Math.min(96, initialPosY + dyPct));
      setPosX(latestX);
      setPosY(latestY);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsInteracting(false);
      onUpdateImage(sticker.id, {
        pos_x: Number(latestX.toFixed(2)),
        pos_y: Number(latestY.toFixed(2)),
        z_index: nextZ,
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // 2. Corner Resize (maintains aspect ratio from any of the 4 corners: nw, ne, se, sw)
  const handleCornerResizePointerDown = (
    corner: "nw" | "ne" | "se" | "sw",
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (sticker.is_locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    setIsInteracting(true);
    const startClientX = e.clientX;
    const initialWidth = widthPx;
    const initialPosX = posX;
    const initialPosY = posY;
    let latestWidth = initialWidth;
    let latestPosX = initialPosX;
    let latestPosY = initialPosY;
    const nextZ = Math.max(sticker.z_index, maxZIndex + 1);

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const onPointerMove = (moveEv: PointerEvent) => {
      const dxScreen = moveEv.clientX - startClientX;
      const dyScreen = moveEv.clientY - e.clientY;
      // Project screen delta onto sticker's local horizontal axis
      const localDx = dxScreen * cos + dyScreen * sin;
      const signedDelta =
        corner === "ne" || corner === "se" ? localDx : -localDx;

      const nextW = Math.max(
        MIN_STICKER_WIDTH,
        Math.min(
          MAX_STICKER_WIDTH,
          Math.round(initialWidth + signedDelta / visibleWidthFraction)
        )
      );
      const dwVisible = (nextW - initialWidth) * visibleWidthFraction;
      const dhVisible =
        (nextW - initialWidth) * naturalRatio * visibleHeightFraction;

      latestWidth = nextW;
      if (corner === "nw" || corner === "sw") {
        latestPosX =
          initialPosX - (dwVisible / Math.max(1, containerRect.width)) * 100;
      }
      if (corner === "nw" || corner === "ne") {
        latestPosY =
          initialPosY - (dhVisible / Math.max(1, containerRect.height)) * 100;
      }

      setWidthPx(latestWidth);
      setPosX(latestPosX);
      setPosY(latestPosY);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsInteracting(false);
      onUpdateImage(sticker.id, {
        width: latestWidth,
        pos_x: Number(latestPosX.toFixed(2)),
        pos_y: Number(latestPosY.toFixed(2)),
        z_index: nextZ,
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // 3. Straight Edges Crop (top, right, bottom, left)
  const handleEdgeCropPointerDown = (
    edge: "top" | "right" | "bottom" | "left",
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (sticker.is_locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    setIsInteracting(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const initTop = cropTop;
    const initRight = cropRight;
    const initBottom = cropBottom;
    const initLeft = cropLeft;
    const initPosX = posX;
    const initPosY = posY;

    let nextTop = initTop;
    let nextRight = initRight;
    let nextBottom = initBottom;
    let nextLeft = initLeft;
    let nextPosX = initPosX;
    let nextPosY = initPosY;

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const onPointerMove = (moveEv: PointerEvent) => {
      const dxScreen = moveEv.clientX - startX;
      const dyScreen = moveEv.clientY - startY;
      // Project screen delta into sticker's rotated local coordinates
      const localDx = dxScreen * cos + dyScreen * sin;
      const localDy = -dxScreen * sin + dyScreen * cos;

      if (edge === "right") {
        const deltaPct = (-localDx / Math.max(1, widthPx)) * 100;
        nextRight = Math.max(
          0,
          Math.min(MAX_TOTAL_CROP_PCT - initLeft, initRight + deltaPct)
        );
        setCropRight(nextRight);
      } else if (edge === "left") {
        const deltaPct = (localDx / Math.max(1, widthPx)) * 100;
        nextLeft = Math.max(
          0,
          Math.min(MAX_TOTAL_CROP_PCT - initRight, initLeft + deltaPct)
        );
        const appliedPx = ((nextLeft - initLeft) / 100) * widthPx;
        nextPosX =
          initPosX + (appliedPx / Math.max(1, containerRect.width)) * 100;
        setCropLeft(nextLeft);
        setPosX(nextPosX);
      } else if (edge === "bottom") {
        const deltaPct = (-localDy / Math.max(1, uncroppedHeightPx)) * 100;
        nextBottom = Math.max(
          0,
          Math.min(MAX_TOTAL_CROP_PCT - initTop, initBottom + deltaPct)
        );
        setCropBottom(nextBottom);
      } else if (edge === "top") {
        const deltaPct = (localDy / Math.max(1, uncroppedHeightPx)) * 100;
        nextTop = Math.max(
          0,
          Math.min(MAX_TOTAL_CROP_PCT - initBottom, initTop + deltaPct)
        );
        const appliedPx = ((nextTop - initTop) / 100) * uncroppedHeightPx;
        nextPosY =
          initPosY + (appliedPx / Math.max(1, containerRect.height)) * 100;
        setCropTop(nextTop);
        setPosY(nextPosY);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsInteracting(false);
      onUpdateImage(sticker.id, {
        crop_top: Number(nextTop.toFixed(2)),
        crop_right: Number(nextRight.toFixed(2)),
        crop_bottom: Number(nextBottom.toFixed(2)),
        crop_left: Number(nextLeft.toFixed(2)),
        pos_x: Number(nextPosX.toFixed(2)),
        pos_y: Number(nextPosY.toFixed(2)),
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // 4. Outer Ring Rotation with Soft-Click Every 90 Degrees (0°, 90°, 180°, -90°)
  const handleRotatePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sticker.is_locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const box = stickerBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    setIsInteracting(true);
    const startAngleRad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const initialRotation = rotationDeg;
    let latestRot = initialRotation;
    const nextZ = Math.max(sticker.z_index, maxZIndex + 1);

    const onPointerMove = (moveEv: PointerEvent) => {
      const currentAngleRad = Math.atan2(
        moveEv.clientY - centerY,
        moveEv.clientX - centerX
      );
      const deltaDeg = ((currentAngleRad - startAngleRad) * 180) / Math.PI;
      latestRot = snapAngleTo90Degrees(initialRotation + deltaDeg);
      setRotationDeg(latestRot);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setIsInteracting(false);
      onUpdateImage(sticker.id, {
        rotation: latestRot,
        z_index: nextZ,
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onUpdateImage(sticker.id, { is_locked: !sticker.is_locked });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDeleteImage(sticker.id);
  };

  return (
    <>
      <div
        ref={stickerBoxRef}
        style={{
          left: `${posX}%`,
          top: `${posY}%`,
          width: `${croppedBoxWidthPx}px`,
          height: `${croppedBoxHeightPx}px`,
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: "center center",
          zIndex: sticker.z_index,
        }}
        onPointerDown={handleMovePointerDown}
        className={`absolute select-none ${
          sticker.is_locked ? "pointer-events-none" : "pointer-events-auto"
        }`}
      >
        {/* Outer Rotation Halo (14px margin outside the image boundary): dragging outside the image rotates it */}
        {!sticker.is_locked && (
          <div
            data-sticker-handle="rotate-ring"
            onPointerDown={handleRotatePointerDown}
            className="absolute -inset-3.5 z-0 cursor-grab active:cursor-grabbing"
          />
        )}

        {/* Cropped Image Viewport + Always-Visible Selection Frame When Unlocked (100% opacity by default when locked, or user-selected 1–10 opacity) */}
        <div
          style={{
            opacity: Math.max(1, Math.min(10, opacityLevel)) / 10,
          }}
          className={`relative z-10 w-full h-full overflow-hidden rounded-md transition-opacity ${
            sticker.is_locked ? "" : "ring-1 ring-hobo-red/65"
          }`}
        >
          {hasError ? (
            <div className="w-full h-full min-h-[64px] p-2 rounded-md bg-hobo-paperSolid/90 flex flex-col items-center justify-center gap-1 text-center text-hobo-muted">
              <ImageOff className="w-4 h-4 stroke-[1.5] text-hobo-red/80" />
              <span className="text-[9px] uppercase tracking-wider leading-tight">
                Image unavailable
              </span>
            </div>
          ) : resolvedSrc ? (
            <img
              ref={imgRef}
              src={resolvedSrc}
              alt=""
              draggable={false}
              onLoad={(ev) => {
                const el = ev.currentTarget;
                if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                  setNaturalRatio(el.naturalHeight / el.naturalWidth);
                }
              }}
              onError={() => setHasError(true)}
              style={{
                width: `${widthPx}px`,
                height: `${uncroppedHeightPx}px`,
                maxWidth: "none",
                transform: `translate(${-(cropLeft / 100) * widthPx}px, ${
                  -(cropTop / 100) * uncroppedHeightPx
                }px)`,
              }}
              className="block select-none pointer-events-none"
            />
          ) : null}
        </div>

        {/* Always-Visible Controls & Handles When Unlocked */}
        {!sticker.is_locked && (
          <>
            {/* Top-Right Action Pill: Rotate Indicator + Lock Button + Delete (`×`) Button */}
            <div
              data-sticker-handle="toolbar"
              className="absolute -top-5 right-0 z-30 flex items-center gap-1 bg-hobo-paperSolid/95 border border-hobo-lineDark px-1 py-0.5 shadow-sm"
            >
              <div
                data-sticker-handle="rotate-btn"
                onPointerDown={handleRotatePointerDown}
                className="p-0.5 text-hobo-muted hover:text-hobo-red cursor-grab active:cursor-grabbing"
              >
                <RotateCw className="w-2.5 h-2.5 stroke-[1.75]" />
              </div>

              <button
                type="button"
                data-sticker-handle="lock-btn"
                onClick={handleToggleLock}
                className="p-0.5 text-hobo-ink hover:text-hobo-red bg-transparent border-0"
              >
                <Unlock className="w-2.5 h-2.5 stroke-[1.75]" />
              </button>

              <button
                type="button"
                data-sticker-handle="delete-btn"
                onClick={handleDelete}
                className="p-0.5 text-hobo-ink hover:text-hobo-red bg-transparent border-0"
              >
                <X className="w-2.5 h-2.5 stroke-[1.75]" />
              </button>
            </div>

            {/* 4 Corner Handles -> Aspect-Ratio Resize */}
            <div
              data-sticker-handle="corner-nw"
              onPointerDown={(e) => handleCornerResizePointerDown("nw", e)}
              className="absolute -top-1.5 -left-1.5 w-2.5 h-2.5 bg-hobo-paperSolid border border-hobo-red z-30 cursor-nwse-resize"
            />
            <div
              data-sticker-handle="corner-ne"
              onPointerDown={(e) => handleCornerResizePointerDown("ne", e)}
              className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-hobo-paperSolid border border-hobo-red z-30 cursor-nesw-resize"
            />
            <div
              data-sticker-handle="corner-se"
              onPointerDown={(e) => handleCornerResizePointerDown("se", e)}
              className="absolute -bottom-1.5 -right-1.5 w-2.5 h-2.5 bg-hobo-paperSolid border border-hobo-red z-30 cursor-nwse-resize"
            />
            <div
              data-sticker-handle="corner-sw"
              onPointerDown={(e) => handleCornerResizePointerDown("sw", e)}
              className="absolute -bottom-1.5 -left-1.5 w-2.5 h-2.5 bg-hobo-paperSolid border border-hobo-red z-30 cursor-nesw-resize"
            />

            {/* 4 Straight Edge Bars -> Crop Top, Right, Bottom, Left */}
            <div
              data-sticker-handle="edge-top"
              onPointerDown={(e) => handleEdgeCropPointerDown("top", e)}
              className="absolute -top-1 left-1/2 -translate-x-1/2 w-5 h-1.5 bg-hobo-red/85 z-20 cursor-ns-resize"
            />
            <div
              data-sticker-handle="edge-bottom"
              onPointerDown={(e) => handleEdgeCropPointerDown("bottom", e)}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-1.5 bg-hobo-red/85 z-20 cursor-ns-resize"
            />
            <div
              data-sticker-handle="edge-left"
              onPointerDown={(e) => handleEdgeCropPointerDown("left", e)}
              className="absolute top-1/2 -translate-y-1/2 -left-1 w-1.5 h-5 bg-hobo-red/85 z-20 cursor-ew-resize"
            />
            <div
              data-sticker-handle="edge-right"
              onPointerDown={(e) => handleEdgeCropPointerDown("right", e)}
              className="absolute top-1/2 -translate-y-1/2 -right-1 w-1.5 h-5 bg-hobo-red/85 z-20 cursor-ew-resize"
            />
          </>
        )}
      </div>

      {/* Right-Click Context Menu When Sticker Is Locked: Portaled to document.body above all elements */}
      {sticker.is_locked &&
        unlockMenuPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: `${Math.min(unlockMenuPos.x, window.innerWidth - 195)}px`,
              top: `${Math.min(unlockMenuPos.y, window.innerHeight - 105)}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            className="z-[9999] w-44 bg-hobo-paperSolid border border-hobo-lineDark shadow-sm py-1.5 px-2 pointer-events-auto select-none space-y-1.5"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setUnlockMenuPos(null);
                onUpdateImage(sticker.id, { is_locked: false });
              }}
              className="w-full flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-hobo-ink hover:text-hobo-red hover:bg-hobo-redSoft transition-colors bg-transparent border-0"
            >
              <Lock className="w-3 h-3 stroke-[1.5]" />
              <span>Unlock Image</span>
            </button>

            <div className="pt-1 border-t border-hobo-line space-y-1">
              <div className="flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.12em] text-hobo-muted">
                <span>Opacity</span>
                <span className="text-hobo-ink font-normal">
                  {opacityLevel} ({opacityLevel * 10}%)
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((lvl) => {
                  const isSelected = opacityLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpacityLevel(lvl);
                        onUpdateImage(sticker.id, { opacity: lvl });
                      }}
                      className={`py-0.5 text-[10px] border transition-colors ${
                        isSelected
                          ? "border-hobo-red bg-hobo-redSoft text-hobo-red font-normal"
                          : "border-hobo-lineDark text-hobo-ink hover:border-hobo-red hover:text-hobo-red bg-transparent"
                      }`}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export const WeeklyImageLayer: React.FC<WeeklyImageLayerProps> = ({
  images,
  containerRef,
  onUpdateImage,
  onDeleteImage,
}) => {
  if (images.length === 0) return null;

  const maxZIndex = images.reduce(
    (max, img) => Math.max(max, img.z_index || 10),
    10
  );

  const lockedStickers = images.filter((img) => img.is_locked);
  const unlockedStickers = images.filter((img) => !img.is_locked);

  return (
    <>
      {/* Locked Stickers Layer (`z-[5]`): sits above grid/lines and underneath all text (`z-10`) */}
      {lockedStickers.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-[5]">
          {lockedStickers.map((sticker) => (
            <StickerItem
              key={sticker.id}
              sticker={sticker}
              containerRef={containerRef}
              maxZIndex={maxZIndex}
              onUpdateImage={onUpdateImage}
              onDeleteImage={onDeleteImage}
            />
          ))}
        </div>
      )}

      {/* Unlocked Stickers Layer (`z-40`): always on the topmost layer so unlocked stickers are 100% interactable everywhere */}
      {unlockedStickers.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-40">
          {unlockedStickers.map((sticker) => (
            <StickerItem
              key={sticker.id}
              sticker={sticker}
              containerRef={containerRef}
              maxZIndex={maxZIndex}
              onUpdateImage={onUpdateImage}
              onDeleteImage={onDeleteImage}
            />
          ))}
        </div>
      )}
    </>
  );
};
