'use client';

import React, { useState } from 'react';

interface IopUploadPanelProps {
  busy: boolean;
  onFile: (file: File) => void;
}

/** Drop zone plus capture guidance. The photo stays in the browser. */
export default function IopUploadPanel({ busy, onFile }: IopUploadPanelProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 space-y-4">
      <label
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition duration-150 ease-out ${
          dragging ? 'border-blue-400 bg-slate-700/40' : 'border-slate-600 hover:border-blue-500'
        } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <span className="text-white font-medium">Drop a frontal eye or face photo, or click to choose</span>
        <span className="text-slate-400 text-sm">JPG / PNG. Processed entirely in this browser; nothing is uploaded.</span>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
      </label>
      <ul className="text-slate-400 text-sm list-disc pl-5 space-y-1">
        <li>Paper protocol: camera about 20 cm from the eye, same indoor lighting for everyone, no flash, high resolution.</li>
        <li>Eyes wide open, looking straight at the camera, no glasses or coloured lenses.</li>
        <li>Iris should be at least ~60 px across in the photo; a phone&apos;s rear camera works well.</li>
      </ul>
    </div>
  );
}
