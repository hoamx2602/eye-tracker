'use client';

import React from 'react';
import Modal from '../ui/Modal';

interface ExitConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ExitConfirmModal: React.FC<ExitConfirmModalProps> = ({ open, onConfirm, onCancel }) => {
  return (
    <Modal open={open} onClose={onCancel} size="sm" zIndexClassName="z-[600]">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 text-center">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        
        <h2 className="text-xl font-bold text-white mb-2">Exit Test Run?</h2>
        <p className="text-slate-400 mb-6">
          Your current progress will not be saved. Are you sure you want to exit to the homepage?
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-colors shadow-lg shadow-red-900/20"
          >
            Yes, Exit Run
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ExitConfirmModal;
