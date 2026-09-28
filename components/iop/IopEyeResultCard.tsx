'use client';

import React, { useState } from 'react';
import { predictHighIop, type IopModel } from '@/lib/iop/classifier';
import type { EyeAnalysis } from '@/lib/iop/types';
import IopFeatureTable from './IopFeatureTable';
import IopLabelForm, { type IopLabelInput } from './IopLabelForm';
import IopRoiCanvas, { type RoiLayers } from './IopRoiCanvas';

interface IopEyeResultCardProps {
  eye: EyeAnalysis;
  model: IopModel | null;
  onAddRow: (eye: EyeAnalysis, input: IopLabelInput) => void;
}

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
        No trained model deployed (<code className="text-slate-300">public/iop/model.json</code>), so there is no normal/high verdict.
        Collect labelled rows below and train one with <code className="text-slate-300">train_iop_mlp.py</code>.
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

/** Result for one eye: overlay, features, flags, verdict, labelling. */
export default function IopEyeResultCard({ eye, model, onAddRow }: IopEyeResultCardProps) {
  const [layers, setLayers] = useState<RoiLayers>({ circles: true, sclera: false, red: true, contour: false });
  const [added, setAdded] = useState(false);

  return (
    <section className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 space-y-4">
      <h2 className="text-lg font-bold tracking-tight text-white">
        {eye.side === 'right' ? 'Right' : 'Left'} eye <span className="text-slate-400 text-sm font-normal">(subject&apos;s side)</span>
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
        {added ? (
          <p className="text-sm text-emerald-400">Added to the dataset.</p>
        ) : (
          <IopLabelForm onAdd={(input) => { onAddRow(eye, input); setAdded(true); }} />
        )}
      </div>
    </section>
  );
}
