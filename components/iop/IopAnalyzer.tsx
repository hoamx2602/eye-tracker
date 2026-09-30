'use client';

import React from 'react';
import IopEyeResultCard from './IopEyeResultCard';
import IopManualPicker from './IopManualPicker';
import IopUploadPanel from './IopUploadPanel';
import { useIopAnalysis, type IopStatus } from './useIopAnalysis';

const STATUS_TEXT: Partial<Record<IopStatus, string>> = {
  'loading-image': 'Reading image…',
  detecting: 'Finding the eye (first run downloads the landmark model)…',
  analyzing: 'Measuring pupil, iris and sclera…',
};

/**
 * Frontal-eye IOP risk tool (Al-Oudat et al., 2018): upload, measure the five
 * features per eye, and show how they were measured. Research use only.
 */
export default function IopAnalyzer() {
  const { status, error, image, eyes, model, autoFailure, loadFile, analyzeManual, startManual } = useIopAnalysis();
  const busy = status in STATUS_TEXT;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">IOP risk from frontal eye images</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Measures the pupil/iris ratio, sclera redness (MRL, RAP) and sclera contour features from a frontal eye photo.
          Every output is a research measurement, not a diagnosis.
        </p>
      </header>

      <IopUploadPanel busy={busy} onFile={loadFile} />

      {busy && <p className="text-sm text-blue-400" role="status">{STATUS_TEXT[status]}</p>}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      {(status === 'needs-manual' || (status === 'error' && eyes.length === 0)) && image && (
        <IopManualPicker key={image.url} imageUrl={image.url} imageWidth={image.width} imageHeight={image.height} onSubmit={analyzeManual} autoFailure={autoFailure} />
      )}

      {status === 'done' && image && (
        <button type="button" onClick={startManual} className="text-sm text-slate-400 hover:text-white underline transition">
          Outline looks wrong? Mark the eye by hand instead
        </button>
      )}

      {status === 'done' && image && eyes.map((eye) => <IopEyeResultCard key={`${image?.url}-${eye.side}`} eye={eye} source={image.rgb} imageName={image.name} model={model} />)}

    </div>
  );
}
