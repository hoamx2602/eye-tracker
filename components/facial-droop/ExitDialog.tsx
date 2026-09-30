'use client';

import React from 'react';
import Modal from '@/components/ui/Modal';

interface ExitDialogProps {
  open: boolean;
  recording: boolean;
  onStay: () => void;
  onLeave: () => void;
}

/** Confirms leaving mid-assessment; nothing recorded so far is kept. */
export default function ExitDialog({ open, recording, onStay, onLeave }: ExitDialogProps) {
  return (
    <Modal open={open} onClose={onStay} size="sm">
      <div className="space-y-4 p-6 text-center" role="dialog" aria-modal="true" aria-labelledby="facial-exit-title">
        <h2 id="facial-exit-title" className="text-lg font-bold text-white">Leave the assessment?</h2>
        <p className="text-sm leading-6 text-gray-400">
          {recording ? 'The recording so far will be discarded and nothing is saved.' : 'Nothing has been recorded yet.'}
        </p>
        <div className="flex justify-center gap-3">
          <button type="button" onClick={onStay} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500">
            Stay
          </button>
          <button type="button" onClick={onLeave} className="rounded-xl border border-gray-600 px-5 py-2.5 text-sm text-gray-200 hover:border-red-400 hover:text-red-300">
            Leave
          </button>
        </div>
      </div>
    </Modal>
  );
}
