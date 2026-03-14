'use client';

import NeurologicalConfigForm from '@/components/admin/NeurologicalConfigForm';

export default function AdminNeurologicalConfigPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Neurological test config</h1>
      <p className="text-slate-400 text-sm mb-6">
        Set test order, enable/disable tests, and parameters. Saved config is used when a user starts a Neurological run.
      </p>
      <NeurologicalConfigForm />
    </div>
  );
}
