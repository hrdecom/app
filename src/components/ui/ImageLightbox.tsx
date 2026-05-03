import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Minus, Plus, X, RotateCcw } from 'lucide-react';

interface ImageLightboxProps {
  images: { url: string; alt?: string }[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.25;

export function ImageLightbox({ images, index, onClose, onIndexChange }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const current = images[index];

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    reset();
  }, [index, reset]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const next = useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index + 1) % images.length);
  }, [images.length, index, onIndexChange]);

  const prev = useCallback(() => {
    if (images.length <= 1) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [images.length, index, onIndexChange]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + ZOOM_STEP));
      else if (e.key === '-' || e.key === '_') setZoom((z) => clampZoom(z - ZOOM_STEP));
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, next, prev, reset]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => clampZoom(z + delta));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return;
    const { startX, startY, origX, origY } = dragState.current;
    setOffset({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
  };
  const onMouseUp = () => {
    dragState.current = null;
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(current.url, { mode: 'cors' });
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = current.url.split('/').pop()?.split('?')[0] || 'image';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Fallback to direct link (may 403 on cross-origin)
      window.open(current.url, '_blank', 'noopener');
    }
  };

  if (!current) return null;

  // FIX 25e — click on the dark backdrop closes the lightbox. The image
  // itself stops propagation (see <img onClick> below) so clicks on the
  // image don't dismiss; only clicks on the surrounding black area do.
  // We check e.target === e.currentTarget so children that bubble (like
  // the toolbar buttons) don't accidentally trigger close either.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-10">
        <span className="text-white/70 text-sm">
          {images.length > 1 ? `${index + 1} / ${images.length}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="text-white/70 text-xs w-12 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={reset}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Reset"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={handleDownload}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Download"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Prev / Next */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Image */}
      <img
        src={current.url}
        alt={current.alt ?? ''}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        className="select-none max-w-[90vw] max-h-[90vh] object-contain transition-transform will-change-transform"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          cursor: zoom > 1 ? (dragState.current ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
      />
    </div>
  );
}
