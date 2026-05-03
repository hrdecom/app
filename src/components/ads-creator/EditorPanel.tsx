import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import {
  Film, Plus, Trash2, Type, ImageIcon, Music, Upload,
  Send, Loader2, Pencil, X, Play, Pause, SkipBack, Eye,
  Undo2, Redo2, Lock, Unlock, Copy, Layers, AlignLeft, AlignCenter,
  AlignRight, RotateCw, Volume2, VolumeX, ChevronUp, ChevronDown,
  Maximize2, Minimize2, Megaphone,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { api as apiClient } from '@/lib/api';
import { composeVideo } from './videoComposer';
import {
  captureThumbnailFromUrl,
  composedKey,
  deleteComposedForProject,
  putComposedEntry,
} from './composedVideoStore';
import { listHeadlines, type AdHeadline } from '@/lib/ads-api';
import { listSoundsForAds, type SoundCategory, type SoundItem } from '@/lib/sound-library-api';

interface EditorPanelProps { productId: number; onExport?: (data: any) => void }

type ElementType = 'video' | 'image' | 'text' | 'audio';
type TextStyle = 'plain' | 'background' | 'outline' | 'shadow';
type ZoomEffect = 'none' | 'zoom-in' | 'zoom-out' | 'ken-burns';
type Format = 'vertical' | 'portrait';

interface LayoutData { x: number; y: number; width: number; height: number }

type TextAlign = 'left' | 'center' | 'right';

interface EditorElement {
  id: string; type: ElementType; src?: string;
  startTime: number; duration: number;
  // FIX — trim latency. When the user drags the LEFT trim handle to crop the
  // beginning of an audio/video clip (e.g. to skip a 1s silence), startTime
  // alone is NOT enough: it just delays the clip on the timeline but the
  // underlying <audio>/<video> still plays from position 0 of the source.
  // `sourceOffset` (seconds) is how far into the source the clip starts.
  // Absolute time inside the source = (timelineTime - startTime) + sourceOffset.
  // Undefined/0 for freshly-imported clips (plays from the beginning as before).
  sourceOffset?: number;
  text?: string; fontSize?: number; fontFamily?: string; color?: string;
  // ISSUE M — CSS font-weight (100 / 400 / 700 / 900). Undefined → 700 (old default).
  fontWeight?: number;
  // FEATURE — Typography spacing. letterSpacing in em (matches CSS tracking);
  // lineHeight as unitless multiplier (matches CSS leading). Defaults: 0 / 1.2.
  letterSpacing?: number;
  lineHeight?: number;
  textStyle?: TextStyle; bgColor?: string; borderRadius?: number;
  strokeWidth?: number; strokeColor?: string; shadowOffset?: number; shadowBlur?: number;
  textAlign?: TextAlign;
  opacity?: number; rotation?: number;
  zoomEffect?: ZoomEffect; zoomIntensity?: number;
  volume?: number; fadeIn?: boolean; fadeOut?: boolean;
  muted?: boolean; // For video clips - default true to allow autoplay
  reversed?: boolean; // FEATURE W — play video in reverse
  // ISSUE O — real underlying-media duration in seconds, captured via
  // HTMLMediaElement.loadedmetadata. Used to clamp trim-right so the user
  // cannot stretch a video clip past the real length of its source file.
  // Undefined until metadata has loaded (or for non-media clips like text).
  mediaDuration?: number;
  // Thumbnail (first frame) of a video clip, captured at import as a JPEG
  // dataURL. Rendered as a faint background on the timeline clip so videos
  // are visually distinguishable at a glance (CapCut-style). Undefined
  // until capture completes.
  thumbnailUrl?: string;
  layer?: number; // z-index stacking order
  vertical: LayoutData; portrait: LayoutData;
  // FEATURE U — Base size per format: the "100%" reference for the Size slider.
  // Seeded on element creation; updated when the user drags corner handles so the
  // slider always reads 100% after a manual resize (fine-tune from that baseline).
  baseVertical?: { width: number; height: number };
  basePortrait?: { width: number; height: number };
}

// ISSUE M — Expanded font family list. Google fonts (loaded below) live next to the
// system/web-safe fonts that already worked. Order optimised for "ad copy" typography
// (modern sans-serif families at the top).
// "System" is a virtual family that resolves to the OS-native sans-serif stack
// (system-ui, -apple-system, Segoe UI, Roboto, …) — see resolveFontStack() for
// the actual CSS expansion. It leads the list as the default TikTok-style font.
const FONT_FAMILIES = [
  'System', 'Proxima Nova', 'Inter', 'Roboto', 'Poppins', 'Montserrat', 'Playfair Display',
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New',
  'Verdana', 'Impact', 'Comic Sans MS', 'Trebuchet MS',
];

// Default font for freshly-inserted text elements. Centralising this in one
// constant keeps the preview canvas, the properties panel, and the composer
// fallbacks in lockstep.
const DEFAULT_TEXT_FONT = 'System';

// Resolves a stored fontFamily value into an actual CSS font stack.
// "System" expands to the cross-platform system-ui stack so the preview
// matches what TikTok / Reels ship by default.
function resolveFontStack(family: string | null | undefined): string {
  if (!family || family === 'System') {
    return 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  }
  return family;
}

// ISSUE M — Font weight presets matching the user spec
// (Thin / Normal / Bold / Extra Bold). CSS weights 100/400/700/900.
const FONT_WEIGHTS: { label: string; value: number }[] = [
  { label: 'Thin', value: 100 },
  { label: 'Normal', value: 400 },
  { label: 'Bold', value: 700 },
  { label: 'Extra Bold', value: 900 },
];

// ISSUE M — Load Google Fonts (all weights we actually expose) exactly once per
// page. Browsers deduplicate the <link> once it's inserted, and the families are
// scoped to display=swap so text renders immediately with a system fallback
// before the webfont is ready. This must run at module init time so fonts are
// available before the editor first renders (no layout-shift on open).
if (typeof document !== 'undefined') {
  const id = 'editor-google-fonts';
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?' +
      [
        'family=Inter:wght@100;400;700;900',
        'family=Roboto:wght@100;400;700;900',
        'family=Poppins:wght@100;400;700;900',
        'family=Montserrat:wght@100;400;700;900',
        'family=Playfair+Display:wght@400;700;900',
      ].join('&') + '&display=swap';
    document.head.appendChild(link);
  }
}

interface Project { id: number; name: string; elements_json: string }

const CANVAS = { vertical: { w: 1080, h: 1920 }, portrait: { w: 1080, h: 1350 } };
const SCALE = 0.22;
const FPS = 30;
const MAX_HISTORY = 50;

// ISSUE F — A small typable number input that tolerates intermediate values while
// the user is typing. The input is uncontrolled (uses `defaultValue`) so partial
// digits like "1" → "10" → "100" are never clipped mid-typing. External value
// changes remount the field via `key`. Commit happens on blur or Enter.
function TypableNumberInput(props: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  className?: string;
  title?: string;
  step?: number;
}) {
  const { value, min, max, onCommit, className, title, step } = props;
  return (
    <input
      key={`num-${value}`}
      type="number"
      defaultValue={value}
      min={min}
      max={max}
      step={step || 1}
      className={className}
      title={title}
      onBlur={(e) => {
        const n = parseInt(e.target.value);
        if (Number.isNaN(n)) return;
        onCommit(Math.max(min, Math.min(max, n)));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAP ENGINE v2 (FIX I) — unified positioning/calibration engine.
//
// Priority order (first match wins on each axis):
//   1. Inter-object center alignment   (magenta  • "Aligned")
//   2. Inter-object edge alignment      (magenta  • distance in px)
//   3. Equal spacing (3+ objects)       (orange   • "=")
//   4. Canvas center H/V/perfect        (cyan     • "Centered")
//   5. Canvas edge soft-lock            (green    • "Max" + lock icon)
//
// Thresholds are expressed in *screen* pixels (converted via SCALE internally)
// so the feel is constant regardless of canvas zoom level.
// Hysteresis: ENTER threshold catches the snap; EXIT threshold is wider so
// the snap stays "sticky" until the user pulls clearly away.
// ─────────────────────────────────────────────────────────────────────────────

interface SnapRect { id: string; x: number; y: number; w: number; h: number }

type SnapGuide =
  | { kind: 'canvas-center-v' }                            // full-height cyan line at canvas.w/2
  | { kind: 'canvas-center-h' }                            // full-width  cyan line at canvas.h/2
  | { kind: 'canvas-edge'; side: 'left' | 'right' | 'top' | 'bottom' } // green + lock
  | { kind: 'obj-v'; x: number; y1: number; y2: number; label?: string } // vertical magenta between moving + other
  | { kind: 'obj-h'; y: number; x1: number; x2: number; label?: string } // horizontal magenta
  | { kind: 'equal-v'; xs: number[]; y1: number; y2: number } // orange equal-spacing
  | { kind: 'equal-h'; ys: number[]; x1: number; x2: number };

interface SnapSticky {
  axisX: { snapped: boolean; anchorMouse: number };  // anchor = mouse canvas-X at moment of snap
  axisY: { snapped: boolean; anchorMouse: number };
}

interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  snappedAxes: { x: boolean; y: boolean };
  boundaryHit: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

interface SnapOpts {
  shiftConstraint?: 'x' | 'y' | null;  // when Shift held: lock to original axis
  disabled?: boolean;                   // when Alt held (or snap toggle off)
  scale: number;                        // screen pixels per canvas unit
  operation?: 'drag' | 'resize';        // resize always hard-clamps (no push-past)
  // FIX M — user's dominant drag axis. When set, the OTHER axis's snap exit
  // threshold is widened ~6× so that tiny lateral drift while dragging primarily
  // along one axis doesn't break the sticky lock. This is what stops the
  // "teleport" when trying to keep X locked while moving Y.
  dominantAxis?: 'x' | 'y' | null;
}

// Snap thresholds (in SCREEN px, divided by scale at runtime)
// FIX J — "light wall" feel (not magnetic). Small catch zone, minimal hysteresis
// so the user can easily land at perfect center AND move slightly off-center
// without fighting a sticky pull. Soft-lock edge keeps modest push-past distance
// so the gesture still feels deliberate at canvas borders.
const SNAP_PX = {
  enterAlign: 3,     // inter-object ENTER (tight catch)
  exitAlign: 5,      // inter-object EXIT (minimal hysteresis)
  enterCanvas: 3,    // canvas-center ENTER (tight catch — easy perfect-center)
  exitCanvas: 5,     // canvas-center EXIT (no magnetic pull)
  enterEdge: 4,      // canvas-edge ENTER (light wall)
  exitEdge: 12,      // canvas-edge EXIT (still a clear push-past gesture)
  enterEqual: 3,     // equal-spacing ENTER
};

function computeSnap(
  moving: SnapRect,
  others: SnapRect[],
  canvas: { w: number; h: number },
  sticky: SnapSticky,
  mouseCanvasX: number,
  mouseCanvasY: number,
  opts: SnapOpts,
): SnapResult {
  const { scale } = opts;
  const enterA = SNAP_PX.enterAlign / scale;
  const exitA  = SNAP_PX.exitAlign  / scale;
  const enterC = SNAP_PX.enterCanvas / scale;
  const exitC  = SNAP_PX.exitCanvas  / scale;
  const enterE = SNAP_PX.enterEdge / scale;
  const exitE  = SNAP_PX.exitEdge  / scale;
  const enterEq = SNAP_PX.enterEqual / scale;

  let x = moving.x;
  let y = moving.y;
  const { w, h, id } = moving;

  // Shift-constraint: freeze one axis at its original position
  if (opts.shiftConstraint === 'x') y = moving.y;
  if (opts.shiftConstraint === 'y') x = moving.x;

  const guides: SnapGuide[] = [];
  const boundary = { left: false, right: false, top: false, bottom: false };

  if (opts.disabled) {
    return { x, y, guides, snappedAxes: { x: false, y: false }, boundaryHit: boundary };
  }

  let snappedX = false;
  let snappedY = false;

  // ── Step 1: inter-object alignment ────────────────────────────────────────
  // For each axis, find the closest other-object snap candidate (center-to-center
  // or edge-to-edge). The best candidate wins.
  let bestX: { target: number; guide: SnapGuide | null; delta: number } = { target: x, guide: null, delta: Infinity };
  let bestY: { target: number; guide: SnapGuide | null; delta: number } = { target: y, guide: null, delta: Infinity };

  const cxM = x + w / 2;
  const cyM = y + h / 2;

  // Hysteresis gate: once snapped on an axis, use the wider EXIT threshold on
  // the MOUSE position (not the element position) before un-snapping.
  // FIX M — when the user is dragging primarily along the opposite axis, widen
  // the exit threshold so tiny lateral drift doesn't break the sticky lock.
  // The user experience is "I locked X, now I want to slide up/down while
  // keeping X centered" — the mouse will wobble a few px horizontally, and we
  // shouldn't punish that.
  const widen = 6;
  const exitAX = opts.dominantAxis === 'y' ? exitA * widen : exitA;
  const exitAY = opts.dominantAxis === 'x' ? exitA * widen : exitA;
  const axisXStillSticky = sticky.axisX.snapped && Math.abs(mouseCanvasX - sticky.axisX.anchorMouse) < exitAX;
  const axisYStillSticky = sticky.axisY.snapped && Math.abs(mouseCanvasY - sticky.axisY.anchorMouse) < exitAY;

  for (const o of others) {
    if (o.id === id) continue;
    const cxO = o.x + o.w / 2;
    const cyO = o.y + o.h / 2;

    // Vertical guides (aligns X positions)
    const candidatesX: { target: number; distance: number; refY1: number; refY2: number; note?: string }[] = [
      { target: cxO - w / 2,          distance: Math.abs(cxM - cxO),              refY1: Math.min(y, o.y), refY2: Math.max(y + h, o.y + o.h), note: 'center' },
      { target: o.x,                   distance: Math.abs(x - o.x),                 refY1: Math.min(y, o.y), refY2: Math.max(y + h, o.y + o.h), note: 'L=L' },
      { target: o.x + o.w - w,         distance: Math.abs((x + w) - (o.x + o.w)),   refY1: Math.min(y, o.y), refY2: Math.max(y + h, o.y + o.h), note: 'R=R' },
      { target: o.x + o.w,             distance: Math.abs(x - (o.x + o.w)),         refY1: Math.min(y, o.y), refY2: Math.max(y + h, o.y + o.h), note: 'L=R' },
      { target: o.x - w,               distance: Math.abs((x + w) - o.x),           refY1: Math.min(y, o.y), refY2: Math.max(y + h, o.y + o.h), note: 'R=L' },
    ];
    for (const c of candidatesX) {
      const tEnter = axisXStillSticky ? exitA : enterA;
      if (c.distance < tEnter && c.distance < bestX.delta) {
        const vLineX = c.note === 'center' ? cxO : (c.note === 'L=L' ? o.x : c.note === 'R=R' ? o.x + o.w : c.note === 'L=R' ? o.x + o.w : o.x);
        bestX = { target: c.target, guide: { kind: 'obj-v', x: vLineX, y1: c.refY1, y2: c.refY2 }, delta: c.distance };
      }
    }

    // Horizontal guides (aligns Y positions)
    const candidatesY: { target: number; distance: number; refX1: number; refX2: number; note?: string }[] = [
      { target: cyO - h / 2,          distance: Math.abs(cyM - cyO),              refX1: Math.min(x, o.x), refX2: Math.max(x + w, o.x + o.w), note: 'center' },
      { target: o.y,                   distance: Math.abs(y - o.y),                 refX1: Math.min(x, o.x), refX2: Math.max(x + w, o.x + o.w), note: 'T=T' },
      { target: o.y + o.h - h,         distance: Math.abs((y + h) - (o.y + o.h)),   refX1: Math.min(x, o.x), refX2: Math.max(x + w, o.x + o.w), note: 'B=B' },
      { target: o.y + o.h,             distance: Math.abs(y - (o.y + o.h)),         refX1: Math.min(x, o.x), refX2: Math.max(x + w, o.x + o.w), note: 'T=B' },
      { target: o.y - h,               distance: Math.abs((y + h) - o.y),           refX1: Math.min(x, o.x), refX2: Math.max(x + w, o.x + o.w), note: 'B=T' },
    ];
    for (const c of candidatesY) {
      const tEnter = axisYStillSticky ? exitA : enterA;
      if (c.distance < tEnter && c.distance < bestY.delta) {
        const hLineY = c.note === 'center' ? cyO : (c.note === 'T=T' ? o.y : c.note === 'B=B' ? o.y + o.h : c.note === 'T=B' ? o.y + o.h : o.y);
        bestY = { target: c.target, guide: { kind: 'obj-h', y: hLineY, x1: c.refX1, x2: c.refX2 }, delta: c.distance };
      }
    }
  }

  if (bestX.guide) { x = bestX.target; snappedX = true; guides.push(bestX.guide); }
  if (bestY.guide) { y = bestY.target; snappedY = true; guides.push(bestY.guide); }

  // ── Step 2: equal spacing (3+ elements on same axis) ──────────────────────
  // If there are >=2 others roughly on the same Y band, check if `moving`
  // placed at gap-consistent X would make gaps equal.
  if (others.length >= 2) {
    // Horizontal equal-spacing: find pairs of others at similar Y, compute required X
    const neighborsForRow = others.filter((o) => Math.abs((o.y + o.h / 2) - cyM) < Math.max(o.h, h) * 0.5);
    if (neighborsForRow.length >= 2 && !snappedX) {
      // Sort by x, check if moving fits with equal gap
      const sorted = [...neighborsForRow].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const gap = b.x - (a.x + a.w);
        if (gap <= 0) continue;
        // Would `moving` fit as B with same gap to A? i.e. x = a.x + a.w + gap
        const targetX = a.x + a.w + gap;
        if (Math.abs(x - targetX) < enterEq && Math.abs(x - targetX) < bestX.delta) {
          x = targetX; snappedX = true;
          guides.push({ kind: 'equal-v', xs: [a.x + a.w, targetX], y1: Math.min(y, a.y, b.y), y2: Math.max(y + h, a.y + a.h, b.y + b.h) });
          break;
        }
      }
    }
  }

  // ── Step 3: canvas center ─────────────────────────────────────────────────
  const midX = canvas.w / 2;
  const midY = canvas.h / 2;
  // FIX M — same widening for canvas-center sticky when dragging the other axis.
  const exitCX = opts.dominantAxis === 'y' ? exitC * widen : exitC;
  const exitCY = opts.dominantAxis === 'x' ? exitC * widen : exitC;
  if (!snappedX) {
    const newCx = x + w / 2;
    const dist = Math.abs(newCx - midX);
    const t = axisXStillSticky ? exitCX : enterC;
    if (dist < t) {
      x = midX - w / 2; snappedX = true;
      guides.push({ kind: 'canvas-center-v' });
    }
  }
  if (!snappedY) {
    const newCy = y + h / 2;
    const dist = Math.abs(newCy - midY);
    const t = axisYStillSticky ? exitCY : enterC;
    if (dist < t) {
      y = midY - h / 2; snappedY = true;
      guides.push({ kind: 'canvas-center-h' });
    }
  }

  // ── Step 4: canvas edges (soft-lock for drag, hard-clamp for resize) ──────
  // DRAG: entering ENTER zone locks to edge. To release, user must push the
  //   proposed position EXIT distance past the edge (push-past gesture).
  // RESIZE: always clamp, never push-past — resizing past canvas makes no sense.
  const isResize = opts.operation === 'resize';
  const pushPastL = !isResize && x < -exitE;
  const pushPastR = !isResize && x + w > canvas.w + exitE;
  const pushPastT = !isResize && y < -exitE;
  const pushPastB = !isResize && y + h > canvas.h + exitE;

  if (x <= enterE && !pushPastL) {
    x = 0;
    boundary.left = true;
    guides.push({ kind: 'canvas-edge', side: 'left' });
  }
  if (x + w >= canvas.w - enterE && !pushPastR) {
    x = canvas.w - w;
    boundary.right = true;
    guides.push({ kind: 'canvas-edge', side: 'right' });
  }
  if (y <= enterE && !pushPastT) {
    y = 0;
    boundary.top = true;
    guides.push({ kind: 'canvas-edge', side: 'top' });
  }
  if (y + h >= canvas.h - enterE && !pushPastB) {
    y = canvas.h - h;
    boundary.bottom = true;
    guides.push({ kind: 'canvas-edge', side: 'bottom' });
  }

  return { x, y, guides, snappedAxes: { x: snappedX, y: snappedY }, boundaryHit: boundary };
}

// SnapGuides renderer — turns the guides array into CapCut-style overlays.
// Scale converts canvas units → screen pixels.
function SnapGuides({ guides, canvas, scale }: { guides: SnapGuide[]; canvas: { w: number; h: number }; scale: number }) {
  if (guides.length === 0) return null;
  return (
    <>
      {guides.map((g, i) => {
        switch (g.kind) {
          case 'canvas-center-v':
            return (
              <div key={i} className="pointer-events-none absolute top-0 bottom-0 z-[55]" style={{ left: (canvas.w / 2) * scale - 0.5, width: 1 }}>
                <div className="h-full border-l border-dashed" style={{ borderColor: '#06b6d4' }} />
                <div className="absolute left-1 top-1 bg-cyan-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow">Centered</div>
              </div>
            );
          case 'canvas-center-h':
            return (
              <div key={i} className="pointer-events-none absolute left-0 right-0 z-[55]" style={{ top: (canvas.h / 2) * scale - 0.5, height: 1 }}>
                <div className="w-full border-t border-dashed" style={{ borderColor: '#06b6d4' }} />
                <div className="absolute top-1 left-1 bg-cyan-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow">Centered</div>
              </div>
            );
          case 'canvas-edge': {
            const { side } = g;
            const lineStyle: React.CSSProperties = { background: '#10b981', zIndex: 55 };
            if (side === 'left')   return <div key={i} className="pointer-events-none absolute top-0 bottom-0 left-0 w-[2px] z-[55] animate-pulse" style={lineStyle} />;
            if (side === 'right')  return <div key={i} className="pointer-events-none absolute top-0 bottom-0 right-0 w-[2px] z-[55] animate-pulse" style={lineStyle} />;
            if (side === 'top')    return <div key={i} className="pointer-events-none absolute left-0 right-0 top-0 h-[2px] z-[55] animate-pulse" style={lineStyle} />;
            return                 <div key={i} className="pointer-events-none absolute left-0 right-0 bottom-0 h-[2px] z-[55] animate-pulse" style={lineStyle} />;
          }
          case 'obj-v': {
            const top = Math.min(g.y1, g.y2) * scale;
            const bottom = Math.max(g.y1, g.y2) * scale;
            return (
              <div key={i} className="pointer-events-none absolute z-[56]" style={{ left: g.x * scale - 0.5, top, width: 1, height: bottom - top }}>
                <div className="h-full border-l border-dashed" style={{ borderColor: '#ec4899' }} />
              </div>
            );
          }
          case 'obj-h': {
            const left = Math.min(g.x1, g.x2) * scale;
            const right = Math.max(g.x1, g.x2) * scale;
            return (
              <div key={i} className="pointer-events-none absolute z-[56]" style={{ top: g.y * scale - 0.5, left, height: 1, width: right - left }}>
                <div className="w-full border-t border-dashed" style={{ borderColor: '#ec4899' }} />
              </div>
            );
          }
          case 'equal-v': {
            const top = Math.min(g.y1, g.y2) * scale;
            const bottom = Math.max(g.y1, g.y2) * scale;
            return (
              <div key={i} className="pointer-events-none absolute z-[55]" style={{ left: 0, top, width: '100%', height: bottom - top }}>
                {g.xs.map((xp, j) => (
                  <div key={j} className="absolute top-0 bottom-0 border-l border-dashed" style={{ left: xp * scale, borderColor: '#f97316' }} />
                ))}
                <div className="absolute top-1 bg-orange-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow" style={{ left: ((g.xs[0] + g.xs[g.xs.length - 1]) / 2) * scale }}>=</div>
              </div>
            );
          }
          case 'equal-h': {
            const left = Math.min(g.x1, g.x2) * scale;
            const right = Math.max(g.x1, g.x2) * scale;
            return (
              <div key={i} className="pointer-events-none absolute z-[55]" style={{ top: 0, left, height: '100%', width: right - left }}>
                {g.ys.map((yp, j) => (
                  <div key={j} className="absolute left-0 right-0 border-t border-dashed" style={{ top: yp * scale, borderColor: '#f97316' }} />
                ))}
              </div>
            );
          }
        }
      })}
    </>
  );
}

// Corner label for soft-locked edges (shown when the element is at a canvas border)
function BoundaryLabels({ boundary }: { boundary: { left: boolean; right: boolean; top: boolean; bottom: boolean } | null }) {
  if (!boundary) return null;
  return (
    <>
      {boundary.left && <div className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 bg-emerald-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow z-[57] flex items-center gap-0.5"><Lock className="h-2 w-2" />Max</div>}
      {boundary.right && <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 bg-emerald-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow z-[57] flex items-center gap-0.5"><Lock className="h-2 w-2" />Max</div>}
      {boundary.top && <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 bg-emerald-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow z-[57] flex items-center gap-0.5"><Lock className="h-2 w-2" />Max</div>}
      {boundary.bottom && <div className="pointer-events-none absolute left-1/2 bottom-1 -translate-x-1/2 bg-emerald-500 text-white text-[8px] font-semibold px-1 py-0.5 rounded shadow z-[57] flex items-center gap-0.5"><Lock className="h-2 w-2" />Max</div>}
    </>
  );
}

function parseEls(p: Project): EditorElement[] { try { return JSON.parse(p.elements_json || '[]'); } catch { return []; } }

// Batch 5 — Menu row for the "Sounds" dropdown. Separates the filename from
// an inline play/pause button so clicking the preview doesn't insert the
// sound by accident (and vice versa). Kept at module level so it doesn't
// recreate on every EditorPanel render.
function SoundLibraryMenuItem(props: {
  sound: SoundItem;
  isPlaying: boolean;
  onInsert: () => void;
  onTogglePreview: (e: React.MouseEvent) => void;
}) {
  const { sound, isPlaying, onInsert, onTogglePreview } = props;
  return (
    <DropdownMenuItem
      onSelect={onInsert}
      className="flex items-center gap-2 text-xs"
    >
      <button
        type="button"
        onClick={onTogglePreview}
        className="shrink-0 rounded border h-6 w-6 flex items-center justify-center hover:bg-muted"
        title={isPlaying ? 'Pause preview' : 'Play preview'}
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate">{sound.name}</div>
        {sound.duration_seconds != null && sound.duration_seconds > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {fmtSoundDuration(sound.duration_seconds)}
          </div>
        )}
      </div>
    </DropdownMenuItem>
  );
}

function fmtSoundDuration(sec: number): string {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// ── Resize handle styles (Ergo #1) ──
function handleStyle(pos: 'tl' | 'tr' | 'bl' | 'br'): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 12,
    height: 12,
    background: '#fff',
    border: '2px solid #3b82f6',
    borderRadius: 2,
    zIndex: 50,
  };
  const offsets: Record<typeof pos, React.CSSProperties> = {
    tl: { top: -6, left: -6 },
    tr: { top: -6, right: -6 },
    bl: { bottom: -6, left: -6 },
    br: { bottom: -6, right: -6 },
  };
  return { ...base, ...offsets[pos] };
}
function edgeHandleStyle(pos: 't' | 'r' | 'b' | 'l'): React.CSSProperties {
  const base: React.CSSProperties = { background: 'transparent' };
  if (pos === 't' || pos === 'b') return { ...base, height: 6, left: 12, right: 12 };
  return { ...base, width: 6, top: 12, bottom: 12 };
}

// ── History hook ──
// FIX K — push() must never close over stale `idx`. An async callback (e.g. an
// R2 upload .then) captured `push` from an earlier render and, on resolution,
// would truncate stack.slice(0, oldIdx + 1), silently wiping history entries
// that were pushed synchronously in the meantime. We use an idxRef that's
// always current so `push` is a single stable function and always reads the
// latest branch pointer.
function useHistory(initial: EditorElement[]) {
  const [stack, setStack] = useState<EditorElement[][]>([initial]);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const current = stack[idx] || [];

  const push = useCallback((els: EditorElement[]) => {
    setStack((s) => {
      const newStack = [...s.slice(0, idxRef.current + 1), els].slice(-MAX_HISTORY);
      setIdx(newStack.length - 1);
      return newStack;
    });
  }, []);

  const undo = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);
  const redo = useCallback(() => setIdx((i) => Math.min(stack.length - 1, i + 1)), [stack.length]);
  const canUndo = idx > 0;
  const canRedo = idx < stack.length - 1;

  const reset = useCallback((els: EditorElement[]) => { setStack([els]); setIdx(0); }, []);

  return { elements: current, push, undo, redo, canUndo, canRedo, reset };
}

export function EditorPanel({ productId, onExport }: EditorPanelProps) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const history = useHistory([]);
  const elements = history.elements;
  // FIX K — "appears then disappears" root cause.
  // commit* functions (below) compute `history.push(elements.map(...))` using the
  // `elements` captured at the render where they were created. When an async
  // callback (e.g. uploadMediaToR2().then(() => commitUpdate(id, {src})) fires
  // AFTER a sibling commitAdd has inserted a new element, the stale `elements`
  // no longer contains the new element, so `elements.map(...)` drops it and
  // `history.push()` wipes the new clip from state. Reading from a ref that's
  // always kept in sync fixes this without touching every call site.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>('vertical');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [snapEnabled, setSnapEnabled] = useState(true);
  // FIX I — snap engine v2 state
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const [activeBoundary, setActiveBoundary] = useState<{ left: boolean; right: boolean; top: boolean; bottom: boolean } | null>(null);
  const snapStickyRef = useRef<SnapSticky>({
    axisX: { snapped: false, anchorMouse: 0 },
    axisY: { snapped: false, anchorMouse: 0 },
  });
  // Controlled drag position — lets computeSnap visually lock the element at the snap target
  const [dragLock, setDragLock] = useState<{ id: string; x: number; y: number } | null>(null);
  // FIX O — Live layout during drag/resize: Properties panel reads from this so X/Y/W/H update in real-time.
  // Cleared on drag/resize stop; then the Properties panel falls back to the committed element state.
  const [liveLayout, setLiveLayout] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  // FIX O — Live size during resize: Rnd's size prop is driven by this so the element visibly grows/shrinks
  // around its center (instead of snapping back to committed size at each tick).
  const [liveSize, setLiveSize] = useState<{ id: string; width: number; height: number } | null>(null);
  // FIX O — remembered center at resize start, so resize is center-anchored (X/Y don't change during resize).
  const resizeCenterRef = useRef<{ cx: number; cy: number } | null>(null);
  // Live keyboard modifiers for the snap engine (Alt = disable, Shift = axis constraint)
  const altHeldRef = useRef(false);
  const shiftHeldRef = useRef(false);
  // Remember starting position of the drag so Shift can constrain to original axis
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [trimTooltip, setTrimTooltip] = useState<{ x: number; start: number; end: number; dur: number } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // ISSUE N + AA — Fullscreen preview. Originally used the HTML5 Fullscreen
  // API (document.requestFullscreen) but that gave the user no playback
  // controls — they couldn't scrub to second 3 or see the duration. We now
  // render a CSS modal overlay (inset-0 z-50) that contains the canvas AND
  // a control bar with play/pause + scrubber + time display. The Esc key
  // closes it, mirroring the native fullscreen UX.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    // Prevent body scroll behind the modal.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  // ISSUE R — Send to Preview composes the FINAL edited video for both output
  // formats (9:16 + 4:5) using a canvas compositor + MediaRecorder. The blob
  // URLs are then handed to the Preview panel which displays them instead of
  // individual raw clips. `composeStep` drives a progress dialog so the user
  // sees what's happening while the recorder runs in real time.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeStep, setComposeStep] = useState<{
    phase: 'idle' | 'vertical' | 'portrait' | 'done' | 'error';
    progress: number;
    error?: string;
  }>({ phase: 'idle', progress: 0 });
  const [composedOutputs, setComposedOutputs] = useState<{
    vertical?: { url: string; blob: Blob };
    portrait?: { url: string; blob: Blob };
  }>({});
  // FEATURE T — Timeline zoom (CapCut/Premiere style). 1.0 = 30 px/sec baseline. Range 0.1 (very zoomed-out) to 10 (very zoomed-in).
  // Wheel-zoom with Ctrl/Cmd; +/- buttons above timeline also available.
  // ISSUE 1 — When zoomMode === 'auto', timelineZoom is ignored and the zoom factor is
  // computed from the timeline container width so the furthest clip fits. Any manual
  // zoom (+ / − / wheel) flips zoomMode to 'manual'. The "Fit" button resets to auto.
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<'auto' | 'manual'>('auto');
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const [timelineContainerWidth, setTimelineContainerWidth] = useState(0);
  // FEATURE X — Layer drag-and-drop state. dragId = the clip being dragged in
  // layer mode (null when not in layer drag). ISSUE H replaced the old per-clip
  // dropTargetId with a per-TRACK target (see mergeDropLayer below) so multi-clip
  // rows can be the target of a layer drag.
  const [layerDragId, setLayerDragId] = useState<string | null>(null);
  // ISSUE K — Track the clip being time-dragged so we can disable CSS transitions
  // on IT (for 1:1 cursor tracking) while keeping the smooth transition on every
  // other clip (for a fluid feel when undo/redo/paste/trim moves them around).
  const [timeDragId, setTimeDragId] = useState<string | null>(null);
  // ISSUE D — Richer DnD state: track which side of the hovered row (above/below) the
  // insertion will land on, so we can show a solid insertion line between rows instead
  // of a subtle ring around the hovered row.
  const [layerDropSide, setLayerDropSide] = useState<'above' | 'below' | 'merge' | null>(null);
  // ISSUE D — Ghost preview that follows the cursor during layer drag.
  // `landingStart` (ISSUE J) is the resolved startTime where the clip will
  // actually land after overlap-snapping — shown as a translucent placeholder
  // in the target row so the user can see the auto-snap behavior instead of
  // guessing. The old red ✕ "collision" signal was confusingly mistaken for
  // "delete", so we now always use blue/neutral colors and let the preview
  // rectangle communicate the snap-forward.
  const [layerDragGhost, setLayerDragGhost] = useState<{
    x: number;
    y: number;
    label: string;
    landingStart?: number;
    landingDuration?: number;
    snappedForward?: boolean;
  } | null>(null);
  // ISSUE H — When the drag target is "merge onto this track row", we highlight the
  // row by its layer value (since multiple clips can share a layer/row now).
  const [mergeDropLayer, setMergeDropLayer] = useState<number | null>(null);
  // ISSUE K — Snap state now includes a label so the magnetic guide line can
  // tell the user WHAT it's snapping to (Playhead, 0s, Clip start/end…).
  const [timelineSnap, setTimelineSnap] = useState<{ time: number; color: string; label: string } | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  const playRafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallTime: number; startOffset: number } | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSaveRef = useRef(true);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<number | null>(null);
  // Ergo #11 — element deletion also goes through the Dialog (no more window.confirm-less surprise)
  const [deleteElementId, setDeleteElementId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // FIX G — multi-select on the timeline (Shift+click to add)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Batch 4 (revised) — Headlines are now the product's **selected headlines**
  // coming from the copywriting tool (ad_headlines where is_selected = 1), not
  // the global FB presets. Re-fetched whenever productId changes.
  const [selectedHeadlines, setSelectedHeadlines] = useState<AdHeadline[]>([]);
  useEffect(() => {
    if (!productId) { setSelectedHeadlines([]); return; }
    listHeadlines(productId)
      .then((items) => setSelectedHeadlines((items || []).filter((h) => h.is_selected === 1)))
      .catch(() => setSelectedHeadlines([]));
  }, [productId]);

  // Batch 5 — Admin-curated sound library, shown as a dropdown grouped by
  // category. Also global and fetched once on mount. The preview player (small
  // ▶ next to each item) uses a single shared <audio> so starting one sound
  // stops the previous one.
  const [soundCategories, setSoundCategories] = useState<SoundCategory[]>([]);
  const [librarySounds, setLibrarySounds] = useState<SoundItem[]>([]);
  useEffect(() => {
    listSoundsForAds()
      .then((res) => {
        setSoundCategories(res.categories || []);
        setLibrarySounds(res.sounds || []);
      })
      .catch(() => {
        setSoundCategories([]);
        setLibrarySounds([]);
      });
  }, []);
  const soundPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [previewingSoundId, setPreviewingSoundId] = useState<number | null>(null);
  function toggleSoundPreview(s: SoundItem, e: React.MouseEvent) {
    // Don't close the dropdown — the preview button lives inside a menu item.
    e.preventDefault();
    e.stopPropagation();
    const a = soundPreviewRef.current ?? new Audio();
    if (!soundPreviewRef.current) soundPreviewRef.current = a;
    if (previewingSoundId === s.id) {
      a.pause();
      setPreviewingSoundId(null);
      return;
    }
    a.pause();
    a.src = s.r2_url;
    a.onended = () => setPreviewingSoundId(null);
    a.play().then(() => setPreviewingSoundId(s.id)).catch(() => setPreviewingSoundId(null));
  }
  // Group sounds by category in render order so "Uncategorized" lands last.
  const soundsByCategory = useMemo(() => {
    const map = new Map<number | null, SoundItem[]>();
    for (const s of librarySounds) {
      const key = s.category_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [librarySounds]);
  // ISSUE E — Clipboard state for Cmd+C / Cmd+V. Stores deep-copied element data
  // (without the id) so paste can create a fresh element at `currentTime`.
  const clipboardRef = useRef<EditorElement[] | null>(null);

  const canvas = CANVAS[format];
  const sW = canvas.w * SCALE;
  const sH = canvas.h * SCALE;
  const contentDuration = useMemo(() => elements.length === 0 ? 0 : Math.max(...elements.map((e) => e.startTime + e.duration)), [elements]);
  // FIX D — timelineDuration (visual) vs playbackDuration (real end)
  //   • timeline viewport shows at least 30s of space for placing clips
  //   • playback stops at contentDuration (last clip's end)
  const timelineDuration = Math.max(30, contentDuration + 5);
  const playbackDuration = contentDuration;
  const visibleElements = elements.filter((e) => e.type !== 'audio' && currentTime >= e.startTime && currentTime < e.startTime + e.duration);
  const selected = elements.find((e) => e.id === selectedId);

  // ISSUE 1 — Auto-fit zoom: compute the zoom factor that makes the furthest clip's end
  // land at the right edge of the timeline container. 30 px/sec is the 1.0 baseline.
  // The timeline container has pl-10 (40 px) left padding + we leave 16 px breathing room
  // on the right so the last clip isn't flush against the scrollbar.
  const autoZoom = useMemo(() => {
    if (timelineContainerWidth <= 0 || timelineDuration <= 0) return 1;
    const leftPadding = 40; // matches pl-10 on the scroll container
    const rightBreath = 16;
    const available = timelineContainerWidth - leftPadding - rightBreath;
    if (available <= 0) return 0.1;
    const z = available / (timelineDuration * 30);
    return Math.max(0.1, Math.min(10, z));
  }, [timelineContainerWidth, timelineDuration]);
  const effectiveZoom = zoomMode === 'auto' ? autoZoom : timelineZoom;

  // ── Load projects ──
  useEffect(() => { loadProjects(); }, [productId]);

  async function loadProjects() {
    setLoading(true);
    try {
      const res: any = await apiClient.get(`/editor/projects?product_id=${productId}`);
      const list: Project[] = Array.isArray(res) ? res : res?.items || [];
      setProjects(list);
      if (list.length > 0) { switchProject(list[0]); }
    } catch {} finally { setLoading(false); }
  }

  function switchProject(proj: Project) {
    skipSaveRef.current = true;
    setActiveId(proj.id);
    history.reset(parseEls(proj));
    setSelectedId(null);
    setSelectedIds(new Set());
    setCurrentTime(0);
    // Bug #10 FIX — pause + clear audio refs when switching projects.
    audioRefs.current.forEach((audio) => {
      try { audio.pause(); audio.src = ''; } catch {}
    });
    audioRefs.current.clear();
    setPlaying(false);
  }

  // ISSUE AA — Factored out of the Play button onClick so the fullscreen
  // popup can reuse the exact same audio-priming + toggle logic. The
  // autoplay-unlock trick only works inside a user-gesture call stack, so
  // this must be called synchronously from a click / keydown handler.
  const togglePlay = useCallback(() => {
    const willPlay = !playing;
    if (willPlay) {
      const latest = elementsRef.current;
      for (const el of latest) {
        if (el.type !== 'audio' || !el.src) continue;
        let audio = audioRefs.current.get(el.id);
        if (!audio) {
          audio = new Audio();
          audio.preload = 'auto';
          audio.src = el.src;
          (audio as any)._intendedSrc = el.src;
          audioRefs.current.set(el.id, audio);
        }
        audio.volume = (el.volume || 100) / 100;
        const inRange = currentTime >= el.startTime && currentTime < el.startTime + el.duration;
        if (inRange) {
          // FIX — source-offset aware seek. target is the position inside the
          // source file; it's the timeline offset (currentTime - startTime)
          // shifted by sourceOffset so a left-trim properly skips silence.
          const target = (currentTime - el.startTime) + (el.sourceOffset || 0);
          if (Math.abs(audio.currentTime - target) > 0.1) audio.currentTime = target;
          const p = audio.play();
          if (p && typeof p.catch === 'function') {
            p.catch((err) => console.warn('[audio] play() rejected', el.id, err?.name, err?.message || err));
          }
        } else {
          // Muted prime + pause so future programmatic play() is allowed.
          const originalVolume = audio.volume;
          audio.muted = true;
          const p = audio.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              if (audio) {
                audio.pause();
                audio.currentTime = 0;
                audio.muted = false;
                audio.volume = originalVolume;
              }
            }).catch(() => {
              if (audio) { audio.muted = false; audio.volume = originalVolume; }
            });
          }
        }
      }
    } else {
      audioRefs.current.forEach((a) => { try { a.pause(); } catch {} });
    }
    setPlaying(willPlay);
  }, [playing, currentTime]);

  // ── Playback via requestAnimationFrame (Bug #11 FIX) ──
  // setInterval is throttled to 1Hz in inactive tabs; rAF + performance.now
  // computes real elapsed time and stays in sync with audio/video.
  useEffect(() => {
    if (!playing) {
      audioRefs.current.forEach((a) => a.pause());
      playStartRef.current = null;
      if (playRafRef.current !== null) {
        cancelAnimationFrame(playRafRef.current);
        playRafRef.current = null;
      }
      return;
    }
    playStartRef.current = { wallTime: performance.now(), startOffset: currentTime };
    const tick = () => {
      const anchor = playStartRef.current;
      if (!anchor) return;
      const elapsed = (performance.now() - anchor.wallTime) / 1000;
      const t = anchor.startOffset + elapsed;
      if (contentDuration > 0 && t >= contentDuration) {
        setPlaying(false);
        setCurrentTime(0);
        return;
      }
      setCurrentTime(t);
      playRafRef.current = requestAnimationFrame(tick);
    };
    playRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (playRafRef.current !== null) cancelAnimationFrame(playRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, contentDuration]);

  // Sync audio elements — FIX I (audio playback rebuild)
  //   • Removed crossOrigin='anonymous': forced CORS-mode fetch that silently fails on blob URLs and on R2
  //     URLs that don't return Access-Control-Allow-Origin headers. Simple playback doesn't need CORS.
  //   • preload='auto' so the audio buffer is ready by the time the user hits Play.
  //   • Instrumentation: logs every state transition so we can trace "why didn't it play" in DevTools.
  //   • Also re-creates the Audio element when el.src changes (blob → R2 swap after upload).
  useEffect(() => {
    const audioEls = elements.filter((e) => e.type === 'audio' && e.src);
    for (const el of audioEls) {
      let audio = audioRefs.current.get(el.id);
      // If src changed (e.g. blob URL swapped for R2 URL after upload), rebuild the Audio.
      // BUG FIX: the browser resolves `audio.src` to an absolute URL (e.g. `http://host/api/...`)
      // the moment it's assigned, but `el.src` stays as the value we gave it (often a relative
      // `/api/...` path). A naïve `audio.src !== el.src` check was always TRUE after the first
      // render → the Audio element got torn down every render, never reaching `canplay`. We
      // track the "intended" src in a custom property and compare that instead.
      const intended = (audio as any)?._intendedSrc;
      if (audio && intended !== el.src) {
        try { audio.pause(); audio.src = ''; } catch {}
        audio = undefined;
      }
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        audio.src = el.src!;
        (audio as any)._intendedSrc = el.src;
        audio.addEventListener('error', (e) => {
          console.warn('[audio] load error', el.id, audio?.error?.message || audio?.error?.code, e);
        });
        audio.addEventListener('stalled', () => console.info('[audio] stalled', el.id));
        audio.addEventListener('canplay', () => console.info('[audio] canplay', el.id, 'dur=', audio?.duration));
        audioRefs.current.set(el.id, audio);
        console.info('[audio] created element for', el.id, 'src=', el.src);
      }
      audio.volume = (el.volume || 100) / 100;
      const inRange = currentTime >= el.startTime && currentTime < el.startTime + el.duration;
      if (playing && inRange) {
        // FIX — source-offset aware. When left-trim is applied we must seek
        // PAST the cropped silence in the source file, not play it.
        const target = (currentTime - el.startTime) + (el.sourceOffset || 0);
        // Tight tolerance (0.1s) so a just-trimmed clip re-seats its audio
        // head on the very first playback tick after the mouseup — otherwise
        // the 0.5s threshold would let the old (pre-trim) audio.currentTime
        // ride along until it naturally drifts far enough, which looks to the
        // user like "the trim took effect on the 2nd play, not the 1st".
        if (Math.abs(audio.currentTime - target) > 0.1) audio.currentTime = target;
        if (audio.paused) {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.then === 'function') {
            playPromise.catch((err) => {
              console.warn('[audio] play() rejected for', el.id, err?.name, err?.message || err);
            });
          }
        }
      } else {
        if (!audio.paused) audio.pause();
      }
    }
    // Clean up audio instances for elements that no longer exist
    const liveIds = new Set(audioEls.map((e) => e.id));
    for (const [id, audio] of audioRefs.current) {
      if (!liveIds.has(id)) {
        try { audio.pause(); audio.src = ''; } catch {}
        audioRefs.current.delete(id);
      }
    }
  }, [currentTime, playing, elements]);

  // ── Auto-save (500ms debounce) ──
  useEffect(() => {
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    if (!activeId) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    setSaving(true);
    autoSaveRef.current = setTimeout(() => {
      apiClient.patch(`/editor/projects/${activeId}`, { elements_json: JSON.stringify(elements) })
        .then(() => { setLastSavedAt(Date.now()); })
        .catch(() => {})
        .finally(() => setSaving(false));
    }, 500);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [elements, activeId]);

  // ISSUE 1 — Observe the timeline container width so auto-fit zoom can recompute
  // whenever the panel is resized, the parent flex grid reflows, or the window resizes.
  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;
    const update = () => setTimelineContainerWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeId]);

  // ── Keyboard shortcuts (Ergo #4) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const editable = target.getAttribute('contenteditable') === 'true';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z' && e.shiftKey) { e.preventDefault(); history.redo(); }
      else if (meta && e.key === 'z') { e.preventDefault(); history.undo(); }
      else if (meta && e.key === 'd' && selectedId) { e.preventDefault(); commitDuplicate(selectedId); }
      // ISSUE E — Cmd/Ctrl+C copies the current selection (single or multi) into the
      // in-memory clipboard. Cmd/Ctrl+V pastes them as fresh elements starting at
      // `currentTime`, preserving the relative offsets between the copied clips so a
      // burst of three clips stays visually identical after paste.
      else if (meta && e.key === 'c' && (selectedIds.size > 0 || selectedId)) {
        e.preventDefault();
        const ids = selectedIds.size > 0 ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
        const snapshot = elementsRef.current
          .filter((el) => ids.includes(el.id))
          .map((el) => JSON.parse(JSON.stringify(el)) as EditorElement);
        clipboardRef.current = snapshot.length > 0 ? snapshot : null;
      }
      else if (meta && e.key === 'v' && clipboardRef.current && clipboardRef.current.length > 0) {
        e.preventDefault();
        const source = clipboardRef.current;
        const minStart = Math.min(...source.map((el) => el.startTime));
        const latest = elementsRef.current;
        const maxLayer = latest.reduce((m, el) => Math.max(m, el.layer || 0), 0);
        const stamp = Date.now();
        const clones: EditorElement[] = source.map((el, idx) => ({
          ...el,
          id: `${el.type}-${stamp}-${idx}`,
          startTime: currentTime + (el.startTime - minStart),
          layer: (maxLayer || 0) + idx + 1,
          vertical: { ...el.vertical, x: el.vertical.x + 20, y: el.vertical.y + 20 },
          portrait: { ...el.portrait, x: el.portrait.x + 20, y: el.portrait.y + 20 },
        }));
        history.push([...latest, ...clones]);
        // Select the newly-pasted elements so further shortcuts (duplicate, delete) act on them
        const newIds = clones.map((c) => c.id);
        setSelectedId(newIds[0]);
        setSelectedIds(new Set(newIds));
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); setDeleteElementId(selectedId); }
      else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'Home') { e.preventDefault(); setCurrentTime(0); }
      else if (e.key === 'ArrowLeft' && !selectedId) { e.preventDefault(); setCurrentTime((t) => Math.max(0, t - (e.shiftKey ? 1 : 1 / FPS))); }
      else if (e.key === 'ArrowRight' && !selectedId) { e.preventDefault(); setCurrentTime((t) => Math.min(playbackDuration, t + (e.shiftKey ? 1 : 1 / FPS))); }
      else if (e.key === 'ArrowLeft' && selectedId) { e.preventDefault(); nudgeSelected(e.shiftKey ? -10 : -1, 0); }
      else if (e.key === 'ArrowRight' && selectedId) { e.preventDefault(); nudgeSelected(e.shiftKey ? 10 : 1, 0); }
      else if (e.key === 'ArrowUp' && selectedId) { e.preventDefault(); nudgeSelected(0, e.shiftKey ? -10 : -1); }
      else if (e.key === 'ArrowDown' && selectedId) { e.preventDefault(); nudgeSelected(0, e.shiftKey ? 10 : 1); }
      else if (meta && e.key === 'a') { e.preventDefault(); setSelectedIds(new Set(elements.map((e2) => e2.id))); }
      // ISSUE K — CapCut-style zoom shortcuts. Cmd/Ctrl+0 → fit; Cmd/Ctrl++ → zoom in;
      // Cmd/Ctrl+- → zoom out. Applied relative to the currently-effective zoom so it
      // behaves predictably whether Fit mode or manual mode is active.
      else if (meta && e.key === '0') {
        e.preventDefault();
        setZoomMode('auto');
      }
      else if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const current = zoomMode === 'auto' ? autoZoom : timelineZoom;
        setTimelineZoom(Math.min(10, current * 1.25));
        setZoomMode('manual');
      }
      else if (meta && e.key === '-') {
        e.preventDefault();
        const current = zoomMode === 'auto' ? autoZoom : timelineZoom;
        setTimelineZoom(Math.max(0.1, current / 1.25));
        setZoomMode('manual');
      }
      else if (e.key === 'Escape') { setSelectedId(null); setSelectedIds(new Set()); }
    }
    function nudgeSelected(dx: number, dy: number) {
      if (!selectedId) return;
      const el = elements.find((x) => x.id === selectedId);
      if (!el) return;
      commitLayout(selectedId, { x: el[format].x + dx, y: el[format].y + dy });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedIds, elements, format, playbackDuration, currentTime, timelineZoom, autoZoom, zoomMode]);

  // ── Modifier-key tracking for snap engine (FIX I) ──
  // Alt  → disables all snaps while held (free positioning, Figma style)
  // Shift → constrains drag to original axis (horizontal OR vertical movement only)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') altHeldRef.current = true;
      if (e.key === 'Shift') shiftHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') altHeldRef.current = false;
      if (e.key === 'Shift') shiftHeldRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    // Safety: clear on blur so held state doesn't stick if window loses focus mid-drag
    const onBlur = () => { altHeldRef.current = false; shiftHeldRef.current = false; };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // ── ISSUE I — Auto-repair corrupted per-element base dimensions ──
  // When a user imports a clip in a different canvas size, then resizes it via
  // corner handles, the resize handler blindly writes the final pixel dimensions
  // into baseVertical / basePortrait. If the drag left the clip larger than the
  // canvas × 1.5 (possible via FIX #65 which removed resize clamping), the stored
  // base becomes invalid and the Size slider ends up stuck at 100% with the
  // "x100 multiplier" behavior the user reported. This effect scrubs on selection
  // change: for the current format's base, if it's missing or out of range, write
  // a sane replacement derived from the current size (capped to canvas extent).
  useEffect(() => {
    if (!selectedId) return;
    const latest = elementsRef.current;
    const el = latest.find((e) => e.id === selectedId);
    if (!el || el.type === 'audio') return;
    const baseKey = format === 'vertical' ? 'baseVertical' : 'basePortrait';
    const rawBase = el[baseKey];
    const canvasDims = CANVAS[format];
    const invalid = !rawBase
      || rawBase.width <= 0
      || rawBase.height <= 0
      || rawBase.width > canvasDims.w * 1.5
      || rawBase.height > canvasDims.h * 1.5;
    if (!invalid) return;
    const curW = el[format].width;
    const curH = el[format].height;
    const aspect = curW > 0 && curH > 0 ? curW / curH : canvasDims.w / canvasDims.h;
    // Fit aspect into canvas bounds so 100% on the slider ≈ "fills the canvas".
    let fixedW: number;
    let fixedH: number;
    if (aspect >= canvasDims.w / canvasDims.h) {
      fixedW = canvasDims.w;
      fixedH = canvasDims.w / aspect;
    } else {
      fixedW = canvasDims.h * aspect;
      fixedH = canvasDims.h;
    }
    commitUpdate(el.id, { [baseKey]: { width: fixedW, height: fixedH } } as Partial<EditorElement>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, format]);

  // ── Element CRUD (push to history) ──
  // FIX K — every commit* function reads `elementsRef.current` instead of the
  // closed-over `elements`, so async callbacks (R2 upload .then, timers, etc.)
  // always operate on the latest state. Without this, elements added while an
  // upload is in flight get wiped when the upload completes and its stale
  // commitUpdate overwrites state.
  function commitUpdate(id: string, updates: Partial<EditorElement>) {
    const latest = elementsRef.current;
    history.push(latest.map((e) => e.id === id ? { ...e, ...updates } : e));
  }
  function commitLayout(id: string, layout: Partial<LayoutData>) {
    const latest = elementsRef.current;
    history.push(latest.map((e) => e.id === id ? { ...e, [format]: { ...e[format], ...layout } } : e));
  }
  function commitRemove(id: string) {
    const latest = elementsRef.current;
    const el = latest.find((e) => e.id === id);
    // Bug #9 FIX — revoke blob URLs to free memory
    if (el?.src && el.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(el.src); } catch {}
    }
    // Bug #10 FIX — tear down audio instance if it existed
    if (el?.type === 'audio') {
      const audio = audioRefs.current.get(id);
      if (audio) {
        try { audio.pause(); audio.src = ''; } catch {}
        audioRefs.current.delete(id);
      }
    }
    history.push(latest.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }
  function commitDuplicate(id: string) {
    const latest = elementsRef.current;
    const el = latest.find((e) => e.id === id);
    if (!el) return;
    const maxLayer = latest.reduce((m, e) => Math.max(m, e.layer || 0), 0);
    const clone: EditorElement = {
      ...el,
      id: `${el.type}-${Date.now()}`,
      startTime: el.startTime + el.duration,
      layer: maxLayer + 1,
      vertical: { ...el.vertical, x: el.vertical.x + 20, y: el.vertical.y + 20 },
      portrait: { ...el.portrait, x: el.portrait.x + 20, y: el.portrait.y + 20 },
    };
    history.push([...latest, clone]);
    setSelectedId(clone.id);
  }
  // FIX P — move one layer up/down by SWAPPING with the immediate neighbour in the
  // timeline-as-layer ordering. Visuals only — audio is in its own track and can't
  // stack above visual content. Layers get re-normalized to a clean 0..N-1 sequence
  // after each swap so the ordering stays stable as users shuffle things around.
  function normalizedLayers(visuals: EditorElement[]): Map<string, number> {
    // Highest layer index == front. We pass visuals already sorted desc by layer.
    const m = new Map<string, number>();
    visuals.forEach((v, i) => m.set(v.id, visuals.length - 1 - i));
    return m;
  }
  function moveLayerUp(id: string) {
    // ISSUE H — Layer-aware move: multiple clips can now share a layer (track row),
    // so this moves the clip up to the NEXT distinct layer value instead of just
    // swapping with a neighbour in a flattened list. Uses resolveOverlap so the
    // destination row's existing clips don't end up stacked on top of each other.
    const latest = elementsRef.current;
    const target = latest.find((e) => e.id === id);
    if (!target || target.type === 'audio') return;
    const layers = Array.from(new Set(latest.filter((e) => e.type !== 'audio').map((e) => e.layer || 0)))
      .sort((a, b) => b - a); // DESC, top = front
    const curIdx = layers.indexOf(target.layer || 0);
    if (curIdx <= 0) return; // already on the frontmost layer
    const upLayer = layers[curIdx - 1];
    moveClipToLayer(id, upLayer, target.startTime);
  }
  function moveLayerDown(id: string) {
    const latest = elementsRef.current;
    const target = latest.find((e) => e.id === id);
    if (!target || target.type === 'audio') return;
    const layers = Array.from(new Set(latest.filter((e) => e.type !== 'audio').map((e) => e.layer || 0)))
      .sort((a, b) => b - a);
    const curIdx = layers.indexOf(target.layer || 0);
    if (curIdx === -1 || curIdx >= layers.length - 1) return; // already backmost
    const downLayer = layers[curIdx + 1];
    moveClipToLayer(id, downLayer, target.startTime);
  }
  // ISSUE H — Find the nearest non-overlapping startTime for a clip of `duration`
  // that wants to land at `requestedStart` on `targetLayer`. If the slot is free,
  // return requestedStart. If the requested window overlaps an existing clip on
  // that layer, shift forward to the end of the last overlapping clip. Audio is
  // ignored — it lives on its own track.
  function resolveOverlap(
    srcId: string,
    targetLayer: number,
    requestedStart: number,
    duration: number,
  ): number {
    const others = elementsRef.current
      .filter((e) => e.id !== srcId && e.type !== 'audio' && (e.layer || 0) === targetLayer)
      .sort((a, b) => a.startTime - b.startTime);
    let start = Math.max(0, requestedStart);
    const end = () => start + duration;
    // Shift forward past any clip whose range overlaps [start, start+duration].
    // We loop because shifting may expose new overlaps.
    let guard = 0;
    while (guard++ < 50) {
      const collider = others.find((e) => e.startTime < end() && e.startTime + e.duration > start);
      if (!collider) break;
      start = collider.startTime + collider.duration;
    }
    return start;
  }

  // BATCH 6 fix — Same-row no-overlap clamp for horizontal drag.
  //
  // resolveOverlap() shifts forward unconditionally; that's fine when the user
  // is depositing a clip onto a row from another row (they want continuation).
  // But for pure time-drag inside the SAME row the user expects CapCut-style
  // blocking — the clip should wedge up against the nearest neighbour on
  // whichever side they're approaching from, not teleport past it.
  //
  // Strategy: detect every collider on `layer` (minus `excludeIds`) and, for
  // each overlap, snap `start` to whichever side (left-of / right-of the
  // collider) is closer to `requested`. Loop in case the chosen side exposes
  // a new overlap. Returns the clamped start; the caller is free to also run
  // snapTime on the result, but overlap wins over snap when both apply.
  function clampStartInLayer(
    layer: number,
    requested: number,
    duration: number,
    excludeIds: Set<string>,
  ): number {
    const others = elementsRef.current.filter(
      (e) => !excludeIds.has(e.id) && e.type !== 'audio' && (e.layer || 0) === layer,
    );
    let start = Math.max(0, requested);
    let guard = 0;
    while (guard++ < 50) {
      const collider = others.find(
        (o) => start < o.startTime + o.duration && start + duration > o.startTime,
      );
      if (!collider) break;
      const leftSlot = Math.max(0, collider.startTime - duration);
      const rightSlot = collider.startTime + collider.duration;
      // Bias to the direction the user was heading (closer to `requested`),
      // but if both sides are equally valid fall back to the right slot
      // (continuation, matching the old resolveOverlap behavior).
      const dLeft = Math.abs(leftSlot - requested);
      const dRight = Math.abs(rightSlot - requested);
      start = dLeft < dRight ? leftSlot : rightSlot;
    }
    return start;
  }

  // ISSUE H — Move a clip to live on `targetLayer` at `requestedStart`. Auto-snaps
  // time forward if the drop would overlap another clip on the target row. This is
  // the core primitive that lets the user put "Video 2 in continuité of Video 1"
  // on the same row via drag-and-drop.
  function moveClipToLayer(srcId: string, targetLayer: number, requestedStart: number) {
    const latest = elementsRef.current;
    const src = latest.find((e) => e.id === srcId);
    if (!src || src.type === 'audio') return;
    const resolvedStart = resolveOverlap(srcId, targetLayer, requestedStart, src.duration);
    history.push(latest.map((e) => e.id === srcId ? { ...e, layer: targetLayer, startTime: resolvedStart } : e));
  }

  // ISSUE H — Insert a clip on a brand-new layer, positioned above or below an
  // existing track. Finds any clip on the target layer as an anchor and delegates
  // to moveLayerTo so the normalized-layer-index bookkeeping stays consistent.
  function moveClipRelativeToLayer(srcId: string, targetLayer: number, side: 'above' | 'below') {
    const anchor = elementsRef.current.find(
      (e) => e.id !== srcId && e.type !== 'audio' && (e.layer || 0) === targetLayer,
    );
    if (anchor) moveLayerTo(srcId, anchor.id, side);
  }

  // ISSUE H — Whole-track up/down. Swaps the `layer` value of every clip on
  // `layer` with every clip on the next adjacent layer — so the user can reorder
  // an entire row (with all its clips) in one click instead of moving clips one
  // at a time. Audio is untouched.
  function moveTrackUp(layer: number) {
    const latest = elementsRef.current;
    const visualLayers = Array.from(new Set(latest.filter((e) => e.type !== 'audio').map((e) => e.layer || 0)))
      .sort((a, b) => b - a); // DESC, top = front
    const idx = visualLayers.indexOf(layer);
    if (idx <= 0) return;
    const upLayer = visualLayers[idx - 1];
    history.push(latest.map((e) => {
      if (e.type === 'audio') return e;
      const L = e.layer || 0;
      if (L === layer) return { ...e, layer: upLayer };
      if (L === upLayer) return { ...e, layer: layer };
      return e;
    }));
  }
  function moveTrackDown(layer: number) {
    const latest = elementsRef.current;
    const visualLayers = Array.from(new Set(latest.filter((e) => e.type !== 'audio').map((e) => e.layer || 0)))
      .sort((a, b) => b - a);
    const idx = visualLayers.indexOf(layer);
    if (idx === -1 || idx >= visualLayers.length - 1) return;
    const downLayer = visualLayers[idx + 1];
    history.push(latest.map((e) => {
      if (e.type === 'audio') return e;
      const L = e.layer || 0;
      if (L === layer) return { ...e, layer: downLayer };
      if (L === downLayer) return { ...e, layer: layer };
      return e;
    }));
  }

  // FEATURE X + ISSUE D — Drag-and-drop layer reorder: move `srcId` to sit
  // `above` or `below` `destId` in the visual-layer list (top row = foreground).
  // Both must be visual clips — audio has its own track and can't interleave.
  // `side` is 'above' when the cursor was in the top half of destId's row, and
  // 'below' when in the bottom half — mirroring the insertion line the user saw.
  function moveLayerTo(srcId: string, destId: string, side: 'above' | 'below' = 'above') {
    if (srcId === destId) return;
    const latest = elementsRef.current;
    const src = latest.find((e) => e.id === srcId);
    const dest = latest.find((e) => e.id === destId);
    if (!src || !dest || src.type === 'audio' || dest.type === 'audio') return;
    const visuals = [...latest.filter((e) => e.type !== 'audio')]
      .sort((a, b) => (b.layer || 0) - (a.layer || 0));
    const srcIdx = visuals.findIndex((e) => e.id === srcId);
    if (srcIdx === -1) return;
    const [moved] = visuals.splice(srcIdx, 1);
    const newDestIdx = visuals.findIndex((e) => e.id === destId);
    if (newDestIdx === -1) return;
    // Array is top=front. 'above' = insert BEFORE dest (closer to front).
    //                    'below' = insert AFTER dest  (closer to back).
    const insertAt = side === 'above' ? newDestIdx : newDestIdx + 1;
    visuals.splice(insertAt, 0, moved);
    const map = normalizedLayers(visuals);
    history.push(latest.map((e) => map.has(e.id) ? { ...e, layer: map.get(e.id)! } : e));
  }
  function commitAdd(el: EditorElement) {
    const latest = elementsRef.current;
    history.push([...latest, el]);
    setSelectedId(el.id);
  }

  function addText() {
    const newId = `txt-${Date.now()}`;
    const maxLayer = elements.reduce((m, e) => Math.max(m, e.layer || 0), 0);
    // Batch 6 — default "Add Text" should match the headline preset so both
    // entry points share the same first-impression look: "Type a text"
    // placeholder, y=460 on both formats, font "System", textStyle "outline".
    commitAdd({
      id: newId, type: 'text', startTime: currentTime, duration: 3,
      text: 'Type a text', fontSize: 48, fontFamily: 'System', fontWeight: 700, color: '#ffffff',
      textStyle: 'outline', bgColor: '#000000', borderRadius: 8, strokeWidth: 2, strokeColor: '#000000',
      shadowOffset: 2, shadowBlur: 4, opacity: 1, rotation: 0, textAlign: 'center',
      layer: maxLayer + 1,
      // Portrait top-left y=175 so the centre-origin Y display reads -440
      // on both formats (same as 9:16 default). Math: canvasH/2 − elH/2 −
      // 440 = 675 − 60 − 440 = 175.
      vertical: { x: 140, y: 460, width: 800, height: 120 },
      portrait: { x: 140, y: 175, width: 800, height: 120 },
      baseVertical: { width: 800, height: 120 },
      basePortrait: { width: 800, height: 120 },
    });
    // Auto-enter edit mode so user can type immediately
    setTimeout(() => setEditingTextId(newId), 50);
  }

  // Batch 5 — Drop a library sound onto the audio track. Unlike `addMedia`,
  // we skip the blob-URL dance because R2 is already the persistent source —
  // so reload-persistence is guaranteed without a second upload. We still
  // probe the audio's real duration client-side in case the server-stored
  // metadata is missing (older uploads).
  async function addLibrarySound(sound: SoundItem) {
    const serverDuration = typeof sound.duration_seconds === 'number' && sound.duration_seconds > 0
      ? sound.duration_seconds
      : 0;
    const probed = serverDuration > 0 ? serverDuration : await getAudioDuration(sound.r2_url).catch(() => 0);
    const lastEnd = elements.length > 0 ? Math.max(...elements.map((e) => e.startTime + e.duration)) : 0;
    const id = `aud-${Date.now()}`;
    commitAdd({
      id, type: 'audio', src: sound.r2_url, startTime: 0,
      duration: probed > 0 ? probed : (lastEnd || 10),
      // FIX — seed mediaDuration so trim-right can clamp against the real
      // source length (and so trim-left knows how much head-room it has
      // when combined with sourceOffset).
      mediaDuration: probed > 0 ? probed : undefined,
      volume: 100, fadeIn: false, fadeOut: false,
      vertical: { x: 0, y: 0, width: 0, height: 0 }, portrait: { x: 0, y: 0, width: 0, height: 0 },
    });
    toast({ title: 'Sound added', description: sound.name });
  }

  // Batch 4 (revised) — Insert a text element pre-filled with a selected
  // headline. Per Roger's spec the default placement is y=460 (same for both
  // orientations), font "System", and textStyle "outline" (white text + 2px
  // black stroke) so the copy reads clearly against any background.
  function addHeadlineText(presetText: string) {
    const text = (presetText || '').trim();
    if (!text) return;
    const newId = `txt-${Date.now()}`;
    const maxLayer = elements.reduce((m, e) => Math.max(m, e.layer || 0), 0);
    commitAdd({
      id: newId, type: 'text', startTime: currentTime, duration: 3,
      text, fontSize: 48, fontFamily: 'System', fontWeight: 700, color: '#ffffff',
      textStyle: 'outline', bgColor: '#000000', borderRadius: 8, strokeWidth: 2, strokeColor: '#000000',
      shadowOffset: 2, shadowBlur: 4, opacity: 1, rotation: 0, textAlign: 'center',
      layer: maxLayer + 1,
      // Portrait y=175 so centre-origin Y reads −440 identically to 9:16.
      vertical: { x: 140, y: 460, width: 800, height: 120 },
      portrait: { x: 140, y: 175, width: 800, height: 120 },
      baseVertical: { width: 800, height: 120 },
      basePortrait: { width: 800, height: 120 },
    });
  }

  async function addMedia(file: File) {
    // Immediately create a blob URL for instant preview
    const tempUrl = URL.createObjectURL(file);
    const mediaCount = elements.filter((e) => e.type !== 'audio').length;
    const offset = mediaCount * 40; // Progressive offset so clips don't stack perfectly
    const maxLayer = elements.reduce((m, e) => Math.max(m, e.layer || 0), 0);

    if (file.type.startsWith('audio/')) {
      // Determine the audio's duration so the clip on the timeline actually matches the file
      const audioDuration = await getAudioDuration(tempUrl).catch(() => 0);
      const lastEnd = elements.length > 0 ? Math.max(...elements.map((e) => e.startTime + e.duration)) : 0;
      const id = `aud-${Date.now()}`;
      commitAdd({
        id, type: 'audio', src: tempUrl, startTime: 0,
        duration: audioDuration > 0 ? audioDuration : (lastEnd || 10),
        // FIX — seed mediaDuration for imported audio so handleTrimRight can
        // clamp at the real source length (same behaviour as video imports).
        mediaDuration: audioDuration > 0 ? audioDuration : undefined,
        volume: 100, fadeIn: false, fadeOut: false,
        vertical: { x: 0, y: 0, width: 0, height: 0 }, portrait: { x: 0, y: 0, width: 0, height: 0 },
      });
      // Upload to R2 in background and swap URL so the file survives reload
      uploadMediaToR2(file)
        .then((persistentUrl) => {
          if (persistentUrl) {
            commitUpdate(id, { src: persistentUrl });
            URL.revokeObjectURL(tempUrl);
          } else {
            // FIX H — surface silent upload failures (e.g. 413 too-large) so the user knows audio won't survive reload
            toast({
              title: 'Audio upload failed',
              description: 'File is too large or upload rejected. Audio will be lost on reload.',
              variant: 'destructive',
            });
          }
        })
        .catch((err) => {
          console.error('[editor] audio upload failed', err);
          toast({
            title: 'Audio upload warning',
            description: 'Audio saved locally only — will be lost on reload.',
            variant: 'destructive',
          });
        });
      return;
    }
    const type: ElementType = file.type.startsWith('video/') ? 'video' : 'image';
    // FIX I — "appears then disappears" bug: new clip was inserted at `lastEnd`
    // (past the current playhead), so `visibleElements` (which filters by
    // currentTime) would instantly hide it. Two changes:
    //   (a) place the new clip starting at the current playhead, so it lands
    //       where the user is looking and is immediately visible on canvas;
    //   (b) move the playhead to the new clip's start (defensive, in case the
    //       playhead was past the end of the timeline).
    const newStartTime = Math.max(0, currentTime);
    const id = `${type}-${Date.now()}`;
    const w = Math.min(canvas.w - offset * 2, canvas.w);
    const h = Math.round(w * (canvas.h / canvas.w));
    commitAdd({
      id, type, src: tempUrl, startTime: newStartTime, duration: 5,
      zoomEffect: 'none', zoomIntensity: 0.2, opacity: 1, rotation: 0,
      // FIX C — default to unmuted. Autoplay policy is satisfied because playback is user-initiated (Play button).
      muted: type === 'video' ? false : undefined,
      layer: maxLayer + 1,
      vertical: { x: offset, y: offset, width: w, height: h },
      portrait: { x: offset, y: offset, width: Math.min(1080 - offset * 2, 1080), height: Math.min(1350 - offset * 2, 1350) },
      baseVertical: { width: w, height: h },
      basePortrait: { width: Math.min(1080 - offset * 2, 1080), height: Math.min(1350 - offset * 2, 1350) },
    });
    // Pin the playhead at the new clip's start so the canvas shows it right away
    setCurrentTime(newStartTime);
    // Select the new clip so the properties panel reflects it and the user can
    // tune position/duration immediately (matches CapCut's "focus on import" UX)
    setSelectedId(id);
    // ISSUE O — probe the real source duration for video files and clamp the
    // clip's timeline duration to the media's real length. This prevents the
    // user from ever starting out with a clip longer than the source. We also
    // record `mediaDuration` so handleTrimRight can clamp against it later.
    if (type === 'video') {
      getVideoDuration(tempUrl).then((real) => {
        if (!(Number.isFinite(real) && real > 0)) return;
        // elementsRef (see FIX K) always points at the latest committed list,
        // so the async probe stays race-safe across sibling commits.
        const current = elementsRef.current.find((e) => e.id === id);
        if (!current) return;
        const clamped = Math.min(current.duration, real);
        commitUpdate(id, { mediaDuration: real, duration: clamped });
      }).catch(() => {});
      // Capture the first-frame thumbnail. Runs in parallel with duration
      // probe so import doesn't block; the commit below is an additive
      // patch so it coexists with the duration commit above.
      captureVideoThumbnail(tempUrl).then((thumb) => {
        if (!thumb) return;
        const current = elementsRef.current.find((e) => e.id === id);
        if (!current) return;
        commitUpdate(id, { thumbnailUrl: thumb });
      }).catch(() => {});
    }
    uploadMediaToR2(file)
      .then((persistentUrl) => {
        if (persistentUrl) {
          commitUpdate(id, { src: persistentUrl });
          URL.revokeObjectURL(tempUrl);
        } else {
          // FIX H — toast on silent null return (e.g. 413) so user knows file won't persist
          toast({
            title: `${type} upload failed`,
            description: 'File is too large or upload rejected. Media will be lost on reload.',
            variant: 'destructive',
          });
        }
      })
      .catch((err) => {
        console.error('[editor] media upload failed', err);
        toast({
          title: `${type} upload warning`,
          description: 'Media saved locally only — will be lost on reload.',
          variant: 'destructive',
        });
      });
  }

  // FIX H — read an audio file's real duration via an off-DOM HTMLAudioElement
  function getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = document.createElement('audio');
      probe.preload = 'metadata';
      probe.src = url;
      const cleanup = () => { probe.src = ''; };
      probe.addEventListener('loadedmetadata', () => {
        const d = Number.isFinite(probe.duration) ? probe.duration : 0;
        cleanup();
        resolve(d);
      }, { once: true });
      probe.addEventListener('error', () => { cleanup(); reject(new Error('metadata failed')); }, { once: true });
      // Safety timeout — don't block the UI if the browser can't read metadata
      setTimeout(() => { cleanup(); resolve(0); }, 2000);
    });
  }

  // ISSUE O — read a video file's real duration via an off-DOM HTMLVideoElement.
  // Same pattern as getAudioDuration (probe → loadedmetadata → cleanup) so the
  // trim handles can clamp against the real source length as soon as we know it.
  function getVideoDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      probe.src = url;
      const cleanup = () => { probe.removeAttribute('src'); probe.load(); };
      probe.addEventListener('loadedmetadata', () => {
        const d = Number.isFinite(probe.duration) ? probe.duration : 0;
        cleanup();
        resolve(d);
      }, { once: true });
      probe.addEventListener('error', () => { cleanup(); resolve(0); }, { once: true });
      setTimeout(() => { cleanup(); resolve(0); }, 2500);
    });
  }

  // Capture a small JPEG thumbnail of a video's first frame (CapCut-style
  // clip preview). Max 160px wide (height is derived from the video's aspect
  // ratio). The returned data URL is stored on the element so the timeline
  // row can paint it as a background with no extra network calls.
  function captureVideoThumbnail(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = url;
      let done = false;
      const cleanup = () => {
        try { v.removeAttribute('src'); v.load(); } catch { /* noop */ }
      };
      const finish = (val: string | null) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(val);
      };
      const grab = () => {
        try {
          const w = v.videoWidth || 0;
          const h = v.videoHeight || 0;
          if (!w || !h) { finish(null); return; }
          const targetW = Math.min(160, w);
          const targetH = Math.round(targetW * (h / w));
          const c = document.createElement('canvas');
          c.width = targetW;
          c.height = targetH;
          const ctx = c.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(v, 0, 0, targetW, targetH);
          const data = c.toDataURL('image/jpeg', 0.7);
          finish(data);
        } catch (err) {
          console.warn('[captureVideoThumbnail] draw failed', err);
          finish(null);
        }
      };
      v.addEventListener('loadeddata', () => {
        // Seeking to 0 sometimes returns before the frame is fully decoded,
        // so we wait one rAF before sampling.
        try { v.currentTime = 0; } catch { /* noop */ }
        requestAnimationFrame(grab);
      }, { once: true });
      v.addEventListener('seeked', grab, { once: true });
      v.addEventListener('error', () => finish(null), { once: true });
      setTimeout(() => finish(null), 3500);
    });
  }

  // Upload a file to R2 via backend; returns public URL on success
  async function uploadMediaToR2(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/editor/upload-media', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: any = await res.json();
      return data?.url || null;
    } catch (e) {
      console.error('[uploadMediaToR2]', e);
      return null;
    }
  }

  async function createProject() {
    try {
      const res: any = await apiClient.post('/editor/projects', { product_id: productId, name: `Ad ${projects.length + 1}` });
      setProjects((prev) => [...prev, res]); switchProject(res);
    } catch {}
  }

  // ISSUE V — Clone an existing project (elements + layout) under a new name.
  // We snapshot whatever's on the timeline right now (from the ref so any
  // unsaved edits are included), create a fresh project on the server with
  // that payload, and switch the user to it so they can start iterating on a
  // branch without touching the original.
  async function duplicateProject(source: Project) {
    try {
      const sourceElements = source.id === activeId
        ? JSON.stringify(elementsRef.current)
        : (source.elements_json || '[]');
      // Work out a sensible copy name — avoid collisions like "Ad 1 copy copy".
      const baseName = source.name.replace(/\s+copy(\s+\d+)?$/i, '').trim() || source.name;
      const existingCopies = projects.filter((p) => p.name.startsWith(`${baseName} copy`));
      const suffix = existingCopies.length === 0 ? 'copy' : `copy ${existingCopies.length + 1}`;
      const newName = `${baseName} ${suffix}`;
      const res: any = await apiClient.post('/editor/projects', {
        product_id: productId,
        name: newName,
        elements_json: sourceElements,
      });
      setProjects((prev) => [...prev, res]);
      switchProject(res);
      toast({ title: 'Project duplicated', description: `${source.name} → ${newName}` });
    } catch (err: any) {
      toast({ title: 'Duplicate failed', description: err?.message, variant: 'destructive' });
    }
  }

  // Manual save is now replaced by auto-save indicator. Kept for potential future use.

  async function confirmDeleteProject(id: number) {
    await apiClient.delete(`/editor/projects/${id}`).catch(() => {});
    // ISSUE T — Also drop any composed video blobs for this project from
    // IndexedDB so a deleted project's renders don't linger in Preview.
    try { await deleteComposedForProject(id); } catch { /* noop */ }
    const r = projects.filter((p) => p.id !== id); setProjects(r);
    if (activeId === id) { if (r.length > 0) switchProject(r[0]); else { setActiveId(null); history.reset([]); } }
    setDeleteProjectId(null);
  }

  // ── Snap engine v2 helpers ──
  // Build the "others" set (all elements except the one being moved, in canvas units)
  function getOthersForSnap(excludeId: string): SnapRect[] {
    return elements
      .filter((e) => e.id !== excludeId && e.type !== 'audio')
      .map((e) => ({
        id: e.id,
        x: e[format].x,
        y: e[format].y,
        w: e[format].width,
        h: e[format].height,
      }));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('audio/') || file.type.startsWith('video/') || file.type.startsWith('image/')) addMedia(file);
    }
  }

  const trackColors: Record<ElementType, string> = { video: 'bg-blue-500', image: 'bg-green-500', text: 'bg-amber-500', audio: 'bg-purple-500' };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div
      className="space-y-3 relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => {
        // Only hide if leaving the panel, not just moving between children
        if (e.currentTarget === e.target) setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none fixed inset-0 bg-blue-500/15 border-4 border-dashed border-blue-400 rounded-lg z-[9999] flex items-center justify-center" aria-hidden="true">
          <div className="bg-white rounded-lg shadow-2xl px-8 py-6 text-center">
            <Upload className="h-10 w-10 text-blue-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-800">Drop media here</p>
            <p className="text-xs text-muted-foreground">Video, image, or audio</p>
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {projects.map((p) => (
          <div key={p.id} className="flex items-center">
            {renamingId === p.id ? (
              <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={() => { apiClient.patch(`/editor/projects/${p.id}`, { name: renameVal }).catch(() => {}); setProjects((pr) => pr.map((pp) => pp.id === p.id ? { ...pp, name: renameVal } : pp)); setRenamingId(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="h-6 w-20 text-[10px]" autoFocus />
            ) : (
              <button onClick={() => switchProject(p)} onDoubleClick={() => { setRenamingId(p.id); setRenameVal(p.name); }}
                className={cn('px-2 py-1 rounded text-[10px] font-medium', activeId === p.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{p.name}</button>
            )}
            {/* ISSUE V — Duplicate button: clones the entire project (name +
                elements) as a new tab. Always visible so the user can branch
                off any existing Ad with all its content. */}
            <button
              onClick={(e) => { e.stopPropagation(); duplicateProject(p); }}
              className="ml-0.5 text-muted-foreground hover:text-primary"
              title={`Duplicate ${p.name}`}
              aria-label={`Duplicate ${p.name}`}
            >
              <Copy className="h-2.5 w-2.5" />
            </button>
            {projects.length > 1 && <button onClick={() => setDeleteProjectId(p.id)} className="ml-0.5 text-muted-foreground hover:text-destructive"><X className="h-2.5 w-2.5" /></button>}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="h-6 px-1" onClick={createProject} title="New project"><Plus className="h-3 w-3" /></Button>
        <div className="flex-1" />

        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={history.undo} disabled={!history.canUndo} title="Undo (Cmd+Z)"><Undo2 className="h-3 w-3" /></Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={history.redo} disabled={!history.canRedo} title="Redo (Cmd+Shift+Z)"><Redo2 className="h-3 w-3" /></Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setSnapEnabled(!snapEnabled)} title={snapEnabled ? 'Snap on' : 'Snap off'}>{snapEnabled ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}</Button>

        <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
          <button onClick={() => setFormat('vertical')} className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', format === 'vertical' ? 'bg-white shadow' : 'text-muted-foreground')}>9:16</button>
          <button onClick={() => setFormat('portrait')} className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', format === 'portrait' ? 'bg-white shadow' : 'text-muted-foreground')}>4:5</button>
        </div>

        <Button variant={mode === 'edit' ? 'default' : 'outline'} size="sm" className="h-6 text-[9px]" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')} title="Toggle preview / edit mode (P)">
          {mode === 'edit' ? <><Eye className="h-3 w-3 mr-0.5" />Preview mode</> : <><Pencil className="h-3 w-3 mr-0.5" />Edit mode</>}
        </Button>
        <span className="text-[9px] text-muted-foreground min-w-[70px] text-right tabular-nums" aria-live="polite">
          {saving
            ? <span className="inline-flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Saving…</span>
            : lastSavedAt
              ? `Saved ${formatRelative(lastSavedAt)}`
              : activeId ? 'Not saved yet' : ''}
        </span>
        <Button variant="default" size="sm" className="h-6 text-[9px]" onClick={() => { setComposedOutputs({}); setComposeStep({ phase: 'idle', progress: 0 }); setComposeOpen(true); }} disabled={elements.filter((e) => e.type === 'video').length === 0} title="Render final 9:16 + 4:5 video and send to Preview">
          <Send className="h-3 w-3 mr-0.5" />Send to Preview
        </Button>
      </div>

      {!activeId ? (
        <Card className="p-12 text-center border-2 border-dashed"><Film className="h-10 w-10 text-muted-foreground mx-auto mb-3" /><Button onClick={createProject}><Plus className="h-4 w-4 mr-1" />Create project</Button></Card>
      ) : (
        <div className="grid lg:grid-cols-[140px_1fr_220px] gap-3">
          {/* ── Left sidebar (Add elements) ──
              Batch 6 — promoted out of the Properties card so the Add buttons
              (Text, Headlines, Import Video/Image, Import Music, Sounds) are
              always visible and don't steal vertical space from Properties.
              Properties + Canvas stay on the right; the centre column tightens
              by 20px to keep the overall footprint balanced. */}
          <Card className="p-3 space-y-1 text-xs max-h-[65vh] overflow-y-auto">
            <h4 className="font-semibold text-sm mb-1">Add</h4>
            <Button variant="outline" size="sm" className="w-full h-6 text-[9px]" onClick={addText}><Type className="h-3 w-3 mr-0.5" />Text</Button>
            {/* Batch 4 (revised) — "Headlines" dropdown surfaces the headlines
                the ads-creator selected in the copywriting tool (ad_headlines
                where is_selected = 1) for THIS product. Disabled when empty. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-6 text-[9px]"
                  disabled={selectedHeadlines.length === 0}
                  title={selectedHeadlines.length === 0 ? 'No selected headlines — pick some in the copywriting tool first' : 'Insert a selected headline'}
                >
                  <Megaphone className="h-3 w-3 mr-0.5" />Headlines
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="right"
                className="max-h-[60vh] w-64 overflow-y-auto"
              >
                {selectedHeadlines.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No selected headlines
                  </div>
                ) : (
                  selectedHeadlines.map((h) => (
                    <DropdownMenuItem
                      key={h.id}
                      onSelect={() => addHeadlineText(h.headline_text)}
                      className="text-xs whitespace-normal"
                    >
                      {h.headline_text}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <label
              htmlFor="editor-import-video-image"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full h-6 text-[9px] cursor-pointer')}
            >
              <Upload className="h-3 w-3 mr-0.5" />Import Video/Image
            </label>
            <input
              id="editor-import-video-image"
              type="file"
              accept="video/*,image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addMedia(file);
                e.target.value = '';
              }}
            />
            <label
              htmlFor="editor-import-music"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full h-6 text-[9px] cursor-pointer')}
            >
              <Music className="h-3 w-3 mr-0.5" />Import Music
            </label>
            <input
              id="editor-import-music"
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addMedia(file);
                e.target.value = '';
              }}
            />
            {/* Batch 5 — "Sounds" library dropdown. Pulls from the admin-curated
                shared library. Each item has a small play button for in-place
                preview (single shared <audio> element — starting one stops the
                previous). Batch 6 — pause preview audio on menu close. */}
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) {
                  const a = soundPreviewRef.current;
                  if (a) {
                    try { a.pause(); } catch {}
                  }
                  setPreviewingSoundId(null);
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-6 text-[9px]"
                  disabled={librarySounds.length === 0}
                  title={librarySounds.length === 0 ? 'No library sounds yet — ask admin to upload some' : 'Insert a library sound'}
                >
                  <Music className="h-3 w-3 mr-0.5" />Sounds
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="right"
                className="max-h-[60vh] w-72 overflow-y-auto"
              >
                {librarySounds.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No library sounds yet
                  </div>
                ) : (
                  <>
                    {soundCategories.map((cat) => {
                      const items = soundsByCategory.get(cat.id) || [];
                      if (items.length === 0) return null;
                      return (
                        <div key={cat.id}>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {cat.name}
                          </div>
                          {items.map((s) => (
                            <SoundLibraryMenuItem
                              key={s.id}
                              sound={s}
                              isPlaying={previewingSoundId === s.id}
                              onInsert={() => addLibrarySound(s)}
                              onTogglePreview={(e) => toggleSoundPreview(s, e)}
                            />
                          ))}
                        </div>
                      );
                    })}
                    {(() => {
                      const uncat = soundsByCategory.get(null) || [];
                      if (uncat.length === 0) return null;
                      return (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Uncategorized
                          </div>
                          {uncat.map((s) => (
                            <SoundLibraryMenuItem
                              key={s.id}
                              sound={s}
                              isPlaying={previewingSoundId === s.id}
                              onInsert={() => addLibrarySound(s)}
                              onTogglePreview={(e) => toggleSoundPreview(s, e)}
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </Card>

          {/* ── Canvas ── */}
          <Card className="p-3 bg-gray-100 flex justify-center items-start overflow-hidden">
            {/* ISSUE N + AA — Canvas wrapper. Fullscreen is now a CSS modal
                (fixed inset-0 z-50 bg-black/95) with a playback controls bar
                below the scaled canvas so the user can scrub, play/pause and
                see the duration — which the native Fullscreen API couldn't
                provide. Esc closes the modal (wired in the useEffect above). */}
            <div
              ref={canvasContainerRef}
              className={cn(
                isFullscreen
                  ? 'fixed inset-0 z-[60] bg-black/95 flex flex-col items-stretch'
                  : 'relative bg-black rounded-lg overflow-hidden',
              )}
              style={isFullscreen ? undefined : { width: sW, height: sH }}
              // FIX 25e — click on the dark backdrop closes fullscreen.
              // The canvas, control bar and toolbar buttons all live inside
              // child elements, so e.target === e.currentTarget only matches
              // when the user actually clicks the empty surrounding area.
              onClick={(e) => {
                if (isFullscreen && e.target === e.currentTarget) {
                  setIsFullscreen(false);
                }
              }}
            >
              <div
                className={cn(
                  isFullscreen
                    ? 'flex-1 flex items-center justify-center relative overflow-hidden'
                    : 'relative bg-black w-full h-full',
                )}
              >
              <div
                className={cn('relative bg-black', !isFullscreen && 'w-full h-full')}
                style={isFullscreen ? {
                  width: sW,
                  height: sH,
                  // Fit-to-viewport minus control bar (~96px). Pick the smaller
                  // scale so the canvas never overflows and aspect ratio is
                  // preserved.
                  transform: `scale(${Math.min(
                    (window.innerWidth - 48) / sW,
                    (window.innerHeight - 128) / sH,
                  )})`,
                  transformOrigin: 'center center',
                } : undefined}
              >
              {/* Snap guides */}
              {/* Snap engine v2 overlays — CapCut-style CapCut guides + soft-lock boundary labels */}
              <SnapGuides guides={activeGuides} canvas={canvas} scale={SCALE} />
              <BoundaryLabels boundary={activeBoundary} />

              {visibleElements.map((el) => {
                const layout = el[format];
                const sx = layout.x * SCALE; const sy = layout.y * SCALE;
                const sw = layout.width * SCALE; const sh = layout.height * SCALE;
                const isSelected = selectedId === el.id;
                // FIX — source-offset aware. For audio/video clips, `elapsed`
                // is the position inside the SOURCE media (used by SyncedVideo
                // to drive video.currentTime). Without the sourceOffset term,
                // a left-trimmed video would re-play the cropped intro on the
                // very first frame after trimming.
                const elapsed = (currentTime - el.startTime) + (el.sourceOffset || 0);
                // ISSUE Q — zoom/pan AND rotation are now handled by the
                // <ZoomEffectLayer> wrapper (which drives itself via rAF + a
                // direct DOM ref). That decouples the animation from React
                // re-renders so the effect runs smoothly during playback.
                // Previously the zoom was only visible while scrubbing because
                // the inline style on a playing <video> element was not
                // repainting every rAF tick — see ZoomEffectLayer below.

                if (mode === 'edit') {
                  // FIX B — controlled position: when dragLock is set for this el, use snapped coords so the element visibly "locks" at canvas center while drag is active
                  const livePos = (dragLock?.id === el.id)
                    ? { x: dragLock.x, y: dragLock.y }
                    : { x: sx, y: sy };
                  // FIX O — live size during resize (center-anchored), so the visible box reflects the drag
                  const rndSize = (liveSize?.id === el.id)
                    ? { width: liveSize.width * SCALE, height: liveSize.height * SCALE }
                    : { width: sw, height: sh };
                  return (
                    <Rnd key={el.id} size={rndSize} position={livePos}
                      onDragStart={() => {
                        // Reset sticky state + remember starting position for Shift-axis-constraint
                        snapStickyRef.current = {
                          axisX: { snapped: false, anchorMouse: 0 },
                          axisY: { snapped: false, anchorMouse: 0 },
                        };
                        dragStartRef.current = { x: layout.x, y: layout.y };
                      }}
                      onDrag={(_, d) => {
                        // Convert Rnd's screen-px position to canvas units
                        const mouseCanvasX = d.x / SCALE + layout.width / 2;  // approximate mouse via element center
                        const mouseCanvasY = d.y / SCALE + layout.height / 2;

                        // FIX M — detect dominant drag axis so the OTHER axis's sticky lock is generous.
                        // Threshold: if one delta is ≥2× the other AND movement is >5 canvas units,
                        // treat this drag as "mostly on that axis". Small gestures are ambiguous so
                        // we leave dominantAxis null until the user has committed to a direction.
                        let dominantAxis: 'x' | 'y' | null = null;
                        if (dragStartRef.current) {
                          const dxAbs = Math.abs(d.x / SCALE - dragStartRef.current.x);
                          const dyAbs = Math.abs(d.y / SCALE - dragStartRef.current.y);
                          if (dxAbs > 5 || dyAbs > 5) {
                            if (dxAbs >= dyAbs * 2) dominantAxis = 'x';
                            else if (dyAbs >= dxAbs * 2) dominantAxis = 'y';
                          }
                        }

                        // Shift-axis-constraint: lock movement to the axis that has the larger delta so far
                        let shiftConstraint: 'x' | 'y' | null = null;
                        if (shiftHeldRef.current && dragStartRef.current) {
                          const dx = Math.abs(d.x / SCALE - dragStartRef.current.x);
                          const dy = Math.abs(d.y / SCALE - dragStartRef.current.y);
                          shiftConstraint = dx > dy ? 'x' : 'y';
                        }

                        const moving: SnapRect = {
                          id: el.id,
                          x: shiftConstraint === 'y' && dragStartRef.current ? dragStartRef.current.x : d.x / SCALE,
                          y: shiftConstraint === 'x' && dragStartRef.current ? dragStartRef.current.y : d.y / SCALE,
                          w: layout.width,
                          h: layout.height,
                        };

                        const result = computeSnap(
                          moving,
                          getOthersForSnap(el.id),
                          canvas,
                          snapStickyRef.current,
                          mouseCanvasX,
                          mouseCanvasY,
                          {
                            shiftConstraint,
                            disabled: !snapEnabled || altHeldRef.current,
                            scale: SCALE,
                            operation: 'drag',
                            dominantAxis,
                          },
                        );

                        // Update sticky state (if axis newly snapped, record the mouse anchor)
                        if (result.snappedAxes.x && !snapStickyRef.current.axisX.snapped) {
                          snapStickyRef.current.axisX = { snapped: true, anchorMouse: mouseCanvasX };
                        } else if (!result.snappedAxes.x) {
                          snapStickyRef.current.axisX = { snapped: false, anchorMouse: 0 };
                        }
                        if (result.snappedAxes.y && !snapStickyRef.current.axisY.snapped) {
                          snapStickyRef.current.axisY = { snapped: true, anchorMouse: mouseCanvasY };
                        } else if (!result.snappedAxes.y) {
                          snapStickyRef.current.axisY = { snapped: false, anchorMouse: 0 };
                        }

                        setDragLock({ id: el.id, x: result.x * SCALE, y: result.y * SCALE });
                        // FIX O — live X/Y update in Properties panel during drag (Task C)
                        setLiveLayout({ id: el.id, x: result.x, y: result.y, width: layout.width, height: layout.height });
                        setActiveGuides(result.guides);
                        const hasBoundary = result.boundaryHit.left || result.boundaryHit.right || result.boundaryHit.top || result.boundaryHit.bottom;
                        setActiveBoundary(hasBoundary ? result.boundaryHit : null);
                      }}
                      onDragStop={(_, d) => {
                        // Final snap pass on stop — use the locked position from dragLock if set, else raw
                        let finalX = dragLock?.id === el.id ? dragLock.x / SCALE : d.x / SCALE;
                        let finalY = dragLock?.id === el.id ? dragLock.y / SCALE : d.y / SCALE;
                        // Reset
                        snapStickyRef.current = {
                          axisX: { snapped: false, anchorMouse: 0 },
                          axisY: { snapped: false, anchorMouse: 0 },
                        };
                        dragStartRef.current = null;
                        setDragLock(null);
                        setLiveLayout(null);
                        setActiveGuides([]);
                        setActiveBoundary(null);
                        commitLayout(el.id, { x: finalX, y: finalY });
                      }}
                      onResizeStart={() => {
                        snapStickyRef.current = {
                          axisX: { snapped: false, anchorMouse: 0 },
                          axisY: { snapped: false, anchorMouse: 0 },
                        };
                        // FIX O (Task A) — record the element's CENTER at resize start.
                        // All resize math keeps this center fixed so X/Y (center-relative
                        // in the Properties panel) don't drift during resize.
                        resizeCenterRef.current = {
                          cx: layout.x + layout.width / 2,
                          cy: layout.y + layout.height / 2,
                        };
                      }}
                      onResize={(_, __, ref, ___, pos) => {
                        // Raw values from Rnd's handle drag
                        const newW = parseFloat(ref.style.width) / SCALE;
                        const newH = parseFloat(ref.style.height) / SCALE;
                        // FIX O (Task A) — re-anchor around the ORIGINAL center so the box
                        // grows/shrinks symmetrically. The user expects: element at X=0,Y=0
                        // stays at X=0,Y=0 after resize.
                        const anchor = resizeCenterRef.current || { cx: pos.x / SCALE + newW / 2, cy: pos.y / SCALE + newH / 2 };
                        let x = anchor.cx - newW / 2;
                        let y = anchor.cy - newH / 2;
                        // Run the snap engine for visual guides + edge clamp in resize mode
                        const result = computeSnap(
                          { id: el.id, x, y, w: newW, h: newH },
                          getOthersForSnap(el.id),
                          canvas,
                          snapStickyRef.current,
                          x + newW / 2,
                          y + newH / 2,
                          { disabled: !snapEnabled || altHeldRef.current, scale: SCALE, operation: 'resize' },
                        );
                        // ISSUE 4 FIX — the canvas bounds must NOT constrain the element size. If the
                        // user resizes above the canvas format, the element may extend outside the
                        // canvas: we keep it center-anchored instead of snapping to (0,0). Only
                        // clamp when the element still fits inside the canvas.
                        const finalXVal = newW <= canvas.w ? Math.max(0, Math.min(canvas.w - newW, x)) : x;
                        const finalYVal = newH <= canvas.h ? Math.max(0, Math.min(canvas.h - newH, y)) : y;
                        // Use dragLock + liveSize so Rnd visibly reflects the center-anchored box
                        setDragLock({ id: el.id, x: finalXVal * SCALE, y: finalYVal * SCALE });
                        setLiveSize({ id: el.id, width: newW, height: newH });
                        // FIX O — live W/H + X/Y in Properties during resize (Tasks B + C)
                        setLiveLayout({ id: el.id, x: finalXVal, y: finalYVal, width: newW, height: newH });
                        setActiveGuides(result.guides);
                        const hasBoundary = result.boundaryHit.left || result.boundaryHit.right || result.boundaryHit.top || result.boundaryHit.bottom;
                        setActiveBoundary(hasBoundary ? result.boundaryHit : null);
                      }}
                      onResizeStop={(_, __, ref) => {
                        // Commit center-anchored values: use the last liveLayout if available (has
                        // the re-centered x,y), otherwise fall back to Rnd's reported pos + size.
                        const finalW = parseFloat(ref.style.width) / SCALE;
                        const finalH = parseFloat(ref.style.height) / SCALE;
                        const anchor = resizeCenterRef.current;
                        let finalX = anchor ? anchor.cx - finalW / 2 : (liveLayout?.id === el.id ? liveLayout.x : layout.x);
                        let finalY = anchor ? anchor.cy - finalH / 2 : (liveLayout?.id === el.id ? liveLayout.y : layout.y);
                        // ISSUE 4 FIX — only clamp when the element fits inside the canvas. If it's
                        // larger than the format, keep it center-anchored (allowed to extend out).
                        if (finalW <= canvas.w) finalX = Math.max(0, Math.min(canvas.w - finalW, finalX));
                        if (finalH <= canvas.h) finalY = Math.max(0, Math.min(canvas.h - finalH, finalY));
                        // Reset interaction state
                        setActiveGuides([]);
                        setActiveBoundary(null);
                        setDragLock(null);
                        setLiveSize(null);
                        setLiveLayout(null);
                        resizeCenterRef.current = null;
                        snapStickyRef.current = {
                          axisX: { snapped: false, anchorMouse: 0 },
                          axisY: { snapped: false, anchorMouse: 0 },
                        };
                        // FIX Bug #1: Fuse layout + fontSize into a single history push (avoid double-commit race)
                        const latest = elementsRef.current;
                        history.push(
                          latest.map((e) => {
                            if (e.id !== el.id) return e;
                            const baseKey = format === 'vertical' ? 'baseVertical' : 'basePortrait';
                            // ISSUE I — keep the persisted base within the sanity bounds the
                            // Size slider uses (canvas × 1.5). If the user dragged the corner
                            // past that, clamp the base for storage only — the actual element
                            // can still exceed canvas, but the slider's baseline stays usable.
                            const canvasDims = CANVAS[format];
                            const baseW = Math.max(4, Math.min(finalW, canvasDims.w * 1.5));
                            const baseH = Math.max(4, Math.min(finalH, canvasDims.h * 1.5));
                            const updated: EditorElement = {
                              ...e,
                              [format]: {
                                ...e[format],
                                width: finalW,
                                height: finalH,
                                x: finalX,
                                y: finalY,
                              },
                              // FEATURE U — corner-handle resize resets the "100%" baseline
                              // for the Size slider so the user can fine-tune from here.
                              [baseKey]: { width: baseW, height: baseH },
                            };
                            // Per Roger: resizing a text layer should only
                            // change the box (so the user can force wrapping
                            // onto multiple lines). Font size is controlled
                            // exclusively from the Properties panel.
                            return updated;
                          })
                        );
                      }}
                      onClick={() => setSelectedId(el.id)}
                      className={cn('z-10', isSelected && 'ring-2 ring-blue-400')}
                      enableResizing={isSelected && editingTextId !== el.id}
                      // ISSUE L — while the user is editing this text inline, disable
                      // Rnd's drag behaviour so (a) mouse-down inside the contentEditable
                      // div actually places a caret instead of starting a drag, and
                      // (b) click-and-drag inside the text SELECTS a range (CapCut-style).
                      disableDragging={editingTextId === el.id}
                      // FIX A — lock aspect ratio for media so edge/corner resize never crops content
                      lockAspectRatio={el.type === 'video' || el.type === 'image'}
                      resizeHandleStyles={{
                        topLeft: handleStyle('tl'),
                        topRight: handleStyle('tr'),
                        bottomLeft: handleStyle('bl'),
                        bottomRight: handleStyle('br'),
                        top: edgeHandleStyle('t'),
                        right: edgeHandleStyle('r'),
                        bottom: edgeHandleStyle('b'),
                        left: edgeHandleStyle('l'),
                      }}
                      style={{ opacity: el.opacity ?? 1, zIndex: 10 + (el.layer || 0) }}>
                      {/* FIX A — object-contain so full content stays visible (no crop).
                          ISSUE Q — ZoomEffectLayer runs a rAF-driven transform on its own
                          wrapper DIV so the zoom animation plays smoothly during playback
                          (and still tracks the playhead when the user scrubs). */}
                      {el.type === 'video' && el.src && (
                        <ZoomEffectLayer
                          startTime={el.startTime}
                          duration={el.duration}
                          zoomEffect={el.zoomEffect}
                          zoomIntensity={el.zoomIntensity}
                          rotation={el.rotation}
                          playing={playing}
                          currentTime={currentTime}
                        >
                          <SyncedVideo src={el.src} playing={playing} elapsed={elapsed} muted={!!el.muted} reversed={!!el.reversed} clipDuration={el.duration} className="w-full h-full object-contain pointer-events-none" onDurationKnown={(d) => {
                            const knownOK = Number.isFinite(el.mediaDuration as number) && (el.mediaDuration as number) > 0;
                            if (knownOK && Math.abs((el.mediaDuration as number) - d) < 0.05 && el.duration <= d + 0.01) return;
                            const clamped = Math.min(el.duration, d);
                            commitUpdate(el.id, { mediaDuration: d, duration: clamped });
                          }} />
                        </ZoomEffectLayer>
                      )}
                      {el.type === 'image' && el.src && (
                        <ZoomEffectLayer
                          startTime={el.startTime}
                          duration={el.duration}
                          zoomEffect={el.zoomEffect}
                          zoomIntensity={el.zoomIntensity}
                          rotation={el.rotation}
                          playing={playing}
                          currentTime={currentTime}
                        >
                          <img src={el.src} className="w-full h-full object-contain pointer-events-none" />
                        </ZoomEffectLayer>
                      )}
                      {el.type === 'text' && (editingTextId === el.id ? (
                        <EditableText el={el} scale={SCALE} onCommit={(text) => { commitUpdate(el.id, { text }); setEditingTextId(null); }} onCancel={() => setEditingTextId(null)} />
                      ) : (
                        // ISSUE L — single-click selects (Rnd picks it up), double-click
                        // enters inline edit mode. We stop propagation so the enclosing
                        // Rnd onClick doesn't re-select & lose the double-click intent.
                        <div
                          className="w-full h-full"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setSelectedId(el.id);
                            setEditingTextId(el.id);
                          }}
                          onMouseDown={(e) => {
                            // Allow the drag gesture but make double-click faster: if the
                            // element is already selected, the 2nd click enters edit mode.
                            // We do nothing here — Rnd handles the drag; onDoubleClick fires
                            // when the two mousedowns land inside the dblclick threshold.
                            // Just select eagerly so the UX matches CapCut.
                            if (!isSelected) setSelectedId(el.id);
                            // Do NOT stopPropagation — Rnd needs the mousedown to drive drag.
                            void e;
                          }}
                        >
                          {renderText(el, SCALE)}
                        </div>
                      ))}
                    </Rnd>
                  );
                }
                return (
                  <div key={el.id} className="absolute" style={{ left: sx, top: sy, width: sw, height: sh, opacity: el.opacity ?? 1, zIndex: 10 + (el.layer || 0) }}>
                    {el.type === 'video' && el.src && (
                      <ZoomEffectLayer
                        startTime={el.startTime}
                        duration={el.duration}
                        zoomEffect={el.zoomEffect}
                        zoomIntensity={el.zoomIntensity}
                        rotation={el.rotation}
                        playing={playing}
                        currentTime={currentTime}
                      >
                        <SyncedVideo src={el.src} playing={playing} elapsed={elapsed} muted={!!el.muted} className="w-full h-full object-contain" onDurationKnown={(d) => {
                          const knownOK = Number.isFinite(el.mediaDuration as number) && (el.mediaDuration as number) > 0;
                          if (knownOK && Math.abs((el.mediaDuration as number) - d) < 0.05 && el.duration <= d + 0.01) return;
                          const clamped = Math.min(el.duration, d);
                          commitUpdate(el.id, { mediaDuration: d, duration: clamped });
                        }} />
                      </ZoomEffectLayer>
                    )}
                    {el.type === 'image' && el.src && (
                      <ZoomEffectLayer
                        startTime={el.startTime}
                        duration={el.duration}
                        zoomEffect={el.zoomEffect}
                        zoomIntensity={el.zoomIntensity}
                        rotation={el.rotation}
                        playing={playing}
                        currentTime={currentTime}
                      >
                        <img src={el.src} className="w-full h-full object-contain" />
                      </ZoomEffectLayer>
                    )}
                    {el.type === 'text' && renderText(el, SCALE)}
                  </div>
                );
              })}
              </div>
              {/* ISSUE N — Fullscreen toggle lives on top of the canvas so the
                  user can toggle in/out even while fullscreen. Positioned with
                  a subtle dark chip and hidden behind the canvas's pointer
                  layer when not hovered. */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="absolute top-2 right-2 z-50 bg-black/60 hover:bg-black/80 text-white rounded-md px-1.5 py-1 backdrop-blur-sm transition-colors"
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              >
                {isFullscreen
                  ? <Minimize2 className="h-3.5 w-3.5" />
                  : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
              </div>
              {/* ISSUE AA — Playback controls bar. Only visible inside the
                  fullscreen modal. Play/pause reuses the same togglePlay
                  function as the timeline so audio priming works. The scrubber
                  is a range input that sets currentTime directly; its max is
                  playbackDuration so the thumb position matches the actual
                  content duration. */}
              {isFullscreen && (
                <div className="shrink-0 bg-black/80 border-t border-white/10 px-6 py-3 flex items-center gap-4 text-white">
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                    title={playing ? 'Pause (Space)' : 'Play (Space)'}
                    aria-label={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <span className="text-xs tabular-nums w-24 shrink-0">
                    {currentTime.toFixed(1)}s / {playbackDuration.toFixed(1)}s
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(playbackDuration, 0.1)}
                    step="0.05"
                    value={Math.min(currentTime, playbackDuration)}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      setCurrentTime(t);
                      // Also nudge any currently-running audio so seeks mid-play
                      // feel immediate instead of drifting into sync on the next
                      // rAF tick.
                      if (playing) {
                        for (const el of elementsRef.current) {
                          if (el.type !== 'audio' || !el.src) continue;
                          const audio = audioRefs.current.get(el.id);
                          if (!audio) continue;
                          const inRange = t >= el.startTime && t < el.startTime + el.duration;
                          if (inRange) {
                            try { audio.currentTime = (t - el.startTime) + (el.sourceOffset || 0); } catch {}
                          } else {
                            try { audio.pause(); } catch {}
                          }
                        }
                      }
                    }}
                    className="flex-1 h-1 accent-primary cursor-pointer"
                    aria-label="Seek"
                  />
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1.5"
                    title="Exit fullscreen (Esc)"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                    Exit
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* ── Properties ── */}
          <Card className="p-3 space-y-2 text-xs max-h-[65vh] overflow-y-auto">
            <h4 className="font-semibold text-sm">Properties</h4>
            {selected ? (
              <>
                <Badge className="text-[9px]">{selected.type}</Badge>

                {/* Position/size (center-relative: 0,0 = canvas center). FIX L — user
                    expects X=0 / Y=0 to mean "element centered" so it lines up with
                    the horizontal/vertical center indicators. Internally the model
                    still uses top-left coords; we convert on display and on input.
                    FIX O (Tasks B + C) — when the user is actively dragging/resizing,
                    `liveLayout` has the most recent numbers so the Properties panel
                    updates continuously (not just on mouse release). */}
                {(() => {
                  const live = liveLayout?.id === selected.id ? liveLayout : null;
                  const curX = live ? live.x : selected[format].x;
                  const curY = live ? live.y : selected[format].y;
                  const curW = live ? live.width : selected[format].width;
                  const curH = live ? live.height : selected[format].height;
                  // FEATURE U + ISSUE G + ISSUE I — Baseline for the Size slider.
                  // Prefer the stored baseVertical/basePortrait. If it's missing (legacy
                  // projects) OR inconsistent with canvas dimensions (e.g. serialized with
                  // the wrong format, or corrupted by a prior corner-handle resize that
                  // left e.g. basePortrait={5000,6000} in a 1080×1350 canvas), fall back
                  // to a STABLE reference derived from the current aspect ratio fit into
                  // the canvas. Stability matters: the previous fallback of {curW,curH}
                  // re-derived on every render, so `applySizePct(pct)` would always scale
                  // relative to CURRENT size and sizePct would always read 100% — the
                  // user's reported "x100 multiplier, 100% never changes" bug.
                  const baseKey = format === 'vertical' ? 'baseVertical' : 'basePortrait';
                  const rawBase = selected[baseKey];
                  const baseLooksSane = rawBase
                    && rawBase.width > 0
                    && rawBase.height > 0
                    && rawBase.width <= canvas.w * 1.5
                    && rawBase.height <= canvas.h * 1.5;
                  // Stable fallback: fit canvas preserving aspect of current dimensions.
                  const fallbackBase = (() => {
                    const aspect = curW > 0 && curH > 0 ? curW / curH : canvas.w / canvas.h;
                    // Fit aspect into canvas bounds so the fallback's magnitude is
                    // comparable to the canvas — 100% ≈ "fills the canvas".
                    if (aspect >= canvas.w / canvas.h) {
                      return { width: canvas.w, height: canvas.w / aspect };
                    }
                    return { width: canvas.h * aspect, height: canvas.h };
                  })();
                  const base = baseLooksSane ? rawBase! : fallbackBase;
                  const sizePct = base.width > 0 ? Math.round((curW / base.width) * 100) : 100;
                  // ISSUE 3 + ISSUE 4 — apply a size % (center-anchored). No canvas clamping when
                  // the element exceeds the format: it's allowed to extend outside the bounds.
                  function applySizePct(pct: number) {
                    const scale = pct / 100;
                    const cx = curX + curW / 2;
                    const cy = curY + curH / 2;
                    const newW = Math.max(4, base.width * scale);
                    const newH = Math.max(4, base.height * scale);
                    const fitsW = newW <= canvas.w;
                    const fitsH = newH <= canvas.h;
                    const rawX = cx - newW / 2;
                    const rawY = cy - newH / 2;
                    const newX = fitsW ? Math.max(0, Math.min(canvas.w - newW, rawX)) : rawX;
                    const newY = fitsH ? Math.max(0, Math.min(canvas.h - newH, rawY)) : rawY;
                    commitLayout(selected!.id, { width: newW, height: newH, x: newX, y: newY });
                  }
                  // Batch 6 (revised) — origin at canvas CENTER, not top-left.
                  // X=0, Y=0 means the element's centre is exactly on the
                  // canvas centre. Positive X/Y go right/down, negative go
                  // left/up. This keeps the number system symmetrical so the
                  // same value means the same visual placement regardless of
                  // format, and types naturally (0,0 == dead centre).
                  const xCenter = Math.round(curX + curW / 2 - canvas.w / 2);
                  const yCenter = Math.round(curY + curH / 2 - canvas.h / 2);
                  return (
                    <>
                      {/* ISSUE A — Position on one row (X + Y side by side). */}
                      <div className="grid grid-cols-2 gap-1">
                        <div>
                          <Label className="text-[9px]">X</Label>
                          <TypableNumberInput
                            value={xCenter}
                            min={-9999} max={9999}
                            onCommit={(n) => commitLayout(selected.id, { x: n + canvas.w / 2 - selected[format].width / 2 })}
                            className="h-6 text-[10px] w-full border rounded px-1"
                          />
                        </div>
                        <div>
                          <Label className="text-[9px]">Y</Label>
                          <TypableNumberInput
                            value={yCenter}
                            min={-9999} max={9999}
                            onCommit={(n) => commitLayout(selected.id, { y: n + canvas.h / 2 - selected[format].height / 2 })}
                            className="h-6 text-[10px] w-full border rounded px-1"
                          />
                        </div>
                      </div>
                      {/* ISSUE A — Size on its OWN row. ISSUE F — input and slider share
                          the same sizePct so typing 100 yields 100% instead of drifting. */}
                      {selected.type !== 'audio' && (
                        <div>
                          <Label className="text-[9px] flex items-center gap-1">
                            Size: <span className="font-mono tabular-nums">{sizePct}%</span>
                            <span className="text-muted-foreground ml-auto text-[8px]">{Math.round(curW)} × {Math.round(curH)} px</span>
                          </Label>
                          <div className="flex items-center gap-1">
                            <input
                              type="range" min="1" max="400" step="1" value={sizePct}
                              onChange={(e) => {
                                // ISSUE 3 — detent every 10% (snap within ±2% of a multiple of 10).
                                const raw = parseInt(e.target.value) || 100;
                                const nearest10 = Math.round(raw / 10) * 10;
                                const pct = Math.abs(raw - nearest10) <= 2 ? nearest10 : raw;
                                applySizePct(pct);
                              }}
                              onDoubleClick={() => applySizePct(100)}
                              title="Drag to resize uniformly (100% = base). Detents every 10%. Double-click to reset."
                              className="flex-1 h-1 accent-primary"
                            />
                            <TypableNumberInput
                              value={sizePct}
                              min={1} max={400}
                              onCommit={(n) => applySizePct(n)}
                              className="h-6 w-14 text-[10px] border rounded px-1"
                              title="Type size % (1-400)"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                {/* ISSUE A — Rotation on its OWN row */}
                <div>
                  <Label className="text-[9px] flex items-center gap-1">
                    <RotateCw className="h-2.5 w-2.5" />
                    Rotation: <span className="font-mono tabular-nums">{selected.rotation || 0}°</span>
                  </Label>
                  <div className="flex items-center gap-1">
                    <input type="range" min="-180" max="180" step="1" value={selected.rotation || 0}
                      onChange={(e) => {
                        // ISSUE 3 — detent every 10° (snap within ±2° of a multiple of 10).
                        const raw = parseInt(e.target.value) || 0;
                        const nearest10 = Math.round(raw / 10) * 10;
                        const deg = Math.abs(raw - nearest10) <= 2 ? nearest10 : raw;
                        commitUpdate(selected.id, { rotation: deg });
                      }}
                      onDoubleClick={() => commitUpdate(selected.id, { rotation: 0 })}
                      title="Double-click to reset to 0°. Detents every 10°."
                      className="flex-1 h-1 accent-primary" />
                    <TypableNumberInput
                      value={selected.rotation || 0}
                      min={-180} max={180}
                      onCommit={(n) => commitUpdate(selected.id, { rotation: n })}
                      className="h-6 w-14 text-[10px] border rounded px-1"
                      title="Type rotation (-180 to 180)"
                    />
                  </div>
                </div>
                {/* ISSUE A — Opacity on its OWN row, now also a slider + input pair */}
                <div>
                  <Label className="text-[9px] flex items-center gap-1">
                    Opacity: <span className="font-mono tabular-nums">{Math.round((selected.opacity ?? 1) * 100)}%</span>
                  </Label>
                  <div className="flex items-center gap-1">
                    <input type="range" min="0" max="100" step="1" value={Math.round((selected.opacity ?? 1) * 100)}
                      onChange={(e) => commitUpdate(selected.id, { opacity: (parseInt(e.target.value) || 0) / 100 })}
                      onDoubleClick={() => commitUpdate(selected.id, { opacity: 1 })}
                      title="Double-click to reset to 100%"
                      className="flex-1 h-1 accent-primary" />
                    <TypableNumberInput
                      value={Math.round((selected.opacity ?? 1) * 100)}
                      min={0} max={100}
                      onCommit={(n) => commitUpdate(selected.id, { opacity: n / 100 })}
                      className="h-6 w-14 text-[10px] border rounded px-1"
                      title="Type opacity % (0-100)"
                    />
                  </div>
                </div>

                {/* Layer ordering — FIX P (Task D): swap with adjacent instead of jumping
                    to top/bottom. Audio has no layer control (its own timeline track). */}
                {selected.type !== 'audio' && (
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] flex-1 flex items-center gap-1"><Layers className="h-2.5 w-2.5" />Layer {selected.layer || 0}</Label>
                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => moveLayerUp(selected.id)} title="Move one layer up (toward foreground)"><ChevronUp className="h-3 w-3" /></Button>
                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => moveLayerDown(selected.id)} title="Move one layer down (toward background)"><ChevronDown className="h-3 w-3" /></Button>
                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => commitDuplicate(selected.id)} title="Duplicate (Cmd+D)"><Copy className="h-3 w-3" /></Button>
                  </div>
                )}
                {selected.type === 'audio' && (
                  <div className="flex items-center gap-1">
                    <Label className="text-[9px] flex-1 flex items-center gap-1"><Music className="h-2.5 w-2.5" />Audio track</Label>
                    <Button variant="outline" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => commitDuplicate(selected.id)} title="Duplicate (Cmd+D)"><Copy className="h-3 w-3" /></Button>
                  </div>
                )}

                {/* Timing */}
                <div className="grid grid-cols-2 gap-1">
                  <div><Label className="text-[9px]">Start (s)</Label><Input type="number" step="0.1" value={selected.startTime.toFixed(1)} onChange={(e) => commitUpdate(selected.id, { startTime: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-6 text-[10px]" /></div>
                  <div><Label className="text-[9px]">Duration</Label><Input type="number" step="0.1" min="0.5" value={selected.duration.toFixed(1)} onChange={(e) => commitUpdate(selected.id, { duration: Math.max(0.5, parseFloat(e.target.value) || 0.5) })} className="h-6 text-[10px]" /></div>
                </div>

                {/* Text properties */}
                {selected.type === 'text' && (
                  <div className="space-y-1.5 border-t pt-2">
                    <Textarea value={selected.text || ''} onChange={(e) => commitUpdate(selected.id, { text: e.target.value })} rows={2} className="text-[10px]" placeholder="Type text…" />
                    <div className="grid grid-cols-2 gap-1">
                      <div><Label className="text-[9px]">Size</Label><Input type="number" value={selected.fontSize || 48} onChange={(e) => commitUpdate(selected.id, { fontSize: parseInt(e.target.value) || 48 })} className="h-6 text-[10px]" /></div>
                      <div><Label className="text-[9px]">Color</Label><Input type="color" value={selected.color || '#fff'} onChange={(e) => commitUpdate(selected.id, { color: e.target.value })} className="h-6" /></div>
                    </div>
                    {/* ISSUE M — Font family (Google-hosted: Inter, Roboto, Poppins,
                        Montserrat, Playfair Display — plus web-safe fallbacks). */}
                    <div>
                      <Label className="text-[9px]">Font</Label>
                      <Select value={selected.fontFamily || DEFAULT_TEXT_FONT} onValueChange={(v) => commitUpdate(selected.id, { fontFamily: v })}>
                        <SelectTrigger className="h-6 text-[9px]"><SelectValue placeholder="Font" /></SelectTrigger>
                        <SelectContent>
                          {FONT_FAMILIES.map((f) => (
                            <SelectItem key={f} value={f}><span style={{ fontFamily: resolveFontStack(f) }}>{f}</span></SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* ISSUE M — Font weight (Thin 100 / Normal 400 / Bold 700 / Extra Bold 900). */}
                    <div>
                      <Label className="text-[9px]">Weight</Label>
                      <Select
                        value={String(selected.fontWeight ?? 700)}
                        onValueChange={(v) => commitUpdate(selected.id, { fontWeight: parseInt(v) })}
                      >
                        <SelectTrigger className="h-6 text-[9px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FONT_WEIGHTS.map((w) => (
                            <SelectItem key={w.value} value={String(w.value)}>
                              <span style={{ fontWeight: w.value, fontFamily: resolveFontStack(selected.fontFamily) }}>{w.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* Text align (Ergo #10) */}
                    <div className="flex gap-0.5">
                      {(['left', 'center', 'right'] as const).map((a) => {
                        const Icon = a === 'left' ? AlignLeft : a === 'right' ? AlignRight : AlignCenter;
                        const active = (selected.textAlign || 'center') === a;
                        return (
                          <Button key={a} variant={active ? 'default' : 'outline'} size="sm" className="flex-1 h-6 px-0" onClick={() => commitUpdate(selected.id, { textAlign: a })} title={`Align ${a}`} aria-label={`Align ${a}`}>
                            <Icon className="h-3 w-3" />
                          </Button>
                        );
                      })}
                    </div>
                    {/* FEATURE — Letter spacing (tracking). em-units so it scales
                        with fontSize; slider range -0.05 → 0.30 covers tight to
                        airy display copy without allowing broken layouts. */}
                    <div>
                      <Label className="text-[9px]">
                        Letter spacing: <span className="font-mono tabular-nums">{((selected.letterSpacing ?? 0)).toFixed(2)}em</span>
                      </Label>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min="-0.05"
                          max="0.30"
                          step="0.01"
                          value={selected.letterSpacing ?? 0}
                          onChange={(e) => commitUpdate(selected.id, { letterSpacing: parseFloat(e.target.value) })}
                          className="flex-1 h-1 accent-primary"
                        />
                        <Input
                          type="number"
                          step="0.01"
                          value={(selected.letterSpacing ?? 0).toFixed(2)}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            if (Number.isFinite(raw)) commitUpdate(selected.id, { letterSpacing: Math.max(-0.2, Math.min(0.6, raw)) });
                          }}
                          className="h-6 w-14 text-[10px]"
                        />
                      </div>
                    </div>
                    {/* FEATURE — Line height (leading). Unitless multiplier, default 1.2.
                        1.0 = tight, 1.2 = comfortable, 1.8 = airy poster copy. */}
                    <div>
                      <Label className="text-[9px]">
                        Line height: <span className="font-mono tabular-nums">{(selected.lineHeight ?? 1.2).toFixed(2)}</span>
                      </Label>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min="0.9"
                          max="2.0"
                          step="0.05"
                          value={selected.lineHeight ?? 1.2}
                          onChange={(e) => commitUpdate(selected.id, { lineHeight: parseFloat(e.target.value) })}
                          className="flex-1 h-1 accent-primary"
                        />
                        <Input
                          type="number"
                          step="0.05"
                          value={(selected.lineHeight ?? 1.2).toFixed(2)}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            if (Number.isFinite(raw)) commitUpdate(selected.id, { lineHeight: Math.max(0.9, Math.min(2.0, raw)) });
                          }}
                          className="h-6 w-14 text-[10px]"
                        />
                      </div>
                    </div>
                    <Select value={selected.textStyle || 'plain'} onValueChange={(v: any) => commitUpdate(selected.id, { textStyle: v })}>
                      <SelectTrigger className="h-6 text-[9px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="plain">Plain</SelectItem><SelectItem value="background">Background</SelectItem><SelectItem value="outline">Outline</SelectItem><SelectItem value="shadow">Shadow</SelectItem></SelectContent>
                    </Select>
                    {selected.textStyle === 'background' && <div className="grid grid-cols-2 gap-1"><div><Input type="color" value={selected.bgColor || '#000'} onChange={(e) => commitUpdate(selected.id, { bgColor: e.target.value })} className="h-6" /></div><div><Input type="number" value={selected.borderRadius || 8} onChange={(e) => commitUpdate(selected.id, { borderRadius: parseInt(e.target.value) })} className="h-6 text-[10px]" placeholder="Radius" /></div></div>}
                  </div>
                )}

                {/* Video/image zoom */}
                {(selected.type === 'video' || selected.type === 'image') && (
                  <div className="space-y-1.5 border-t pt-2">
                    <Label className="text-[9px]">Zoom effect</Label>
                    <Select value={selected.zoomEffect || 'none'} onValueChange={(v: any) => commitUpdate(selected.id, { zoomEffect: v })}>
                      <SelectTrigger className="h-6 text-[9px]"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="none">No Zoom</SelectItem><SelectItem value="zoom-in">Zoom In</SelectItem><SelectItem value="zoom-out">Zoom Out</SelectItem><SelectItem value="ken-burns">Ken Burns</SelectItem></SelectContent>
                    </Select>
                    {selected.zoomEffect !== 'none' && <input type="range" min="0.1" max="0.5" step="0.05" value={selected.zoomIntensity || 0.2} onChange={(e) => commitUpdate(selected.id, { zoomIntensity: parseFloat(e.target.value) })} className="w-full h-1 accent-primary" />}
                  </div>
                )}

                {/* Video sound toggle (Bug #2 UI) — FIX C: truthy == muted, default unmuted */}
                {selected.type === 'video' && (
                  <div className="space-y-1 border-t pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-6 text-[9px] justify-start"
                      onClick={() => commitUpdate(selected.id, { muted: !selected.muted })}
                      title="Toggle video sound"
                    >
                      {selected.muted ? (
                        <><VolumeX className="h-3 w-3 mr-1" />Muted (click to unmute)</>
                      ) : (
                        <><Volume2 className="h-3 w-3 mr-1 text-primary" />Sound on</>
                      )}
                    </Button>
                    {/* FEATURE W — Reverse video: plays the clip backward (end → start). Audio is muted in reverse. */}
                    <label className="flex items-center gap-1.5 cursor-pointer text-[9px] px-1 py-1 rounded hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={!!selected.reversed}
                        onChange={(e) => commitUpdate(selected.id, { reversed: e.target.checked })}
                        className="rounded h-3 w-3"
                      />
                      <span>Reverse (play end → start)</span>
                    </label>
                  </div>
                )}

                {/* Audio properties */}
                {selected.type === 'audio' && (
                  <div className="space-y-1.5 border-t pt-2">
                    <div><Label className="text-[9px]">Volume: {selected.volume || 100}%</Label><input type="range" min="0" max="100" value={selected.volume || 100} onChange={(e) => commitUpdate(selected.id, { volume: parseInt(e.target.value) })} className="w-full h-1 accent-primary" /></div>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1 text-[9px]"><input type="checkbox" checked={!!selected.fadeIn} onChange={(e) => commitUpdate(selected.id, { fadeIn: e.target.checked })} />Fade In</label>
                      <label className="flex items-center gap-1 text-[9px]"><input type="checkbox" checked={!!selected.fadeOut} onChange={(e) => commitUpdate(selected.id, { fadeOut: e.target.checked })} />Fade Out</label>
                    </div>
                  </div>
                )}

                <Button variant="destructive" size="sm" className="w-full h-6 text-[9px]" onClick={() => setDeleteElementId(selected.id)}><Trash2 className="h-3 w-3 mr-0.5" />Remove</Button>
              </>
            ) : <p className="text-muted-foreground text-[10px]">Click an element to edit</p>}
            {/* Batch 6 — the Add section (Text / Headlines / Import… / Sounds)
                has moved to a dedicated left sidebar so Properties stays
                focused on the selected element. See the sidebar Card above. */}
          </Card>
        </div>
      )}

      {/* ── Timeline ── */}
      {activeId && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setCurrentTime(0)}><SkipBack className="h-3 w-3" /></Button>
            {/* FIX Q (Task E) — togglePlay is factored so the fullscreen popup
                can reuse it. See definition above. Must stay inside a user
                gesture for Chrome's autoplay policy. */}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={togglePlay}>
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </Button>
            <span className="text-[9px] text-muted-foreground w-20">{currentTime.toFixed(1)}s / {playbackDuration.toFixed(1)}s</span>
            {/* ISSUE J — Scrubber's range is timelineDuration (not playbackDuration)
                so the slider thumb's horizontal position matches the red playhead's
                position on the timeline ruler below. Playback still auto-stops at
                playbackDuration (contentDuration) inside the RAF loop. */}
            <input type="range" min="0" max={Math.max(timelineDuration, 0.1)} step="0.05" value={Math.min(currentTime, timelineDuration)} onChange={(e) => setCurrentTime(parseFloat(e.target.value))} className="flex-1 h-1 accent-primary" />
            {/* FEATURE T + ISSUE 1 — Timeline zoom controls. Default is "Fit" (auto): the
                 timeline is sized to match the container so nothing overflows. Any +/−
                 or Ctrl/Cmd+wheel action drops into manual zoom; the "Fit" button (shown
                 when in manual mode) returns to auto. */}
            <div className="flex items-center gap-0.5 border-l pl-2 ml-1">
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Zoom out timeline"
                onClick={() => {
                  const current = zoomMode === 'auto' ? autoZoom : timelineZoom;
                  const next = Math.max(0.1, current / 1.5);
                  setTimelineZoom(next);
                  setZoomMode('manual');
                }}>
                <span className="text-[12px] font-bold leading-none">−</span>
              </Button>
              <span className="text-[9px] text-muted-foreground w-10 text-center tabular-nums">
                {zoomMode === 'auto' ? 'Fit' : `${Math.round(timelineZoom * 100)}%`}
              </span>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Zoom in timeline"
                onClick={() => {
                  const current = zoomMode === 'auto' ? autoZoom : timelineZoom;
                  const next = Math.min(10, current * 1.5);
                  setTimelineZoom(next);
                  setZoomMode('manual');
                }}>
                <span className="text-[12px] font-bold leading-none">+</span>
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-[8px]"
                title={zoomMode === 'auto' ? 'Already fit to window (auto)' : 'Fit timeline to window (auto-zoom)'}
                onClick={() => setZoomMode('auto')}>
                {zoomMode === 'auto' ? '•' : 'Fit'}
              </Button>
            </div>
          </div>

          {/* Trim tooltip */}
          {trimTooltip && (
            <div className="fixed bg-black text-white text-[10px] px-2 py-1 rounded shadow-lg z-50 pointer-events-none" style={{ left: trimTooltip.x, top: -30 }}>
              {trimTooltip.dur.toFixed(1)}s ({trimTooltip.start.toFixed(1)}→{trimTooltip.end.toFixed(1)})
            </div>
          )}

          {/* ISSUE D — Floating ghost preview of the clip being dragged. Follows the
              cursor, appears only during layer reorder mode (vertical drag), and gives
              clear real-time feedback about what's being picked up. */}
          {layerDragGhost && layerDragId && (
            <div
              className="fixed z-[60] pointer-events-none px-2 py-1 rounded bg-blue-500 text-white text-[10px] font-medium shadow-xl ring-2 ring-white/50 -translate-x-1/2 -translate-y-1/2"
              style={{ left: layerDragGhost.x + 14, top: layerDragGhost.y + 14 }}
            >
              {layerDragGhost.label}
              {layerDragGhost.snappedForward && (
                <span className="ml-1 text-[9px] opacity-90">→ snap after</span>
              )}
            </div>
          )}

          {elements.length === 0 ? (
            <div className="py-4 text-center border-2 border-dashed rounded text-[10px] text-muted-foreground">Drop media here or use the Add buttons</div>
          ) : (() => {
            // FIX P (Task D) — split timeline into two groups:
            //   • Visual layers (video/image/text) — sorted by layer DESC: top row = foreground.
            //   • Audio track(s) — separate section below; can't be interleaved with visual content.
            // ISSUE H — Multiple visual clips can now share the same `layer` value,
            // which means they render on the SAME timeline row. The render path below
            // groups by layer so each row can host several clips positioned by startTime.
            const visualElements = [...elements.filter((e) => e.type !== 'audio')]
              .sort((a, b) => (b.layer || 0) - (a.layer || 0));
            const audioElements = elements.filter((e) => e.type === 'audio');
            const visualTracks = (() => {
              const byLayer = new Map<number, EditorElement[]>();
              for (const el of visualElements) {
                const L = el.layer || 0;
                if (!byLayer.has(L)) byLayer.set(L, []);
                byLayer.get(L)!.push(el);
              }
              const layerKeys = Array.from(byLayer.keys()).sort((a, b) => b - a); // DESC: top = front
              return layerKeys.map((layer) => ({
                layer,
                clips: byLayer.get(layer)!.sort((a, b) => a.startTime - b.startTime),
              }));
            })();

            // ISSUE K — Magnetic snap (CapCut-style). Pixel-based threshold so the
            // "pull" feel stays constant whatever the zoom level is. Snap targets in
            // descending priority:
            //   • Playhead (red)  — currentTime
            //   • Origin (green)  — t=0
            //   • Clip edges (cyan) — start/end of every other clip
            //   • Integer ticks (gray) — only as a last resort, lower priority
            // The dragged clip can also snap its END to those targets when
            // selfDuration is provided (so dropping a clip flush against another
            // clip's right edge feels effortless).
            function snapTime(
              t: number,
              selfId: string,
              selfDuration?: number,
            ): { time: number; snapped: boolean; color: string; label: string } {
              const pxPerSec = timelineDuration > 0 ? timelineWidthPx / timelineDuration : 30;
              const thresholdTime = Math.max(0.02, 8 / pxPerSec); // 8px in current zoom
              type Tgt = { t: number; color: string; label: string; priority: number };
              const targets: Tgt[] = [];
              targets.push({ t: currentTime, color: '#ef4444', label: 'Playhead', priority: 4 });
              targets.push({ t: 0, color: '#10b981', label: '0s', priority: 3 });
              for (const other of elements) {
                if (other.id === selfId) continue;
                targets.push({ t: other.startTime, color: '#06b6d4', label: 'Clip start', priority: 2 });
                targets.push({ t: other.startTime + other.duration, color: '#06b6d4', label: 'Clip end', priority: 2 });
              }
              // Test the candidate START against every target.
              let best: Tgt | null = null;
              let bestDist = thresholdTime;
              for (const tgt of targets) {
                const d = Math.abs(t - tgt.t);
                if (d < bestDist || (d <= bestDist && best && tgt.priority > best.priority)) {
                  best = tgt;
                  bestDist = d;
                }
              }
              // Also test snapping the END of the dragged clip (so clips clip-clack
              // tail-first into another clip's start). selfDuration === undefined
              // when called from trim handlers — those only care about one edge.
              if (selfDuration !== undefined) {
                for (const tgt of targets) {
                  const candidateStart = tgt.t - selfDuration;
                  const d = Math.abs(t - candidateStart);
                  if (d < bestDist || (d <= bestDist && best && tgt.priority > best.priority)) {
                    best = { ...tgt, label: `End → ${tgt.label}` };
                    bestDist = d;
                  }
                }
              }
              if (best) {
                const snappedTime = selfDuration !== undefined && best.label.startsWith('End → ')
                  ? best.t - selfDuration
                  : best.t;
                return { time: snappedTime, snapped: true, color: best.color, label: best.label };
              }
              return { time: t, snapped: false, color: '', label: '' };
            }

            function renderClipRow(el: EditorElement, bare = false) {
              const left = (el.startTime / timelineDuration) * 100;
              const width = (el.duration / timelineDuration) * 100;
              const Icon = el.type === 'audio' ? Music : el.type === 'text' ? Type : el.type === 'image' ? ImageIcon : Film;

              function handleClipDrag(e: React.MouseEvent) {
                e.stopPropagation();
                e.preventDefault();
                // ISSUE 2 — Drag the clip body directly: horizontal axis → move in time;
                // vertical axis → reorder layers. Axis is chosen after a small threshold
                // so tiny jitters don't flip modes. This replaces the old GripVertical
                // HTML5-DnD handle entirely and never triggers the canvas "Drop media here"
                // dropzone (which listens to HTML5 dragover events, not mousemove).
                // ISSUE J — prevent the browser from starting a text selection when
                // the drag crosses the ruler labels or other selectable text.
                const prevUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
                const startX = e.clientX;
                const startY = e.clientY;
                const origStart = el.startTime;
                const container = e.currentTarget.closest('[data-timeline-track]') as HTMLElement;
                if (!container) return;
                const groupIds = selectedIds.has(el.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [el.id];
                const origStarts = new Map(groupIds.map((id) => {
                  const e2 = elements.find((x) => x.id === id);
                  return [id, e2 ? e2.startTime : 0];
                }));

                // ISSUE AB — Commit to drag mode almost immediately (2 px)
                // instead of the old 5 px. The prior threshold meant a user
                // who pressed + slid just a few pixels got no visible
                // response, so they had to click again and move more — hence
                // the "two clicks to drag" complaint. 2 px is small enough to
                // feel instant but above zero-jitter so a clean click still
                // selects via the onClick handler.
                let mode: 'undecided' | 'time' | 'layer' = 'undecided';
                const THRESHOLD = 2; // px — anything past this commits to axis

                // ISSUE H (v2) — Hit-test helper for layer mode. Returns the track row
                // under the cursor and which zone the cursor is in:
                //   top 30%    → 'above' (create NEW layer above this track)
                //   middle 40% → 'merge' (share the same row — "Video 2 after Video 1")
                //   bottom 30% → 'below' (create NEW layer below this track)
                //
                // The zones are asymmetric (bigger above/below than a pure third split)
                // because the user reported that above/below was hard to hit when the
                // track rows are only ~30px tall. We also extend the edges so cursor
                // above the first row or below the last still counts as above/below of
                // the nearest track — dragging into the visually empty space around the
                // stack should still create a new layer there.
                const hitTestTrack = (ev: MouseEvent): { layer: number | null; side: 'above' | 'below' | 'merge' } => {
                  const rows = document.querySelectorAll<HTMLElement>('[data-track-layer]');
                  let resultLayer: number | null = null;
                  let resultSide: 'above' | 'below' | 'merge' = 'merge';
                  rows.forEach((row) => {
                    const layerStr = row.getAttribute('data-track-layer');
                    if (!layerStr) return;
                    const layer = parseInt(layerStr, 10);
                    if (Number.isNaN(layer)) return;
                    const rect = row.getBoundingClientRect();
                    if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
                      resultLayer = layer;
                      const y = ev.clientY - rect.top;
                      const topZone = rect.height * 0.3;
                      const bottomZone = rect.height * 0.7;
                      if (y < topZone) resultSide = 'above';
                      else if (y > bottomZone) resultSide = 'below';
                      else resultSide = 'merge';
                    }
                  });
                  // If the cursor is above the first track or below the last, extend
                  // the nearest row's "above"/"below" zone so a user dragging into
                  // empty space still gets the correct intent.
                  if (resultLayer === null && rows.length > 0) {
                    const first = rows[0].getBoundingClientRect();
                    const last = rows[rows.length - 1].getBoundingClientRect();
                    if (ev.clientY < first.top) {
                      resultLayer = parseInt(rows[0].getAttribute('data-track-layer') || '0', 10);
                      resultSide = 'above';
                    } else if (ev.clientY > last.bottom) {
                      resultLayer = parseInt(rows[rows.length - 1].getAttribute('data-track-layer') || '0', 10);
                      resultSide = 'below';
                    }
                  }
                  return { layer: resultLayer, side: resultSide };
                };

                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dy = ev.clientY - startY;

                  if (mode === 'undecided') {
                    const adx = Math.abs(dx);
                    const ady = Math.abs(dy);
                    if (adx < THRESHOLD && ady < THRESHOLD) return;
                    // Audio rows can only move in time (they live in their own section).
                    if (el.type === 'audio') {
                      mode = 'time';
                      setTimeDragId(el.id);
                    } else {
                      mode = ady > adx ? 'layer' : 'time';
                      if (mode === 'layer') setLayerDragId(el.id);
                      else setTimeDragId(el.id);
                    }
                  }

                  if (mode === 'time') {
                    const dt = (dx / container.clientWidth) * timelineDuration;
                    const raw = Math.max(0, origStart + dt);
                    // ISSUE K — Pass selfDuration so snapTime can also snap the clip's
                    // END edge. That makes "pushing Video 2 flush against Video 1"
                    // magnetic at both ends of the clip, like CapCut.
                    const snap = snapTime(raw, el.id, el.duration);
                    // BATCH 6 fix — Block same-row overlap. The dragged clip
                    // (or the whole selection) cannot cross into another clip
                    // on the same layer; it wedges against the nearest edge.
                    // Audio lives on its own track so it's untouched here.
                    let resolved = snap.time;
                    if (el.type !== 'audio') {
                      const exclude = new Set(groupIds);
                      resolved = clampStartInLayer(el.layer || 0, snap.time, el.duration, exclude);
                    }
                    const appliedDelta = resolved - origStart;
                    const latest = elementsRef.current;
                    history.push(
                      latest.map((e2) => {
                        if (!groupIds.includes(e2.id)) return e2;
                        const os = origStarts.get(e2.id) ?? e2.startTime;
                        return { ...e2, startTime: Math.max(0, os + appliedDelta) };
                      })
                    );
                    // Only show the snap indicator when snap actually held after
                    // the overlap clamp — otherwise the magenta line flashes on
                    // every pixel even though the clip is wedged and immobile.
                    if (snap.snapped && Math.abs(resolved - snap.time) < 0.02) {
                      setTimelineSnap({ time: snap.time, color: snap.color, label: snap.label });
                    } else {
                      setTimelineSnap(null);
                    }
                    setTrimTooltip({ x: ev.clientX, start: resolved, end: resolved + el.duration, dur: el.duration });
                    // ISSUE K — Auto-scroll the timeline container while dragging
                    // near its left/right edges, so a clip can be dragged past the
                    // currently-visible window without first scrolling manually.
                    const scrollEl = timelineContainerRef.current;
                    if (scrollEl) {
                      const rect = scrollEl.getBoundingClientRect();
                      const EDGE = 48;
                      if (ev.clientX < rect.left + EDGE) {
                        scrollEl.scrollLeft -= Math.max(2, (rect.left + EDGE - ev.clientX) / 3);
                      } else if (ev.clientX > rect.right - EDGE) {
                        scrollEl.scrollLeft += Math.max(2, (ev.clientX - (rect.right - EDGE)) / 3);
                      }
                    }
                  } else if (mode === 'layer') {
                    // ISSUE H — Layer-drag hit-tests TRACK ROWS (multi-clip), not individual
                    // clips. A track row may contain many clips but belongs to a single
                    // layer value. We also compute horizontal delta so the user can drag
                    // diagonally and land at a specific time on the target row.
                    // ISSUE J — Instead of a red ✕ (which looked like "delete"), we
                    // preview the RESOLVED landing position (resolveOverlap auto-snaps
                    // forward past conflicting clips). The preview rectangle shown
                    // in the target row makes the snap behavior self-documenting.
                    const hit = hitTestTrack(ev);
                    const dt = (dx / container.clientWidth) * timelineDuration;
                    const requestedStart = Math.max(0, origStart + dt);
                    let landingStart: number | undefined;
                    let snappedForward = false;
                    if (hit.side === 'merge' && hit.layer !== null) {
                      landingStart = resolveOverlap(el.id, hit.layer, requestedStart, el.duration);
                      snappedForward = landingStart > requestedStart + 0.05;
                    }
                    setMergeDropLayer(hit.layer);
                    setLayerDropSide(hit.layer !== null ? hit.side : null);
                    const label = el.type === 'text'
                      ? (el.text?.slice(0, 18) || 'Text')
                      : el.src?.split('/').pop()?.slice(0, 18) || el.type;
                    setLayerDragGhost({
                      x: ev.clientX,
                      y: ev.clientY,
                      label,
                      landingStart,
                      landingDuration: el.duration,
                      snappedForward,
                    });
                  }
                };

                const onUp = (ev: MouseEvent) => {
                  if (mode === 'layer') {
                    // Recompute the drop target one last time so a fast release still lands.
                    const hit = hitTestTrack(ev);
                    if (hit.layer !== null) {
                      if (hit.side === 'merge') {
                        // Land on the same row, at the (time-dragged) requested start,
                        // auto-shifting forward past any overlapping clip.
                        const dx2 = ev.clientX - startX;
                        const dt2 = (dx2 / container.clientWidth) * timelineDuration;
                        const requestedStart = Math.max(0, origStart + dt2);
                        moveClipToLayer(el.id, hit.layer, requestedStart);
                      } else {
                        // Create a new layer above/below the target track. We do NOT
                        // early-return when hit.layer === el.layer: if there are OTHER
                        // clips on the same layer, this splits the dragged clip off
                        // to its own (new) adjacent layer. If there's no other clip
                        // to anchor to, moveClipRelativeToLayer silently no-ops.
                        moveClipRelativeToLayer(el.id, hit.layer, hit.side);
                      }
                    }
                  }
                  setLayerDragId(null);
                  setTimeDragId(null);
                  setLayerDropSide(null);
                  setLayerDragGhost(null);
                  setMergeDropLayer(null);
                  setTimelineSnap(null);
                  setTrimTooltip(null);
                  // ISSUE J — restore the previous user-select value once the drag ends
                  document.body.style.userSelect = prevUserSelect;
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }

              function handleTrimLeft(e: React.MouseEvent) {
                e.stopPropagation();
                e.preventDefault();
                const prevUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
                const startX = e.clientX;
                const origStart = el.startTime;
                const origDur = el.duration;
                // FIX — preserve sourceOffset semantics. Left-trim advances the
                // clip's start on the timeline AND skips that many seconds of
                // the SOURCE media (otherwise the "cropped" silence still
                // plays — which was the user-reported latency bug).
                const origSrcOffset = el.sourceOffset || 0;
                // Can't drag the left handle earlier than the start of the
                // source file: origStart - origSrcOffset is the absolute
                // timeline time at which the source would play from 0.
                const minStart = Math.max(0, origStart - origSrcOffset);
                const container = e.currentTarget.closest('[data-timeline-track]') as HTMLElement;
                if (!container) { document.body.style.userSelect = prevUserSelect; return; }
                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dt = (dx / container.clientWidth) * timelineDuration;
                  const rawStart = Math.max(minStart, origStart + dt);
                  const snap = snapTime(rawStart, el.id);
                  // Re-clamp the snapped target to minStart in case snapping
                  // pulled us below the "source-start" floor.
                  let clampedStart = Math.max(minStart, snap.time);
                  // BATCH 6 fix — Can't pull the left handle past a prior
                  // clip on the same row. Find the latest clip whose end
                  // lands before origStart on this layer and treat that end
                  // as the new lower bound. Audio lives in its own track.
                  if (el.type !== 'audio') {
                    const others = elementsRef.current.filter(
                      (o) => o.id !== el.id && o.type !== 'audio' && (o.layer || 0) === (el.layer || 0),
                    );
                    const origEnd = origStart + origDur;
                    // Any clip whose END would cross into our current window
                    // is a blocker — we can only shrink up to its end edge.
                    const blocker = others
                      .filter((o) => o.startTime + o.duration <= origEnd && o.startTime + o.duration > clampedStart)
                      .sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
                    if (blocker) {
                      clampedStart = Math.max(clampedStart, blocker.startTime + blocker.duration);
                    }
                  }
                  const delta = clampedStart - origStart;              // signed
                  const newDur = Math.max(0.5, origDur - delta);
                  const newSrcOffset = Math.max(0, origSrcOffset + delta);
                  commitUpdate(el.id, {
                    startTime: clampedStart,
                    duration: newDur,
                    sourceOffset: newSrcOffset,
                  });
                  if (snap.snapped && Math.abs(clampedStart - snap.time) < 0.02) {
                    setTimelineSnap({ time: snap.time, color: snap.color, label: snap.label });
                  } else {
                    setTimelineSnap(null);
                  }
                  setTrimTooltip({ x: ev.clientX, start: clampedStart, end: clampedStart + newDur, dur: newDur });
                };
                const onUp = () => { setTimelineSnap(null); setTrimTooltip(null); document.body.style.userSelect = prevUserSelect; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
              }

              function handleTrimRight(e: React.MouseEvent) {
                e.stopPropagation();
                e.preventDefault();
                const prevUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
                const startX = e.clientX; const origDur = el.duration;
                const container = e.currentTarget.closest('[data-timeline-track]') as HTMLElement;
                if (!container) { document.body.style.userSelect = prevUserSelect; return; }
                // ISSUE O + FIX — for video/audio clips with a known source
                // length, clamp the new duration at the remaining source
                // (mediaDuration − sourceOffset) so a left-trimmed clip can
                // never be stretched past what's actually left in the source.
                const srcOffset = el.sourceOffset || 0;
                const mediaCap = (
                  (el.type === 'video' || el.type === 'audio') &&
                  Number.isFinite(el.mediaDuration as number) &&
                  (el.mediaDuration as number) > 0
                )
                  ? Math.max(0.5, (el.mediaDuration as number) - srcOffset)
                  : Infinity;
                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dt = (dx / container.clientWidth) * timelineDuration;
                  const rawDur = Math.max(0.5, Math.min(mediaCap, origDur + dt));
                  const rawEnd = el.startTime + rawDur;
                  const snap = snapTime(rawEnd, el.id);
                  // Post-snap we may have drifted slightly above the cap — clamp again.
                  let newDur = Math.max(0.5, Math.min(mediaCap, snap.time - el.startTime));
                  // BATCH 6 fix — Can't stretch the right handle into a later
                  // clip on the same row. Find the nearest clip on this layer
                  // whose startTime is after ours and cap the new duration at
                  // that boundary. Audio lives in its own track.
                  if (el.type !== 'audio') {
                    const nextOnRow = elementsRef.current
                      .filter(
                        (o) => o.id !== el.id && o.type !== 'audio' &&
                          (o.layer || 0) === (el.layer || 0) &&
                          o.startTime >= el.startTime + origDur - 0.001,
                      )
                      .sort((a, b) => a.startTime - b.startTime)[0];
                    if (nextOnRow) {
                      const maxDur = Math.max(0.5, nextOnRow.startTime - el.startTime);
                      newDur = Math.min(newDur, maxDur);
                    }
                  }
                  commitUpdate(el.id, { duration: newDur });
                  // Only show the snap indicator if the snap actually held after
                  // the cap clamp (otherwise it'd flash even when we're sitting
                  // on the mediaCap edge, which is confusing UX).
                  const clampedEnd = el.startTime + newDur;
                  if (snap.snapped && Math.abs(clampedEnd - snap.time) < 0.02) {
                    setTimelineSnap({ time: snap.time, color: snap.color, label: snap.label });
                  } else if (mediaCap !== Infinity && newDur >= mediaCap - 0.02) {
                    // At the media-duration ceiling — show a red indicator so the
                    // user understands why the handle stopped moving.
                    setTimelineSnap({ time: clampedEnd, color: 'rgba(239,68,68,0.9)', label: 'Source end' });
                  } else {
                    setTimelineSnap(null);
                  }
                  setTrimTooltip({ x: ev.clientX, start: el.startTime, end: clampedEnd, dur: newDur });
                };
                const onUp = () => { setTimelineSnap(null); setTrimTooltip(null); document.body.style.userSelect = prevUserSelect; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
              }

              const clipLabel = el.type === 'text'
                ? (el.text?.slice(0, 12) || 'Text')
                : el.type === 'audio'
                  ? 'Audio'
                  : el.src?.split('/').pop()?.slice(0, 10) || el.type;
              const isLayerDragging = layerDragId === el.id;
              const isTimeDragging = timeDragId === el.id;
              const isDragging = isLayerDragging || isTimeDragging;

              // ISSUE H — "bare" mode: this clip lives inside a multi-clip track
              // row. The outer row wrapper, insertion-line visuals, track up/down
              // arrows, and merge highlight are all rendered by the parent track
              // row (see the main render loop). Here we only emit the absolutely
              // positioned clip bar (trim handles + body) so multiple clips on
              // the same layer can coexist on one row without nesting data-*.
              const clipBar = (
                <div
                  key={el.id}
                  data-clip-id={el.id}
                  data-clip-kind={el.type}
                  className={cn(
                    'absolute h-full',
                    // ISSUE K — Idle clips ease into their new position (post-snap settle,
                    // post-undo, post-paste, …) for a fluid feel. The clip currently being
                    // dragged uses no transition so it tracks the cursor 1:1.
                    !isDragging && 'transition-[left,width,opacity,transform] duration-150 ease-out',
                    // Layer-drag: clip becomes a visual ghost (we're previewing a row change)
                    isLayerDragging && 'opacity-30 scale-[0.97]',
                    // Time-drag: clip stays bright + lifts above its neighbors + tiny scale up
                    isTimeDragging && 'z-50 scale-[1.02] ring-2 ring-white/70 shadow-lg',
                  )}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 2)}%`,
                    willChange: isDragging ? 'left, width' : undefined,
                  }}
                  role="group"
                  aria-label={`${el.type} clip`}
                >
                  {/* ISSUE P (v2) — Body is now FULL-WIDTH so two back-to-back clips
                      literally touch. Trim handles sit on TOP of the body with a
                      higher z-index; they're still 2px wide and reveal a subtle
                      white overlay on hover (hover:bg-white/40). This removes the
                      residual 16-px gap from `left-2 right-2` in the previous impl. */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Move ${clipLabel} clip`}
                    className="absolute left-0 right-0 top-0 bottom-0 cursor-grab active:cursor-grabbing z-10"
                    onMouseDown={handleClipDrag}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(el.id)) next.delete(el.id); else next.add(el.id);
                          return next;
                        });
                        setSelectedId(el.id);
                      } else {
                        setSelectedId(el.id);
                        setSelectedIds(new Set([el.id]));
                        setCurrentTime(el.startTime);
                      }
                    }}
                  >
                    {/* ISSUE S — Premium polish: 5 px rounded corners and a
                        subtle 1 px border (white at low opacity for the color
                        tracks) so each clip carries a refined, "démarcation
                        très légère" between neighbours without being loud. */}
                    <div className={cn(
                      'relative w-full h-full text-white text-[9px] font-medium flex items-center gap-1 px-1.5 truncate overflow-hidden rounded-[5px] border border-white/20 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]',
                      trackColors[el.type],
                      selectedIds.has(el.id) && 'ring-2 ring-inset ring-white brightness-125 shadow-lg',
                      selectedId === el.id && !selectedIds.has(el.id) && 'ring-2 ring-inset ring-white',
                    )}>
                      {/* ISSUE — Thumbnail first-frame for video clips (auto-captured at import).
                          Sits as a faint background layer so the filename + icon stay readable. */}
                      {el.type === 'video' && el.thumbnailUrl && (
                        <div
                          className="absolute inset-0 bg-center bg-cover opacity-60 pointer-events-none"
                          style={{ backgroundImage: `url(${el.thumbnailUrl})` }}
                          aria-hidden="true"
                        />
                      )}
                      <Icon className="h-3 w-3 shrink-0 relative" />
                      <span className="truncate relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{clipLabel}</span>
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Trim start of ${clipLabel}`}
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-white/40"
                    onMouseDown={handleTrimLeft}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Trim end of ${clipLabel}`}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-20 hover:bg-white/40"
                    onMouseDown={handleTrimRight}
                  />
                </div>
              );

              // Bare mode → just the clip bar. The parent track row provides
              // data-timeline-track (so handleTrimLeft/Right's closest() finds a
              // width-bearing container) and data-track-layer (for layer hit-testing).
              if (bare) return clipBar;

              // Full-row mode (audio): this clip owns its own row. We give it
              // both data-timeline-track and, by convention, data-track-layer=0
              // so any future unified hit-testing still works, but audio rows
              // are filtered out server-side via data-clip-kind="audio".
              return (
                <div
                  key={el.id}
                  data-timeline-track
                  className="relative h-7 group transition-[background-color,box-shadow] duration-150 ease-out"
                  role="group"
                  aria-label={`${el.type} clip`}
                >
                  {clipBar}
                </div>
              );
            }

            // FEATURE T + ISSUE 1 — Timeline width uses effectiveZoom (auto by default,
            // manual when the user opts in). Auto-fit sizes the timeline to match the
            // container so nothing overflows. Manual mode lets the user zoom past that.
            const timelineWidthPx = timelineDuration * 30 * effectiveZoom;
            // Tick density adapts to zoom: every 0.25s at high zoom, every 1s at normal, every 5s at very zoomed-out.
            const tickStep = effectiveZoom >= 2 ? 0.25 : effectiveZoom >= 0.6 ? 1 : effectiveZoom >= 0.25 ? 5 : 10;
            const tickCount = Math.floor(timelineDuration / tickStep) + 1;
            return (
              <div
                ref={timelineContainerRef}
                className="space-y-1 relative overflow-x-auto pl-10 select-none"
                style={{ minWidth: 0 }}
                onWheel={(e) => {
                  // ISSUE K — CapCut-style cursor-anchored zoom: the time UNDER THE CURSOR
                  // stays put as the timeline grows/shrinks, so users can keep their place
                  // when zooming. Shift+wheel still pans horizontally; pure horizontal
                  // trackpad gestures fall through to the browser's overflow-x-auto.
                  if (e.shiftKey) return;
                  if (Math.abs(e.deltaY) < 0.1) return;
                  e.preventDefault();
                  const container = timelineContainerRef.current;
                  if (!container) return;
                  const prevZoom = effectiveZoom;
                  const prevWidth = timelineDuration * 30 * prevZoom;
                  const factor = Math.exp(-e.deltaY * 0.002);
                  const newZoom = Math.max(0.1, Math.min(10, prevZoom * factor));
                  if (Math.abs(newZoom - prevZoom) < 0.001) return;
                  // Compute time under cursor BEFORE zoom changes.
                  const rect = container.getBoundingClientRect();
                  const cursorXInContent = e.clientX - rect.left + container.scrollLeft - 40; // pl-10 inner offset
                  const cursorTime = (cursorXInContent / Math.max(1, prevWidth)) * timelineDuration;
                  const newWidth = timelineDuration * 30 * newZoom;
                  const newCursorX = (cursorTime / timelineDuration) * newWidth + 40;
                  const newScrollLeft = newCursorX - (e.clientX - rect.left);
                  setTimelineZoom(newZoom);
                  setZoomMode('manual');
                  // Defer the scroll-correction one frame so React commits the new width first.
                  requestAnimationFrame(() => {
                    if (timelineContainerRef.current) {
                      timelineContainerRef.current.scrollLeft = Math.max(0, newScrollLeft);
                    }
                  });
                }}
              >
                {/* ISSUE C — This inner wrapper must be `position: relative` so that
                    `position: absolute` children (the snap indicator, the ruler's
                    playhead, etc.) resolve their % offsets against the wrapper's width
                    (= timelineWidthPx). Without it they'd resolve against the outer
                    scroll container — whose width is the viewport, not the timeline —
                    causing the snap indicator to drift off the actual clip edges when
                    the timeline is scrollable or zoomed. */}
                <div className="relative" style={{ width: timelineWidthPx, minWidth: '100%' }}>
                {/* Ruler with ticks — ISSUE J: click/drag to scrub; select-none so
                    the 0s/5s/10s labels never highlight when the user drags a clip
                    slightly too high and crosses over the ruler. */}
                <div
                  className="h-5 relative border-b select-none cursor-pointer"
                  style={{ minWidth: '100%' }}
                  onMouseDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const applyFromClientX = (x: number) => {
                      const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
                      setCurrentTime(pct * timelineDuration);
                    };
                    applyFromClientX(e.clientX);
                    const onMove = (ev: MouseEvent) => applyFromClientX(ev.clientX);
                    const onUp = () => {
                      document.removeEventListener('mousemove', onMove);
                      document.removeEventListener('mouseup', onUp);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                >
                  {Array.from({ length: tickCount }).map((_, i) => {
                    const t = i * tickStep;
                    const isMajor = tickStep >= 1 ? true : t % 1 === 0;
                    return (
                      <div key={i} className="absolute pointer-events-none" style={{ left: `${(t / timelineDuration) * 100}%` }}>
                        <div className={cn('w-px bg-gray-300', isMajor ? 'h-3' : 'h-1.5')} style={{ marginTop: isMajor ? 0 : 6 }} />
                        {isMajor && <span className="absolute top-0 text-[7px] text-muted-foreground select-none" style={{ transform: 'translateX(-50%)' }}>{t}s</span>}
                      </div>
                    );
                  })}
                </div>
                {/* ISSUE J — Unified playhead: spans ruler + every track row so the
                    play-position line is visually continuous (and therefore aligned
                    with both the ruler's seconds and the scrubber's thumb below). */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none"
                  style={{ left: `${(currentTime / timelineDuration) * 100}%` }}
                >
                  <div className="absolute -top-0.5 -left-1 w-2 h-2 rotate-45 bg-red-500 shadow-sm" />
                </div>
                {/* ISSUE K — Magnetic snap indicator (CapCut-style). Full-height vertical
                    guide that spans ruler + all tracks, glows, and shows what it's
                    snapping to (Playhead / 0s / Clip start/end). The label sits above
                    the ruler so it never occludes the clip being dragged. */}
                {timelineSnap && (
                  <div
                    className="absolute top-0 bottom-0 z-50 pointer-events-none"
                    style={{
                      left: `${(timelineSnap.time / timelineDuration) * 100}%`,
                      width: 2,
                      backgroundColor: timelineSnap.color,
                      boxShadow: `0 0 8px ${timelineSnap.color}, 0 0 2px ${timelineSnap.color}`,
                      transition: 'left 60ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <div
                      className="absolute -top-5 text-[8px] px-1.5 py-0.5 rounded-sm font-medium text-white whitespace-nowrap shadow-md"
                      style={{ backgroundColor: timelineSnap.color, transform: 'translateX(-50%)' }}
                    >
                      {timelineSnap.label} · {timelineSnap.time.toFixed(2)}s
                    </div>
                  </div>
                )}

                {/* Visual layers — top = foreground. ISSUE H: clips grouped by
                    `layer` render on the SAME track row. Each row has
                    data-track-layer for drag hit-testing.
                    ISSUE P — rows touch (space-y-0), so two clips on adjacent layers
                    sit flush against each other. A tiny inner border on the row
                    (via the ring-inset on the clip) preserves the visual boundary. */}
                {visualTracks.length > 0 && (
                  <div className="space-y-0">
                    {visualTracks.map((track, trackIdx) => {
                      const isMergeHit = layerDragId
                        && layerDragId !== null
                        && mergeDropLayer === track.layer
                        && layerDropSide === 'merge';
                      const isAboveHit = layerDragId
                        && mergeDropLayer === track.layer
                        && layerDropSide === 'above';
                      const isBelowHit = layerDragId
                        && mergeDropLayer === track.layer
                        && layerDropSide === 'below';
                      const canMoveUp = trackIdx > 0;
                      const canMoveDown = trackIdx < visualTracks.length - 1;
                      // ISSUE J — When we're previewing a "merge" drop on THIS row,
                      // render a dashed outlined rectangle at the resolved landing
                      // position so the user can SEE where the clip will end up
                      // (incl. any forward snap past existing clips).
                      const showLandingPreview = isMergeHit
                        && layerDragGhost?.landingStart != null
                        && layerDragGhost?.landingDuration != null;
                      const landingLeft = showLandingPreview
                        ? (layerDragGhost!.landingStart! / timelineDuration) * 100
                        : 0;
                      const landingWidth = showLandingPreview
                        ? (layerDragGhost!.landingDuration! / timelineDuration) * 100
                        : 0;
                      return (
                        <div
                          key={`track-${track.layer}`}
                          data-timeline-track
                          data-track-layer={track.layer}
                          className={cn(
                            'relative h-7 group transition-[background-color,box-shadow] duration-150 ease-out',
                            isMergeHit && 'bg-blue-500/10 rounded ring-2 ring-blue-500/60',
                          )}
                        >
                          {/* ISSUE J — Landing preview for merge drop. Shown on the
                              target row at resolveOverlap()'s output position. */}
                          {showLandingPreview && (
                            <div
                              aria-hidden
                              className="absolute top-0.5 bottom-0.5 pointer-events-none rounded border-2 border-dashed border-blue-500 bg-blue-500/20 z-30"
                              style={{ left: `${landingLeft}%`, width: `${Math.max(landingWidth, 2)}%` }}
                            />
                          )}
                          {/* ISSUE D/H — Prominent insertion line for NEW-layer drop */}
                          {isAboveHit && (
                            <div
                              aria-hidden
                              className="absolute -top-0.5 left-0 right-0 h-1 bg-blue-500 z-40 pointer-events-none rounded-full shadow-[0_0_6px_rgba(59,130,246,0.8)]"
                            >
                              <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                            </div>
                          )}
                          {isBelowHit && (
                            <div
                              aria-hidden
                              className="absolute -bottom-0.5 left-0 right-0 h-1 bg-blue-500 z-40 pointer-events-none rounded-full shadow-[0_0_6px_rgba(59,130,246,0.8)]"
                            >
                              <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-500" />
                            </div>
                          )}
                          {/* Per-track layer arrows (left gutter). Swap the whole
                              row with the adjacent one in a single click — avoids
                              moving clips one-by-one. */}
                          <div className="absolute -left-6 top-0 bottom-0 flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            <div className="flex flex-col justify-center gap-px">
                              <button
                                aria-label="Move track up (toward foreground)"
                                title="Move track up (foreground)"
                                disabled={!canMoveUp}
                                onClick={(e) => { e.stopPropagation(); moveTrackUp(track.layer); }}
                                className={cn('w-5 h-3 flex items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground', !canMoveUp && 'opacity-30 cursor-not-allowed')}
                              ><ChevronUp className="h-2.5 w-2.5" /></button>
                              <button
                                aria-label="Move track down (toward background)"
                                title="Move track down (background)"
                                disabled={!canMoveDown}
                                onClick={(e) => { e.stopPropagation(); moveTrackDown(track.layer); }}
                                className={cn('w-5 h-3 flex items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground', !canMoveDown && 'opacity-30 cursor-not-allowed')}
                              ><ChevronDown className="h-2.5 w-2.5" /></button>
                            </div>
                          </div>
                          {track.clips.map((clip) => renderClipRow(clip, true))}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Audio track — separate section, below visual layers */}
                {audioElements.length > 0 && (
                  <>
                    <div className="flex items-center gap-1 pt-2 pb-0.5 text-[8px] text-muted-foreground uppercase tracking-wide font-medium border-t border-dashed mt-1">
                      <Music className="h-2.5 w-2.5" />Audio
                    </div>
                    <div className="space-y-0">
                      {audioElements.map((el) => renderClipRow(el))}
                    </div>
                  </>
                )}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {/* Delete confirmation — project (Ergo #11) */}
      <Dialog open={deleteProjectId !== null} onOpenChange={(open) => { if (!open) setDeleteProjectId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This will permanently delete {projects.find((p) => p.id === deleteProjectId)?.name || 'this project'} and all its content. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteProjectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteProjectId && confirmDeleteProject(deleteProjectId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — element (Ergo #11) */}
      <Dialog open={deleteElementId !== null} onOpenChange={(open) => { if (!open) setDeleteElementId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this element?</DialogTitle>
            <DialogDescription>
              {(() => {
                const el = elements.find((e) => e.id === deleteElementId);
                if (!el) return 'This element will be removed from the timeline.';
                const label = el.type === 'text' ? `"${(el.text || '').slice(0, 40)}"` : el.type;
                return `This will remove the ${label} ${el.type === 'text' ? 'text' : 'clip'} from the timeline. You can undo with ⌘Z.`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteElementId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (deleteElementId) commitRemove(deleteElementId);
              setDeleteElementId(null);
            }}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ISSUE R — Compose + Send to Preview dialog */}
      <Dialog
        open={composeOpen}
        onOpenChange={(open) => {
          // Block close while render is in-flight so the user doesn't abort
          // mid-stream (MediaRecorder state would be corrupted).
          if (!open && (composeStep.phase === 'vertical' || composeStep.phase === 'portrait')) return;
          setComposeOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Render final video for Preview</DialogTitle>
            <DialogDescription>
              Exports the fully composed timeline — all tracks, effects and
              audio — to a single 1080p video for both aspect ratios (9:16
              and 4:5). Takes a few seconds longer than the total duration
              because rendering runs in real time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {composeStep.phase === 'idle' && (
              <div className="text-sm text-muted-foreground">
                Click <span className="font-medium">Render</span> to start.
                You can keep this tab focused while the render runs.
              </div>
            )}
            {(composeStep.phase === 'vertical' || composeStep.phase === 'portrait') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {composeStep.phase === 'vertical' ? '9:16 (1080 × 1920)' : '4:5 (1080 × 1350)'}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {Math.round(composeStep.progress * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-[width] duration-150"
                    style={{ width: `${Math.round(composeStep.progress * 100)}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Recording — please don't switch tabs.
                </div>
              </div>
            )}
            {composeStep.phase === 'done' && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-green-700">
                  Render complete — both formats ready.
                </div>
                {(['vertical', 'portrait'] as const).map((fmt) => {
                  const out = composedOutputs[fmt];
                  if (!out) return null;
                  return (
                    <div key={fmt} className="flex items-center justify-between rounded border p-2">
                      <div className="text-xs">
                        <div className="font-medium">
                          {fmt === 'vertical' ? '9:16 Vertical' : '4:5 Portrait'}
                        </div>
                        <div className="text-muted-foreground">
                          {(out.blob.size / 1024 / 1024).toFixed(1)} MB
                        </div>
                      </div>
                      <a
                        href={out.url}
                        download={`ad-${fmt}-1080p.webm`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        Download
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
            {composeStep.phase === 'error' && (
              <div className="text-sm text-red-600">
                Render failed: {composeStep.error || 'unknown error'}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {composeStep.phase === 'idle' && (
              <>
                <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
                <Button
                  onClick={async () => {
                    // Kick off the two renders sequentially. We reuse the
                    // current elements snapshot via elementsRef so the
                    // composer sees whatever is on the timeline right now.
                    const snapshot = elementsRef.current.map((el) => ({ ...el }));
                    const activeProject = projects.find((p) => p.id === activeId);
                    const projectId = activeProject?.id ?? activeId;
                    const projectName = activeProject?.name ?? `Ad ${activeId ?? ''}`;
                    try {
                      setComposedOutputs({});
                      setComposeStep({ phase: 'vertical', progress: 0 });
                      const verticalBlob = await composeVideo({
                        elements: snapshot as any,
                        format: 'vertical',
                        onProgress: (p) => setComposeStep({ phase: 'vertical', progress: p }),
                      });
                      const verticalUrl = URL.createObjectURL(verticalBlob);
                      setComposedOutputs((prev) => ({ ...prev, vertical: { url: verticalUrl, blob: verticalBlob } }));

                      setComposeStep({ phase: 'portrait', progress: 0 });
                      const portraitBlob = await composeVideo({
                        elements: snapshot as any,
                        format: 'portrait',
                        onProgress: (p) => setComposeStep({ phase: 'portrait', progress: p }),
                      });
                      const portraitUrl = URL.createObjectURL(portraitBlob);
                      setComposedOutputs((prev) => ({ ...prev, portrait: { url: portraitUrl, blob: portraitBlob } }));

                      // ISSUE T + X — Persist both renders in IndexedDB keyed
                      // by (projectId, format) so the Preview panel can
                      // rehydrate them after a reload, and so rendering a new
                      // project doesn't overwrite previously composed ones.
                      // The thumbnail is sampled from the vertical output
                      // (the primary format shown on Preview cards).
                      if (projectId != null) {
                        try {
                          console.log('[compose] → calling captureThumbnailFromUrl', {
                            verticalUrl: verticalUrl.slice(0, 80),
                            verticalBlobSize: verticalBlob.size,
                            portraitBlobSize: portraitBlob.size,
                          });
                          const thumb = await captureThumbnailFromUrl(verticalUrl);
                          console.log('[compose] ← captureThumbnailFromUrl returned', {
                            thumbPresent: !!thumb,
                            thumbLength: thumb?.length,
                          });
                          const now = Date.now();
                          // Batch 6 — the editor always composes the source-
                          // language (EN) version. Per-language renders are
                          // spawned lazily from PreviewSendPanel with
                          // composeVideo({ textOverrides }).
                          await putComposedEntry({
                            key: composedKey(projectId, 'vertical', 'en'),
                            productId,
                            projectId,
                            projectName,
                            format: 'vertical',
                            languageCode: 'en',
                            blob: verticalBlob,
                            size: verticalBlob.size,
                            thumbnailDataUrl: thumb ?? undefined,
                            mimeType: verticalBlob.type || undefined,
                            createdAt: now,
                          });
                          await putComposedEntry({
                            key: composedKey(projectId, 'portrait', 'en'),
                            productId,
                            projectId,
                            projectName,
                            format: 'portrait',
                            languageCode: 'en',
                            blob: portraitBlob,
                            size: portraitBlob.size,
                            thumbnailDataUrl: thumb ?? undefined,
                            mimeType: portraitBlob.type || undefined,
                            createdAt: now,
                          });
                        } catch (storeErr: any) {
                          // FIX 10 — Surface IndexedDB persist failures so a
                          // quota error (common when many HD renders pile up)
                          // doesn't silently vanish the just-rendered video.
                          // Without this toast, the Editor reports "render
                          // success" but Preview shows nothing because the
                          // blob never reached storage.
                          console.error('[compose] persist failed', storeErr);
                          toast({
                            title: 'Render saved to preview only',
                            description:
                              (storeErr?.message || 'IndexedDB write failed') +
                              ' — try deleting older renders to free space.',
                            variant: 'destructive',
                          });
                        }
                      }

                      setComposeStep({ phase: 'done', progress: 1 });
                      // Hand the composed outputs to the parent (AdsCreatorWorkspace)
                      // so Preview shows them instead of raw clips. The parent
                      // rehydrates from IndexedDB on mount as well, so this
                      // in-memory payload is only needed for immediate display.
                      onExport?.({
                        projectId,
                        projectName,
                        composed: {
                          vertical: { url: verticalUrl, blob: verticalBlob },
                          portrait: { url: portraitUrl, blob: portraitBlob },
                        },
                      });
                    } catch (err: any) {
                      console.error('[compose] failed', err);
                      setComposeStep({ phase: 'error', progress: 0, error: err?.message || String(err) });
                      toast({ title: 'Render failed', description: err?.message, variant: 'destructive' });
                    }
                  }}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Render
                </Button>
              </>
            )}
            {composeStep.phase === 'done' && (
              <Button onClick={() => setComposeOpen(false)}>Done</Button>
            )}
            {composeStep.phase === 'error' && (
              <Button variant="outline" onClick={() => setComposeStep({ phase: 'idle', progress: 0 })}>Retry</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── formatRelative — "Saved 3s ago" / "Saved 2m ago" ──
function formatRelative(ts: number): string {
  const elapsed = Math.floor((Date.now() - ts) / 1000);
  if (elapsed < 5) return 'just now';
  if (elapsed < 60) return `${elapsed}s ago`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ── ZoomEffectLayer ──
// ISSUE Q — A wrapper DIV whose `transform` is animated via a rAF loop that
// writes directly to the DOM node's style. This decouples the zoom/pan/rotate
// animation from React re-renders, which is why the effect was previously
// only visible when the user scrubbed the timeline (React was not re-rendering
// the inner `<video>`/`<img>` during normal playback because parent state
// updates were throttled / batched). The rAF loop here fires every frame
// while `playing` is true and when stopped derives the one-shot transform from
// `currentTime`, so scrubbing still tracks the playhead precisely.
function ZoomEffectLayer({
  startTime, duration, zoomEffect, zoomIntensity, rotation,
  playing, currentTime, children,
}: {
  startTime: number;
  duration: number;
  zoomEffect?: ZoomEffect;
  zoomIntensity?: number;
  rotation?: number;
  playing: boolean;
  currentTime: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Keep latest values in refs so the rAF loop always reads fresh props
  // without having to restart on every change.
  const propsRef = useRef({ startTime, duration, zoomEffect, zoomIntensity, rotation });
  propsRef.current = { startTime, duration, zoomEffect, zoomIntensity, rotation };

  // Compute the CSS transform for a given absolute timeline time.
  const computeTransform = useCallback((absTime: number) => {
    const { startTime: st, duration: dur, zoomEffect: ze, zoomIntensity: zi, rotation: rot } = propsRef.current;
    const elapsed = Math.max(0, absTime - st);
    const progress = dur > 0 ? Math.max(0, Math.min(1, elapsed / dur)) : 0;
    const intensity = Math.max(0, Math.min(1, zi ?? 0.2));
    const rotDeg = rot || 0;

    let scale = 1;
    let tx = 0;
    let ty = 0;
    switch (ze) {
      case 'zoom-in':
        // 1.0 → 1 + intensity over the clip
        scale = 1 + intensity * progress;
        break;
      case 'zoom-out':
        // 1 + intensity → 1.0 over the clip
        scale = 1 + intensity * (1 - progress);
        break;
      case 'ken-burns': {
        // Smooth zoom-in with a diagonal pan (upper-left → lower-right feel).
        // Intensity controls both zoom depth and pan distance.
        scale = 1 + intensity * progress;
        // Pan amount in CSS pixels of the wrapper (transform origin = center).
        // We translate in percent of the container to stay resolution-agnostic.
        tx = (intensity * 50) * (progress - 0.5); // -50% * intensity to +50% * intensity
        ty = (intensity * 30) * (progress - 0.5);
        break;
      }
      case 'none':
      default:
        scale = 1;
        break;
    }

    const parts: string[] = [];
    if (tx || ty) parts.push(`translate(${tx}%, ${ty}%)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    if (rotDeg) parts.push(`rotate(${rotDeg}deg)`);
    return parts.length > 0 ? parts.join(' ') : '';
  }, []);

  // Apply the transform to the DOM node directly (no React re-render).
  const applyTransform = useCallback((absTime: number) => {
    const node = ref.current;
    if (!node) return;
    node.style.transform = computeTransform(absTime);
  }, [computeTransform]);

  // Re-apply the transform every time a zoom/rotation prop changes (while
  // paused). Without this, dragging the rotation slider or changing the zoom
  // effect does nothing on the canvas because the rAF loop below only
  // re-runs on [playing, currentTime], and `propsRef` updates are silent.
  useEffect(() => {
    if (playing) return; // rAF loop is the source of truth while playing
    applyTransform(currentTime);
  }, [rotation, zoomEffect, zoomIntensity, startTime, duration, playing, currentTime, applyTransform]);

  // rAF loop: while playing, tick every frame using performance.now() as the
  // real-time clock so we don't depend on React re-rendering currentTime.
  useEffect(() => {
    if (!playing) {
      // Scrubbing or paused: set transform once from the prop and stop.
      applyTransform(currentTime);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Playing: anchor our clock to the latest `currentTime` from React, then
    // advance via performance.now() deltas so intra-frame animation is smooth.
    const started = performance.now();
    const anchor = currentTime;
    const tick = () => {
      const now = performance.now();
      const abs = anchor + (now - started) / 1000;
      applyTransform(abs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, currentTime, applyTransform]);

  return (
    <div
      ref={ref}
      className="w-full h-full"
      style={{
        willChange: 'transform',
        transformOrigin: 'center center',
      }}
    >
      {children}
    </div>
  );
}

// ── SyncedVideo ──
// Bug #2 fix: muted is now a controllable prop (from el.muted), not hard-coded.
// FEATURE W — `reversed`: when true, the video element is kept paused and we
// scrub `currentTime` to (clipDuration − elapsed) on every frame. HTML5 video
// doesn't support negative playbackRate natively, so this scrub pattern is the
// standard workaround. It's slightly choppy on long clips but visually reverses.
function SyncedVideo({ src, playing, elapsed, muted, reversed, clipDuration, style, className, onDurationKnown }: { src: string; playing: boolean; elapsed: number; muted?: boolean; reversed?: boolean; clipDuration?: number; style?: React.CSSProperties; className?: string; onDurationKnown?: (d: number) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    // FIX C — truthy flag: default (undefined/false) == unmuted
    // In reverse mode we force mute (no reversed-audio UX; browsers don't support it anyway).
    ref.current.muted = !!muted || !!reversed;
  }, [muted, reversed]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    if (reversed) {
      // Reverse: always paused, scrub backward. Clamp to valid bounds.
      if (!v.paused) { try { v.pause(); } catch {} }
      const dur = clipDuration ?? v.duration ?? 0;
      if (Number.isFinite(dur) && dur > 0) {
        const target = Math.max(0, Math.min(dur, dur - elapsed));
        if (Math.abs(v.currentTime - target) > 0.05) {
          try { v.currentTime = target; } catch {}
        }
      }
      return;
    }

    if (Math.abs(v.currentTime - elapsed) > 0.3) v.currentTime = elapsed;
    if (playing && v.paused) {
      v.play().catch((err) => {
        // Autoplay blocked (e.g. muted=false + no user gesture) — fall back to muted playback
        if (ref.current && !ref.current.muted) {
          ref.current.muted = true;
          ref.current.play().catch(() => {});
          console.warn('[SyncedVideo] autoplay blocked, retried muted:', err?.message);
        }
      });
    }
    if (!playing && !v.paused) v.pause();
  }, [playing, elapsed, reversed, clipDuration]);
  return (
    <video
      ref={ref}
      src={src}
      className={className}
      style={style}
      playsInline
      muted={!!muted || !!reversed}
      // ISSUE O — safety net: when the video's metadata is parsed inside the
      // canvas, report the real duration up so legacy clips (imported before
      // the probe-at-import code shipped) also get their mediaDuration field
      // populated. The parent debounces duplicate updates.
      onLoadedMetadata={(e) => {
        if (!onDurationKnown) return;
        const d = (e.currentTarget as HTMLVideoElement).duration;
        if (Number.isFinite(d) && d > 0) onDurationKnown(d);
      }}
    />
  );
}

// ── EditableText (Ergo #5 — proper focus via useRef) ──
function EditableText({ el, scale, onCommit }: { el: EditorElement; scale: number; onCommit: (text: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    // Place caret at end
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);
  const style: React.CSSProperties = {
    fontSize: (el.fontSize || 48) * scale,
    color: el.color || '#fff',
    fontFamily: resolveFontStack(el.fontFamily),
    // ISSUE M — honour the chosen font weight (falls back to Bold/700 for
    // existing projects). Cast so TypeScript accepts the numeric weight.
    fontWeight: (el.fontWeight ?? 700) as React.CSSProperties['fontWeight'],
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      el.textAlign === 'left' ? 'flex-start' : el.textAlign === 'right' ? 'flex-end' : 'center',
    textAlign: el.textAlign || 'center',
    outline: '2px dashed #3b82f6',
    outlineOffset: 2,
    cursor: 'text',
    padding: 4 * scale,
  };
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      style={style}
      onBlur={(e) => onCommit(e.currentTarget.textContent || '')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.currentTarget.blur(); }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
      }}
    >
      {el.text || ''}
    </div>
  );
}

// ── Text renderer ──
function renderText(el: EditorElement, scale: number) {
  const fs = (el.fontSize || 48) * scale;
  const align = el.textAlign || 'center';
  const s: React.CSSProperties = {
    fontSize: fs, color: el.color || '#fff', fontFamily: resolveFontStack(el.fontFamily),
    // ISSUE M — apply user-selected weight (falls back to bold 700).
    fontWeight: (el.fontWeight ?? 700) as React.CSSProperties['fontWeight'],
    width: '100%', height: '100%', display: 'flex',
    alignItems: 'center',
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
    textAlign: align,
    padding: 4 * scale,
    wordBreak: 'break-word',
    // FEATURE — custom line-height / letter-spacing. Defaults match the
    // composer (1.2 line-height, 0 letter-spacing) so un-edited text is
    // visually unchanged.
    lineHeight: Math.max(0.9, Math.min(2.0, (el.lineHeight ?? 1.2))),
    letterSpacing: `${Math.max(-0.2, Math.min(0.6, el.letterSpacing ?? 0))}em`,
  };
  if (el.textStyle === 'background') { s.backgroundColor = el.bgColor || '#000'; s.borderRadius = (el.borderRadius || 8) * scale; }
  if (el.textStyle === 'outline') {
    // -webkit-text-stroke paints the stroke both inside and outside the glyph
    // path, which eats into thin strokes and letter counters (visible as
    // strike-through-like marks on "ea", "ia", etc. with the system font).
    // `paint-order: stroke fill` forces the fill to be drawn after the stroke
    // so the outward half shows and the inward half is covered by the fill.
    s.WebkitTextStroke = `${(el.strokeWidth || 2) * scale}px ${el.strokeColor || '#000'}`;
    (s as any).paintOrder = 'stroke fill';
  }
  if (el.textStyle === 'shadow') { const o = (el.shadowOffset || 2) * scale; s.textShadow = `${o}px ${o}px ${(el.shadowBlur || 4) * scale}px rgba(0,0,0,0.8)`; }
  // FIX 4 — text rotation must also apply in the canvas preview (the composer
  // already rotates text via ctx.rotate, so the two stay in sync).
  if (el.rotation) {
    s.transform = `rotate(${el.rotation}deg)`;
    s.transformOrigin = 'center center';
  }
  const displayText = el.text || '';
  return (
    <div style={s}>
      {displayText || <span style={{ opacity: 0.45, fontStyle: 'italic' }}>Double-click to edit</span>}
    </div>
  );
}
