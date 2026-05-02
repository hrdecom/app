import { useEffect, useMemo, useRef, useState } from 'react';
import { renderPreviewSvg } from '@/lib/personalizer-render';
import type { PersonalizerTemplate, PersonalizerField } from '@/lib/personalizer-api';

interface Props {
  template: PersonalizerTemplate;
  fields: PersonalizerField[];
  selectedFieldId: number | null;
  onSelect: (id: number) => void;
  /** P25-1 — clicking empty canvas area clears the selection so the
   * preview is unobstructed. The bbox / handles for the previously
   * selected field disappear. */
  onDeselect?: () => void;
  /** Commits a field bbox change (drag/resize) when the user releases the mouse. */
  onCommit: (fieldId: number, patch: Partial<PersonalizerField>) => void;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; fieldId: number; offsetSvgX: number; offsetSvgY: number }
  | {
      kind: 'resize';
      fieldId: number;
      corner: 'nw' | 'ne' | 'sw' | 'se';
      anchorX: number;
      anchorY: number;
    }
  /** P25-5 — drag the curve apex handle to live-edit `curve_radius_px`.
   * The pivot is the bbox center; new radius = distance(pointer, pivot). */
  | { kind: 'curve_radius'; fieldId: number; pivotX: number; pivotY: number }
  /** P25-V4 — drag the rotation handle to live-edit `rotation_deg`.
   * Pivot = bbox center; new angle = atan2(pointer - pivot) - startOffset. */
  | { kind: 'rotate'; fieldId: number; pivotX: number; pivotY: number; startAngleDeg: number; startRotationDeg: number };

// P26-4 — corner handles are now smaller and OUTLINE-ONLY (no fill)
// so the bbox content remains fully visible between them. Resize
// hit area is still generous via a transparent square overlay.
const HANDLE_SIZE_PX = 7;
// P26 — radius can grow up to 50x the bbox dimension so the user can
// dial in nearly-flat curves that match real jewelry shapes.
const MAX_CURVE_RADIUS_FACTOR = 50;
const ROTATION_HANDLE_OFFSET_PX = 70; // far enough above to not crowd the curve handle
// P26-4 — curve handle resting position is now BELOW the bbox bottom
// (instead of at the apex on top of the text) so the merchant can
// always read what the text says. Drag math uses this resting Y as
// the sagitta=0 origin: dragging the handle UP toward the bbox
// increases positive sagitta (curve UP); dragging DOWN past resting
// flips to negative sagitta (curve DOWN).
const CURVE_HANDLE_OFFSET_PX = 38;

/**
 * Personalizer admin canvas. Renders the base product image + each
 * field's current bbox as a draggable/resizable overlay. Reuses the
 * same `renderPreviewSvg` the storefront uses for the static layer
 * (image + text + image fields), then layers a React-managed SVG on
 * top for interactive bbox manipulation.
 *
 * Drag math: the overlay <svg> shares its viewBox with the static
 * preview underneath, so logical coordinates (position_x, position_y,
 * width, height) live in the design coordinate space (typically
 * 1080×1080) regardless of the rendered display size. Pointer events
 * are converted screen → SVG via getBoundingClientRect + viewBox.
 */
export function PersonalizerCanvas({
  template,
  fields,
  selectedFieldId,
  onSelect,
  onDeselect: _onDeselect, // P25-V2 — kept in props for back-compat; unused now
  onCommit,
}: Props) {
  const overlayRef = useRef<SVGSVGElement>(null);

  // Local optimistic overrides per-field while dragging. Cleared on
  // commit so server values become authoritative. Without this we'd
  // need to round-trip through onCommit for every mousemove — choppy
  // and wasteful.
  const [drag, setDrag] = useState<DragMode>({ kind: 'none' });
  const [draftPos, setDraftPos] = useState<
    Record<number, { position_x: number; position_y: number; width: number; height: number }>
  >({});
  // P25-5 — same idea as draftPos but for the live curve radius. Cleared
  // a tick after commit so the next render uses the server-confirmed value.
  const [draftCurve, setDraftCurve] = useState<Record<number, { curve_radius_px: number }>>({});
  // P25-V4 — live rotation override during a drag. Cleared on commit so
  // the next render uses the server-confirmed value.
  const [draftRotation, setDraftRotation] = useState<Record<number, { rotation_deg: number }>>({});
  // P25-V2 — when TRUE, hide ALL editing chrome (bboxes, handles, curve
  // guides) so the canvas reads as a pure storefront preview. Toggled on
  // by clicking the empty canvas area, off by clicking any field.
  // The selected field stays selected (right-side config form stays open).
  const [chromeHidden, setChromeHidden] = useState(false);

  const previewHtml = useMemo(() => {
    const values: Record<number, string> = {};
    for (const f of fields) {
      // Use draft override if mid-drag, else default/placeholder for visual continuity
      values[f.id] =
        f.default_value || f.placeholder || (f.field_kind === 'text' ? '' : '');
    }
    // Build a synthetic field set that uses draft positions / curve
    // radius where present, so the rendered text/image follows the
    // user's drag in real time.
    const fieldsWithDraft = fields.map((f) => {
      let merged: PersonalizerField = f;
      if (draftPos[f.id]) merged = { ...merged, ...draftPos[f.id] };
      if (draftCurve[f.id]) {
        merged = {
          ...merged,
          ...draftCurve[f.id],
          // Wipe any pre-baked path so the renderer recomputes from the new radius.
          curve_path_d: null,
        };
      }
      if (draftRotation[f.id]) merged = { ...merged, ...draftRotation[f.id] };
      return merged;
    });
    return renderPreviewSvg({
      template: {
        canvas_width: template.canvas_width,
        canvas_height: template.canvas_height,
        base_image_url: template.base_image_url,
        // P26-11 — pass base_image_layer_z so the renderer respects
        // the merchant's drag-to-reorder choice. Was missing before;
        // the renderer fell back to its hardcoded default (5) which
        // made the image always render last (visually on top) once
        // the unified-layer recompute pushed all field z values into
        // the 1..N range below 5.
        base_image_layer_z: template.base_image_layer_z,
      },
      fields: fieldsWithDraft,
      values,
    });
    // P25-V4 — draftRotation in deps so the preview re-renders LIVE during
    // a rotation drag (not just on commit).
  }, [template, fields, draftPos, draftCurve, draftRotation]);

  function fieldBbox(f: PersonalizerField) {
    const o = draftPos[f.id];
    return {
      x: o?.position_x ?? f.position_x,
      y: o?.position_y ?? f.position_y,
      w: o?.width ?? f.width,
      h: o?.height ?? f.height,
    };
  }

  // P25-5 — current curve radius (with live draft override) for a field.
  // Falls back to half the bbox width to mirror the renderer's default.
  function fieldCurveRadius(f: PersonalizerField): number {
    const draft = draftCurve[f.id]?.curve_radius_px;
    if (draft != null) return draft;
    if (f.curve_radius_px != null) return f.curve_radius_px;
    return Math.floor((draftPos[f.id]?.width ?? f.width) / 2);
  }

  // Convert a pointer event's clientX/Y to the SVG's user coordinates
  // (the design space — 1080 wide etc.). Uses the overlay's viewBox so
  // it stays correct at any rendered size.
  function svgPoint(e: React.PointerEvent | PointerEvent) {
    const svg = overlayRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((e.clientX - rect.left) / rect.width) * vb.width + vb.x;
    const y = ((e.clientY - rect.top) / rect.height) * vb.height + vb.y;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function handleBodyPointerDown(e: React.PointerEvent, f: PersonalizerField) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.id);
    setChromeHidden(false); // re-show chrome when the user grabs a field
    const p = svgPoint(e);
    const b = fieldBbox(f);
    setDrag({
      kind: 'move',
      fieldId: f.id,
      offsetSvgX: p.x - b.x,
      offsetSvgY: p.y - b.y,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handleHandlePointerDown(
    e: React.PointerEvent,
    f: PersonalizerField,
    corner: 'nw' | 'ne' | 'sw' | 'se',
  ) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.id);
    setChromeHidden(false);
    const b = fieldBbox(f);
    // Anchor = the OPPOSITE corner. We resize by moving the dragged
    // corner; the anchor stays put.
    const anchorX = corner === 'nw' || corner === 'sw' ? b.x + b.w : b.x;
    const anchorY = corner === 'nw' || corner === 'ne' ? b.y + b.h : b.y;
    setDrag({ kind: 'resize', fieldId: f.id, corner, anchorX, anchorY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  // P25-5 / P26-4 — start a curve-radius drag. Pivot is now the
  // RESTING position of the handle (below the bbox by a fixed
  // offset). Sagitta = (restingY - cursorY) so dragging UP toward
  // the bbox makes the text bulge up more; dragging DOWN past the
  // resting point flips to a downward curve.
  function handleCurveHandlePointerDown(e: React.PointerEvent, f: PersonalizerField) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.id);
    setChromeHidden(false);
    const b = fieldBbox(f);
    const pivotX = b.x + Math.floor(b.w / 2);
    const pivotY = b.y + b.h + CURVE_HANDLE_OFFSET_PX;
    setDrag({ kind: 'curve_radius', fieldId: f.id, pivotX, pivotY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  // P25-V4 — start a rotation drag. Pivot = bbox center; we record the
  // pointer's starting angle so rotation tracks RELATIVE motion (the
  // user can grab the handle from any angle and rotate naturally).
  function handleRotateHandlePointerDown(e: React.PointerEvent, f: PersonalizerField) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.id);
    setChromeHidden(false);
    const b = fieldBbox(f);
    const pivotX = b.x + Math.floor(b.w / 2);
    const pivotY = b.y + Math.floor(b.h / 2);
    const p = svgPoint(e);
    const startAngleDeg = (Math.atan2(p.y - pivotY, p.x - pivotX) * 180) / Math.PI;
    setDrag({
      kind: 'rotate',
      fieldId: f.id,
      pivotX,
      pivotY,
      startAngleDeg,
      startRotationDeg: f.rotation_deg ?? 0,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (drag.kind === 'none') return;
    const p = svgPoint(e);
    if (drag.kind === 'move') {
      setDraftPos((prev) => {
        const f = fields.find((x) => x.id === drag.fieldId);
        if (!f) return prev;
        const b = fieldBbox(f);
        return {
          ...prev,
          [drag.fieldId]: {
            position_x: clamp(p.x - drag.offsetSvgX, 0, template.canvas_width - b.w),
            position_y: clamp(p.y - drag.offsetSvgY, 0, template.canvas_height - b.h),
            width: b.w,
            height: b.h,
          },
        };
      });
    } else if (drag.kind === 'resize') {
      const x1raw = Math.min(p.x, drag.anchorX);
      const y1raw = Math.min(p.y, drag.anchorY);
      const x2raw = Math.max(p.x, drag.anchorX);
      const y2raw = Math.max(p.y, drag.anchorY);
      let wRaw = Math.max(20, x2raw - x1raw);
      let hRaw = Math.max(16, y2raw - y1raw);
      // P26-12 — image fields lock aspect ratio during resize so the
      // mask doesn't crop unexpectedly. Use the field's CURRENT
      // aspect ratio as the constraint; cursor sets the larger of
      // the two dimensions, the other follows.
      const f = fields.find((x) => x.id === drag.fieldId);
      let w = wRaw, h = hRaw;
      let x1 = x1raw, y1 = y1raw;
      if (f && f.field_kind === 'image') {
        const refW = (draftPos[f.id]?.width ?? f.width) || 1;
        const refH = (draftPos[f.id]?.height ?? f.height) || 1;
        const aspect = refW / refH;
        // Use whichever dimension grew the most as the driver.
        if (wRaw / aspect >= hRaw) {
          h = Math.round(wRaw / aspect);
          w = wRaw;
        } else {
          w = Math.round(hRaw * aspect);
          h = hRaw;
        }
        // Recompute x1/y1 so the OPPOSITE corner (anchor) stays put.
        x1 = drag.corner === 'nw' || drag.corner === 'sw' ? drag.anchorX - w : drag.anchorX;
        y1 = drag.corner === 'nw' || drag.corner === 'ne' ? drag.anchorY - h : drag.anchorY;
      }
      setDraftPos((prev) => ({
        ...prev,
        [drag.fieldId]: {
          position_x: clamp(x1, 0, template.canvas_width - w),
          position_y: clamp(y1, 0, template.canvas_height - h),
          width: Math.min(w, template.canvas_width),
          height: Math.min(h, template.canvas_height),
        },
      }));
    } else if (drag.kind === 'curve_radius') {
      // P26-2 — sagitta-based radius. The arc is anchored to the
      // bbox horizontally (chord = bbox width at vertical center).
      // Curvature only changes the "rise" (sagitta) of the apex
      // above or below the chord — the text endpoints stay where
      // they are. This matches the customer's intuition: "drag the
      // handle to bend the text more or less, not to move it."
      //   sagitta s = -dy (above pivot ⇒ positive ⇒ curve up)
      //   For chord half-width c and sagitta s, radius is:
      //     r = (c² + s²) / (2|s|)
      //   r → ∞ as s → 0 (straight line). Clamp s away from zero
      //   so we don't get NaN; cap |r| at MAX × bbox so the slider
      //   doesn't go absurdly flat (interpreted as "no curve").
      const dy = p.y - drag.pivotY;
      const f = fields.find((x) => x.id === drag.fieldId);
      const b = f ? fieldBbox(f) : null;
      if (!b) return;
      const halfChord = b.w / 2;
      const sagitta = -dy; // positive = apex above pivot
      const absSag = Math.abs(sagitta);
      const minSag = 0.5; // less than this is treated as straight
      let r: number;
      if (absSag < minSag) {
        r = halfChord * MAX_CURVE_RADIUS_FACTOR; // effectively flat
      } else {
        r = (halfChord * halfChord + sagitta * sagitta) / (2 * absSag);
        // Sign follows sagitta direction.
        if (sagitta < 0) r = -r;
      }
      const maxR = halfChord * MAX_CURVE_RADIUS_FACTOR;
      r = Math.round(clamp(r, -maxR, maxR));
      // Floor magnitude at halfChord (smaller would not allow the
      // chord to fit in the circle — semicircle is the tightest).
      if (Math.abs(r) < halfChord) r = halfChord * Math.sign(r || 1);
      setDraftCurve((prev) => ({ ...prev, [drag.fieldId]: { curve_radius_px: r } }));
    } else if (drag.kind === 'rotate') {
      // P25-V4 — relative rotation. New angle = startRot + (currentMouseAngle - startMouseAngle).
      // Shift = snap to 15° increments for clean angles.
      const currentAngleDeg = (Math.atan2(p.y - drag.pivotY, p.x - drag.pivotX) * 180) / Math.PI;
      let newRot = drag.startRotationDeg + (currentAngleDeg - drag.startAngleDeg);
      // Normalize to (-180, 180]
      while (newRot > 180) newRot -= 360;
      while (newRot <= -180) newRot += 360;
      if (e.shiftKey) newRot = Math.round(newRot / 15) * 15;
      else newRot = Math.round(newRot * 2) / 2; // 0.5° granularity
      setDraftRotation((prev) => ({ ...prev, [drag.fieldId]: { rotation_deg: newRot } }));
    }
  }

  function handlePointerUp() {
    if (drag.kind === 'none') return;
    const fieldId = drag.fieldId;
    if (drag.kind === 'curve_radius') {
      const cd = draftCurve[fieldId];
      if (cd) onCommit(fieldId, cd);
      setDrag({ kind: 'none' });
      setTimeout(() => setDraftCurve((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }), 50);
      return;
    }
    if (drag.kind === 'rotate') {
      // P25-V4 — commit rotation patch and clear the local override.
      const rd = draftRotation[fieldId];
      if (rd) onCommit(fieldId, rd);
      setDrag({ kind: 'none' });
      setTimeout(() => setDraftRotation((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }), 50);
      return;
    }
    const draft = draftPos[fieldId];
    if (draft) {
      onCommit(fieldId, draft);
    }
    setDrag({ kind: 'none' });
    // Clear local draft after a tick so the next render uses the
    // committed server state. If we cleared synchronously we'd flash
    // the old value for one frame between commit and refetch.
    setTimeout(() => setDraftPos((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    }), 50);
  }

  // Handle the (rare) case where the pointer is released outside the
  // canvas — pointer capture should normally bubble the up event back,
  // but on touch some browsers drop it. Listen on window as a safety net.
  useEffect(() => {
    if (drag.kind === 'none') return;
    const onUp = () => handlePointerUp();
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag.kind, drag.kind !== 'none' ? drag.fieldId : null]);

  const w = template.canvas_width;
  const h = template.canvas_height;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4 min-h-[400px] flex items-center justify-center">
      <div
        // P26-9 — let the canvas breathe responsively. Max width was
        // hardcoded to 480 px, which made the preview useless on a
        // narrowed laptop. Now it expands to fill its column up to a
        // sensible cap that still leaves room for the right-side
        // FieldConfigForm.
        className="relative w-full"
        style={{ maxWidth: 720, aspectRatio: `${w} / ${h}` }}
      >
        <div
          className="absolute inset-0 select-none pointer-events-none"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        <svg
          ref={overlayRef}
          viewBox={`0 0 ${w} ${h}`}
          className="absolute inset-0 w-full h-full select-none"
          style={{ touchAction: 'none' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={(e) => {
            // P25-V2 — clicking empty canvas HIDES the chrome (bbox /
            // handles / curve guides) so the preview reads cleanly,
            // but does NOT deselect the field — the right-side config
            // form stays open so the admin can keep tweaking values.
            // Click any field again to bring chrome back.
            if (e.target === overlayRef.current) {
              e.preventDefault();
              setChromeHidden(true);
            }
          }}
        >
          {fields.map((f) => {
            const b = fieldBbox(f);
            const isSelected = f.id === selectedFieldId;
            // P25-V2 — chrome (visible bbox + handles + curve guide) is
            // ONLY drawn for the actively-selected field, AND only when
            // the user hasn't clicked the empty canvas to hide it. All
            // other fields remain interactive (an invisible click-
            // target rect catches pointer events) but draw zero visible
            // chrome — the canvas reads as a clean storefront preview.
            const showChrome = isSelected && !chromeHidden;
            const stroke = '#185FA5';
            const handles: Array<{ corner: 'nw' | 'ne' | 'sw' | 'se'; cx: number; cy: number; cursor: string }> = [
              { corner: 'nw', cx: b.x, cy: b.y, cursor: 'nwse-resize' },
              { corner: 'ne', cx: b.x + b.w, cy: b.y, cursor: 'nesw-resize' },
              { corner: 'sw', cx: b.x, cy: b.y + b.h, cursor: 'nesw-resize' },
              { corner: 'se', cx: b.x + b.w, cy: b.y + b.h, cursor: 'nwse-resize' },
            ];
            // Approximate the handle radius in design space so it's
            // ~12 px on screen regardless of the SVG rendered size.
            const svgEl = overlayRef.current;
            const renderedW = svgEl?.clientWidth || 480;
            const handleR = (HANDLE_SIZE_PX / renderedW) * w / 2;

            // P25-5 — show the curve guide + apex handle for arc/circle
            // text fields when selected AND chrome is visible.
            const isCurved =
              f.field_kind === 'text' &&
              (f.curve_mode === 'arc' || f.curve_mode === 'circle');
            const showCurveAffordance = showChrome && isCurved;
            const curveR = showCurveAffordance ? fieldCurveRadius(f) : 0;
            // P26-2 — chord-through-bbox geometry. The arc spans the
            // bbox horizontally at vertical center; sagitta (rise of
            // apex above/below chord) is what the curve handle drags.
            const absCurveR = Math.abs(curveR);
            const curveSweep = curveR < 0 ? 0 : 1;
            const cx = b.x + Math.floor(b.w / 2);
            const cy = b.y + Math.floor(b.h / 2);
            // Sagitta from radius and chord:
            //   if |r| ≥ chord/2: s = |r| - sqrt(r² - (chord/2)²)
            //   if |r| < chord/2 (semicircle case): s = |r|
            const halfChord = b.w / 2;
            let sagitta = 0;
            if (showCurveAffordance && absCurveR > 0) {
              if (absCurveR >= halfChord) {
                sagitta = absCurveR - Math.sqrt(absCurveR * absCurveR - halfChord * halfChord);
              } else {
                sagitta = absCurveR;
              }
            }
            // P26-4 — handle now lives BELOW the bbox at a fixed
            // resting offset, NOT at the apex on top of the text.
            // The sagitta value is applied to the resting position so
            // the visual handle still reflects current curvature:
            //   sagitta > 0 (curve up)  -> handle moves UP from resting
            //   sagitta < 0 (curve down) -> handle moves DOWN from resting
            const restingY = b.y + b.h + CURVE_HANDLE_OFFSET_PX;
            const directedSagitta = curveR >= 0 ? sagitta : -sagitta;
            const handleX = cx;
            const handleY = restingY - directedSagitta;

            // P25-V4 — apply the field's rotation to the entire chrome
            // group (bbox + handles + curve guide + rotation handle).
            // The rotation handle's pointer math is in DESIGN-space
            // coordinates; rotating the visual group keeps it in sync
            // with the rendered text/image while drag math stays
            // unrotated (we transform pointer coords for that).
            const fieldRotation =
              draftRotation[f.id]?.rotation_deg ?? f.rotation_deg ?? 0;
            const rotateTransform = fieldRotation !== 0
              ? `rotate(${fieldRotation} ${b.x + b.w / 2} ${b.y + b.h / 2})`
              : undefined;

            return (
              <g key={f.id} transform={rotateTransform}>
                {showCurveAffordance && (
                  <g pointerEvents="none">
                    {/* Faded radial guide line so the user understands
                        the handle distance = radius. */}
                    <line
                      x1={cx}
                      y1={cy}
                      x2={handleX}
                      y2={handleY}
                      stroke="#185FA5"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      opacity={0.55}
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* The curve itself — full circle for 'circle' mode,
                        half-arc for 'arc' mode. Draws under the handle. */}
                    {f.curve_mode === 'circle' ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={absCurveR}
                        fill="none"
                        stroke="#185FA5"
                        strokeWidth={1.5}
                        strokeDasharray="6 4"
                        opacity={0.6}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      // P26-2 — guide arc spans bbox horizontally; the
                      // sagitta-based geometry matches what the renderer
                      // emits, so this dashed line literally traces the
                      // text path.
                      <path
                        d={`M ${b.x} ${cy} A ${Math.max(absCurveR, halfChord)} ${Math.max(absCurveR, halfChord)} 0 0 ${curveSweep} ${b.x + b.w} ${cy}`}
                        fill="none"
                        stroke="#185FA5"
                        strokeWidth={1.5}
                        strokeDasharray="6 4"
                        opacity={0.6}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </g>
                )}
                {/* P26 — hit target. ALWAYS rendered (even when the
                    field isn't selected) so clicking the visible glyph
                    of curved text picks it up. Pre-V6 the curve hit
                    path was gated on `showChrome`, which meant an
                    unselected curved field fell back to the bbox rect
                    that sits BELOW the visible text — clicks on the
                    curving glyph missed and the user had to click into
                    empty space below the text. Now the curve hit
                    target is always active for curved fields and the
                    rect is always active for non-curved.

                    Curved fields get a fat transparent stroke along
                    the actual arc/circle path so the click area hugs
                    the visible text. Non-curved fields use a normal
                    rect at the bbox.

                    Visible chrome (blue stroke + faint fill) is drawn
                    SEPARATELY below in the `showChrome` block. */}
                {isCurved && absCurveR > 0 ? (
                  <path
                    d={f.curve_mode === 'circle'
                      ? `M ${cx - absCurveR} ${cy} A ${absCurveR} ${absCurveR} 0 1 1 ${cx + absCurveR} ${cy} A ${absCurveR} ${absCurveR} 0 1 1 ${cx - absCurveR} ${cy} Z`
                      : `M ${b.x} ${cy} A ${Math.max(absCurveR, halfChord)} ${Math.max(absCurveR, halfChord)} 0 0 ${curveSweep} ${b.x + b.w} ${cy}`}
                    fill="none"
                    stroke={showChrome ? 'rgba(24,95,165,0.25)' : 'transparent'}
                    strokeWidth={Math.max(b.h, 36)}
                    strokeLinecap="round"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => handleBodyPointerDown(e, f)}
                  />
                ) : (
                  <rect
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    // P26-3 — bbox outline only (no fill) so the text
                    // underneath stays fully readable. Dashed stroke
                    // reads as "guide / selection box" rather than a
                    // colored block dominating the canvas.
                    fill="transparent"
                    stroke={showChrome ? stroke : 'none'}
                    strokeWidth={showChrome ? 1.5 : 0}
                    strokeDasharray={showChrome ? '4 3' : undefined}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => handleBodyPointerDown(e, f)}
                  />
                )}
                {/* P26-4 — corner resize handles. Tiny outline-only
                    circles (no fill) so the bbox content is fully
                    visible between them. The hit region is a separate
                    transparent square ~3.5x the visible radius so
                    they're still easy to grab on touch / desktop. */}
                {showChrome &&
                  handles.map((hd) => (
                    <g key={hd.corner}>
                      <circle
                        cx={hd.cx}
                        cy={hd.cy}
                        r={handleR}
                        fill="none"
                        stroke="#185FA5"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                      <rect
                        x={hd.cx - handleR * 1.8}
                        y={hd.cy - handleR * 1.8}
                        width={handleR * 3.6}
                        height={handleR * 3.6}
                        fill="transparent"
                        style={{ cursor: hd.cursor }}
                        onPointerDown={(e) => handleHandlePointerDown(e, f, hd.corner)}
                      />
                    </g>
                  ))}
                {showCurveAffordance && (
                  <>
                    {/* P26-3 — curve apex handle. Distinct purple
                        diamond so it cannot be confused with the
                        green rotation circle above. Hit target is a
                        bigger transparent square. */}
                    <rect
                      x={handleX - handleR * 1.8}
                      y={handleY - handleR * 1.8}
                      width={handleR * 3.6}
                      height={handleR * 3.6}
                      fill="transparent"
                      style={{ cursor: 'ns-resize' }}
                      onPointerDown={(e) => handleCurveHandlePointerDown(e, f)}
                    />
                    <g
                      transform={`translate(${handleX} ${handleY}) rotate(45)`}
                      pointerEvents="none"
                    >
                      <rect
                        x={-handleR}
                        y={-handleR}
                        width={handleR * 2}
                        height={handleR * 2}
                        fill="#a855f7"
                        stroke="#fff"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </>
                )}
                {/* P26-3 — rotation handle. Now sits 70 px above the
                    bbox (was 30) so it's visually well separated from
                    the purple curve apex handle. Drawn as a green
                    circular-arrow icon inside a circle so its purpose
                    is unmistakable. The dashed leader line connects
                    it to the bbox top edge so the user reads it as a
                    field control rather than a stray dot. */}
                {showChrome && (() => {
                  const rx = b.x + b.w / 2;
                  const ry = b.y - ROTATION_HANDLE_OFFSET_PX;
                  const ringR = handleR * 1.1;
                  const arrowR = ringR * 0.55;
                  return (
                    <g>
                      <line
                        x1={rx}
                        y1={b.y}
                        x2={rx}
                        y2={ry + ringR}
                        stroke="#16a34a"
                        strokeWidth={1.25}
                        strokeDasharray="3 3"
                        opacity={0.7}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                      {/* hit target */}
                      <circle
                        cx={rx}
                        cy={ry}
                        r={ringR * 1.6}
                        fill="transparent"
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => handleRotateHandlePointerDown(e, f)}
                      />
                      {/* visible: green disc with white circular-arrow icon */}
                      <circle
                        cx={rx}
                        cy={ry}
                        r={ringR}
                        fill="#16a34a"
                        stroke="#fff"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                      <path
                        d={`M ${rx + arrowR} ${ry} A ${arrowR} ${arrowR} 0 1 1 ${rx - arrowR * 0.001} ${ry - arrowR}`}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                        strokeLinecap="round"
                      />
                      <path
                        d={`M ${rx - arrowR * 0.35} ${ry - arrowR} L ${rx + arrowR * 0.001} ${ry - arrowR * 1.3} L ${rx + arrowR * 0.4} ${ry - arrowR * 0.7}`}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
