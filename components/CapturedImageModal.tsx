'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface CapturedImage {
  url: string;
  timestamp: string;
}

interface CapturedImageModalProps {
  image: CapturedImage;
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const MAX_ZOOM = 10;
const MIN_ZOOM = 0.5;
const ZOOM_STEP = 0.2;

const CapturedImageModal: React.FC<CapturedImageModalProps> = ({
  image,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}) => {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((s) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s + delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [image.url]);

  const handleWheel = (e: React.WheelEvent) => e.preventDefault();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, translateX: translate.x, translateY: translate.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTranslate({
      x: dragStartRef.current.translateX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.translateY + (e.clientY - dragStartRef.current.y),
    });
  };

  const resetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label="Captured face preview"
    >
      <div
        className="absolute inset-0"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-4xl h-[90vh] max-h-[90vh] flex flex-col rounded-xl bg-gray-800 border border-gray-600 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-600 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">
            Face {index + 1} of {total}
            <span className="ml-3 text-sm font-normal text-gray-400">{image.timestamp}</span>
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 hidden sm:inline">Scroll to zoom (max 10×) · Drag to pan</span>
            <button
              type="button"
              onClick={resetZoom}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition"
              aria-label="Close"
            >
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="relative flex-1 min-h-[300px] overflow-hidden cursor-grab active:cursor-grabbing select-none bg-gray-900 rounded-b-xl flex items-center justify-center"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          style={{ touchAction: 'none' }}
        >
          <img
            src={image.url}
            alt={`Captured face ${image.timestamp}`}
            className="absolute inset-0 w-full h-full object-contain origin-center pointer-events-none"
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
            }}
            draggable={false}
          />
        </div>

        {total > 1 && (
          <div className="flex items-center justify-center gap-4 px-4 py-2 border-t border-gray-600 flex-shrink-0">
            <button
              type="button"
              onClick={onPrev}
              disabled={index <= 0}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            <span className="text-sm text-gray-400">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={index >= total - 1}
              className="px-4 py-2 text-sm font-bold rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
};

export default CapturedImageModal;
