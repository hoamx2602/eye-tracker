'use client';

import React, { useEffect, useState } from 'react';
import { labelFromIop, loadRows, saveRows, type IopDatasetRow } from '@/lib/iop/dataset';
import type { EyeAnalysis } from '@/lib/iop/types';
import IopDatasetPanel from './IopDatasetPanel';
import IopEyeResultCard from './IopEyeResultCard';
import type { IopLabelInput } from './IopLabelForm';
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
 * features per eye, label, export. Research use only.
 */
export default function IopAnalyzer() {
  const { status, error, image, eyes, model, autoFailure, loadFile, analyzeManual, startManual } = useIopAnalysis();
  const [rows, setRows] = useState<IopDatasetRow[]>([]);
  const [persisted, setPersisted] = useState(true);
  const busy = status in STATUS_TEXT;

  useEffect(() => setRows(loadRows()), []);

  const updateRows = (next: IopDatasetRow[]) => {
    setRows(next);
    setPersisted(saveRows(next));
  };

  const addRow = (eye: EyeAnalysis, input: IopLabelInput) => {
    updateRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        participantId: input.participantId,
        imageName: image?.name ?? '',
        eye: eye.side,
        geometrySource: eye.source,
        features: eye.features,
        iopMmHg: input.iopMmHg,
        label: labelFromIop(input.iopMmHg),
        onEyeDrops: input.onEyeDrops,
        qualityFlags: eye.flags.map((flag) => flag.code),
        notes: input.notes,
      },
    ]);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">IOP risk from frontal eye images</h1>
        <p className="text-slate-400 text-sm mt-1 max-w-3xl">
          Re-implementation of Al-Oudat et al. (EURASIP JIVP, 2018): pupil/iris ratio, sclera redness (MRL, RAP) and sclera
          contour features. The paper&apos;s results come from one private dataset and have not been independently replicated;
          treat every output here as a research measurement, not a diagnosis.
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

      {status === 'done' && eyes.map((eye) => <IopEyeResultCard key={`${image?.url}-${eye.side}`} eye={eye} imageName={image?.name ?? 'image'} model={model} onAddRow={addRow} />)}

      <IopDatasetPanel rows={rows} persisted={persisted} onClear={() => updateRows([])} />
    </div>
  );
}
