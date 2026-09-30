'use client';

import React, { useState } from 'react';
import { predictHighIop, type IopModel } from '@/lib/iop/classifier';
import type { EyeAnalysis, RgbImage } from '@/lib/iop/types';
import IopFeatureTable from './IopFeatureTable';
import IopRoiCanvas, { type RoiLayers } from './IopRoiCanvas';
import IopVisualizations from './viz/IopVisualizations';

interface IopEyeResultCardProps {
  eye: EyeAnalysis;
  source: RgbImage;
  imageName: string;
  model: IopModel | null;
}

const SIDE_TITLES: Record<EyeAnalysis['side'], string> = {
  right: "Right eye (subject's side)",
  left: "Left eye (subject's side)",
  unknown: 'Eye',
};

const SOURCE_NOTES: Record<EyeAnalysis['source'], string> = {
  mediapipe: 'located from face landmarks',
  auto: 'located automatically in the close-up',
  manual: 'marked by hand',
};

const LAYER_NAMES: { key: keyof RoiLayers; label: string }[] = [
  { key: 'circles', label: 'Iris / pupil / lids' },
  { key: 'sclera', label: 'Sclera mask' },
  { key: 'red', label: 'Reddish pixels' },
  { key: 'contour', label: 'Outside active contour' },
];

function ModelVerdict({ eye, model }: { eye: EyeAnalysis; model: IopModel | null }) {
  if (!model) {
    return (
      <p className="text-sm text-slate-400">
        No trained model is deployed (<code className="text-slate-300">public/iop/model.json</code>), so there is no normal/high
        verdict - only the measured features.
      </p>
    );
  }
  const probability = predictHighIop(model, eye.features);
  const high = probability >= model.threshold;
  return (
    <p className="text-sm text-slate-300">
      Model output: <span className={`font-semibold ${high ? 'text-amber-400' : 'text-emerald-400'}`}>{high ? 'high IOP risk' : 'normal'}</span>{' '}
      (p = {probability.toFixed(2)}). Research use only - not a diagnosis.
    </p>
  );
}

/** Result for one eye: overlay, features, flags, verdict and visualisations. */
export default function IopEyeResultCard({ eye, source, imageName, model }: IopEyeResultCardProps) {
  const [layers, setLayers] = useState<RoiLayers>({ circles: true, sclera: false, red: true, contour: false });

  return (
    <section className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 space-y-4">
      <h2 className="text-lg font-bold tracking-tight text-white">
        {SIDE_TITLES[eye.side]}{' '}
        <span className="text-slate-400 text-sm font-normal">{SOURCE_NOTES[eye.source]}</span>
      </h2>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <IopRoiCanvas eye={eye} layers={layers} />
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            {LAYER_NAMES.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={layers[key]} onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <IopFeatureTable features={eye.features} />
          <ModelVerdict eye={eye} model={model} />
          {eye.flags.length > 0 && (
            <ul className="text-sm text-amber-300 list-disc pl-5 space-y-1">
              {eye.flags.map((flag) => <li key={flag.code}>{flag.message}</li>)}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-slate-700 pt-4">
        <IopVisualizations eye={eye} source={source} imageName={imageName} />
      </div>
    </section>
  );
}
