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

const HANDLE_SIZE_PX = 12;
const MIN_CURVE_RADIUS = 20;
// P26 — radius can grow up to 50× the bbox dimension so the user can
// dial in nearly-flat curves that match real jewelry shapes (slightly
// curved necklaces, gentle pendant arcs). With factor 4 you couldn't
// get past a fairly tight curl.
const MAX_CURVE_RADIUS_FACTOR = 50;
const ROTATION_HANDLE_OFFSET_PX = 30; // distance above bbox top in design space units

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

  // P25-5 — start a curve-radius drag. Pivot is the bbox center; new
  // radius = distance(pointer, pivot) clamped to a sensible range.
  function handleCurveHandlePointerDown(e: React.PointerEvent, f: PersonalizerField) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(f.id);
    setChromeHidden(false);
    const b = fieldBbox(f);
    const pivotX = b.x + Math.floor(b.w / 2);
    const pivotY = b.y + Math.floor(b.h / 2);
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
      const x1 = Math.min(p.x, drag.anchorX);
      const y1 = Math.min(p.y, drag.anchorY);
      const x2 = Math.max(p.x, drag.anchorX);
      const y2 = Math.max(p.y, drag.anchorY);
      const w = Math.max(20, x2 - x1);
      const h = Math.max(16, y2 - y1);
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
      // P26 — signed radius. The handle's vertical position relative to
      // the pivot determines BOTH the magnitude and the direction:
      //   handle ABOVE pivot → positive radius → text bulges upward
      //   handle BELOW pivot → negative radius → text rolls underneath
      // Magnitude is the radial distance (sqrt(dx²+dy²)) so horizontal
      // motion still affects how flat the curve looks; vertical motion
      // determines sign.
      const dx = p.x - drag.pivotX;
      const dy = p.y - drag.pivotY;
      const f = fields.find((x) => x.id === drag.fieldId);
      const b = f ? fieldBbox(f) : null;
      const maxR = b
        ? Math.max(b.w, b.h) * MAX_CURVE_RADIUS_FACTOR
        : Math.max(template.canvas_width, template.canvas_height);
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      // Above pivot (dy<0) → positive r (curve up). Below → negative.
      const sign = dy <= 0 ? 1 : -1;
      const r = Math.round(sign * clamp(magnitude, MIN_CURVE_RADIUS, maxR));
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
        className="relative w-full"
        style={{ maxWidth: 480, aspectRatio: `${w} / ${h}` }}
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
            // P26 — signed radius support. |curveR| is the visual size;
            // sign decides whether the apex is above (positive) or below
            // (negative) the bbox center. The handle naturally tracks
            // because we add cy - curveR (so negative curveR places the
            // handle BELOW cy by |curveR|).
            const absCurveR = Math.abs(curveR);
            const curveSweep = curveR < 0 ? 0 : 1;
            const cx = b.x + Math.floor(b.w / 2);
            const cy = b.y + Math.floor(b.h / 2);
            // Apex of the arc (above for positive radius, below for
            // negative) — always opposite the bbox center.
            const handleX = cx;
            const handleY = cy - curveR;

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
                      <path
                        d={`M ${cx - absCurveR} ${cy} A ${absCurveR} ${absCurveR} 0 0 ${curveSweep} ${cx + absCurveR} ${cy}`}
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
                      : `M ${cx - absCurveR} ${cy} A ${absCurveR} ${absCurveR} 0 0 ${curveSweep} ${cx + absCurveR} ${cy}`}
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
                    fill={showChrome ? 'rgba(24,95,165,0.08)' : 'transparent'}
                    stroke={showChrome ? stroke : 'none'}
                    strokeWidth={showChrome ? 2 : 0}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => handleBodyPointerDown(e, f)}
                  />
                )}
                {showChrome &&
                  handles.map((hd) => (
                    <rect
                      key={hd.corner}
                      x={hd.cx - handleR}
                      y={hd.cy - handleR}
                      width={handleR * 2}
                      height={handleR * 2}
                      fill="#fff"
                      stroke="#185FA5"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: hd.cursor }}
                      onPointerDown={(e) => handleHandlePointerDown(e, f, hd.corner)}
                    />
                  ))}
                {showCurveAffordance && (
                  <>
                    {/* Larger transparent hit-target so the tiny visual
                        dot is easier to grab on touch devices. */}
                    <circle
                      cx={handleX}
                      cy={handleY}
                      r={handleR * 1.5}
                      fill="transparent"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => handleCurveHandlePointerDown(e, f)}
                    />
                    {/* Visible handle dot — solid blue with white halo
                        so it stands out against any product image. */}
                    <circle
                      cx={handleX}
                      cy={handleY}
                      r={handleR * 0.8}
                      fill="#185FA5"
                      stroke="#fff"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: 'grab', pointerEvents: 'none' }}
                    />
                  </>
                )}
                {/* P25-V4 — rotation handle. Floats above the bbox top edge,
                    centered horizontally. The OUTER <g> wrapper already
                    rotates the entire chrome (bbox + handles + this) so
                    we draw the handle in pre-rotation coords. */}
                {showChrome && (
                  <g>
                    <line
                      x1={b.x + b.w / 2}
                      y1={b.y}
                      x2={b.x + b.w / 2}
                      y2={b.y - ROTATION_HANDLE_OFFSET_PX}
                      stroke="#185FA5"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    {/* Larger transparent hit-target. */}
                    <circle
                      cx={b.x + b.w / 2}
                      cy={b.y - ROTATION_HANDLE_OFFSET_PX}
                      r={handleR * 1.6}
                      fill="transparent"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => handleRotateHandlePointerDown(e, f)}
                    />
                    {/* Visible rotation icon — green ring (distinct from
                        the blue resize handles + curve dot). */}
                    <circle
                      cx={b.x + b.w / 2}
                      cy={b.y - ROTATION_HANDLE_OFFSET_PX}
                      r={handleR * 0.9}
                      fill="#fff"
                      stroke="#16a34a"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                    <circle
                      cx={b.x + b.w / 2}
                      cy={b.y - ROTATION_HANDLE_OFFSET_PX}
                      r={handleR * 0.3}
                      fill="#16a34a"
                      pointerEvents="none"
                    />
                  </g>
                )}
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
