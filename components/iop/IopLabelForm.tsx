'use client';

import React, { useState } from 'react';
import { HIGH_IOP_CUTOFF_MMHG, labelFromIop, type Medication } from '@/lib/iop/dataset';

export interface IopLabelInput {
  participantId: string;
  iopMmHg: number | null;
  onEyeDrops: Medication;
  notes: string;
}

interface IopLabelFormProps {
  onAdd: (input: IopLabelInput) => void;
}

const inputClass = 'bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 w-full';

/** Ground truth for one eye, so the export can train and validate a classifier. */
export default function IopLabelForm({ onAdd }: IopLabelFormProps) {
  const [participantId, setParticipantId] = useState('');
  const [iopText, setIopText] = useState('');
  const [onEyeDrops, setOnEyeDrops] = useState<Medication>('unknown');
  const [notes, setNotes] = useState('');
  const iopMmHg = iopText.trim() === '' ? null : Number(iopText);
  const label = labelFromIop(iopMmHg);

  return (
    <form
      className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({ participantId: participantId.trim(), iopMmHg, onEyeDrops, notes: notes.trim() });
      }}
    >
      <label className="text-xs text-slate-400 space-y-1">
        <span>Participant ID</span>
        <input className={inputClass} value={participantId} onChange={(e) => setParticipantId(e.target.value)} />
      </label>
      <label className="text-xs text-slate-400 space-y-1">
        <span>Tonometer IOP (mmHg)</span>
        <input className={inputClass} inputMode="decimal" value={iopText} onChange={(e) => setIopText(e.target.value)} placeholder="optional" />
      </label>
      <label className="text-xs text-slate-400 space-y-1">
        <span>Uses eye drops?</span>
        <select className={inputClass} value={onEyeDrops} onChange={(e) => setOnEyeDrops(e.target.value as Medication)}>
          <option value="unknown">Unknown</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      <label className="text-xs text-slate-400 space-y-1">
        <span>Notes</span>
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="col-span-2 md:col-span-3 text-xs text-slate-500">
        Label: <span className="text-slate-300">{label}</span> (paper cutoff: &gt; {HIGH_IOP_CUTOFF_MMHG} mmHg is high)
      </p>
      <button type="submit" className="px-3 py-1.5 rounded bg-blue-600 text-sm text-white hover:bg-blue-500 transition duration-150 ease-out">
        Add to dataset
      </button>
    </form>
  );
}
