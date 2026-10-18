'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ASSESSMENT_OPTIONS, assessmentLabel } from '@/lib/user-auth';

type Invitation = {
  id: string;
  code: string;
  assessmentType: string;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
  active: boolean;
  note: string | null;
  createdAt: string;
};

export default function InvitationManager() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [assessmentType, setAssessmentType] = useState('EYE_TRACKING');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    const response = await fetch('/api/doctor/invitations', { cache: 'no-store' });
    if (response.ok) setInvitations((await response.json()).invitations ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch('/api/doctor/invitations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assessmentType, expiresInDays, maxUses, note }),
    });
    if (response.ok) {
      const { invitation } = await response.json();
      setInvitations((current) => [invitation, ...current]);
      setNote('');
    }
    setSaving(false);
  }

  async function toggle(id: string) {
    const response = await fetch(`/api/doctor/invitations/${id}`, { method: 'PATCH' });
    if (!response.ok) return;
    const { invitation } = await response.json();
    setInvitations((current) => current.map((item) => item.id === id ? invitation : item));
  }

  function toggleSelected(id: string) {
    setConfirmingDelete(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setConfirmingDelete(false);
    setSelected((current) => current.size === invitations.length ? new Set() : new Set(invitations.map((item) => item.id)));
  }

  async function deleteSelected() {
    setDeleting(true);
    setDeleteError(null);
    const ids = [...selected];
    const response = await fetch('/api/doctor/invitations', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (response.ok) {
      setInvitations((current) => current.filter((item) => !selected.has(item.id)));
      setSelected(new Set());
      setConfirmingDelete(false);
    } else {
      setDeleteError('Could not delete the selected links. Please try again.');
    }
    setDeleting(false);
  }

  async function copy(invitation: Invitation) {
    const link = `${window.location.origin}/invite/${invitation.code}`;
    await navigator.clipboard.writeText(link);
    setCopied(invitation.id);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="space-y-7">
      <div><h1 className="text-3xl font-bold">Patient test links</h1><p className="mt-1 text-slate-400">Choose an assessment and generate a trackable link for home testing.</p></div>
      <form onSubmit={create} className="grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-4">
        <label className="text-sm text-slate-300">Assessment
          <select value={assessmentType} onChange={(event) => setAssessmentType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5">
            {ASSESSMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-300">Expires after (days)
          <input type="number" min={1} max={365} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5" />
        </label>
        <label className="text-sm text-slate-300">Maximum uses
          <input type="number" min={1} max={100} value={maxUses} onChange={(event) => setMaxUses(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5" />
        </label>
        <label className="text-sm text-slate-300">Patient note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Follow-up, Jane" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5" />
        </label>
        <button disabled={saving} className="md:col-span-4 justify-self-start rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50">{saving ? 'Creating…' : 'Generate code and link'}</button>
      </form>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm">
          <span className="text-slate-300">{selected.size} link{selected.size === 1 ? '' : 's'} selected</span>
          {confirmingDelete ? <>
            <span className="text-slate-400">Delete permanently? Patients&apos; completed sessions are kept.</span>
            <button type="button" disabled={deleting} onClick={() => void deleteSelected()} className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50">{deleting ? 'Deleting…' : 'Yes, delete'}</button>
            <button type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)} className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50">Cancel</button>
          </> : <>
            <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-md bg-red-600/15 px-3 py-1.5 text-red-300 hover:bg-red-600/25">Delete selected</button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700">Clear selection</button>
          </>}
          {deleteError && <span className="text-red-400">{deleteError}</span>}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {loading ? <p className="p-8 text-center text-slate-500">Loading links…</p> : invitations.length === 0 ? <p className="p-8 text-center text-slate-500">No test links yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-800 bg-slate-900"><tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all links" checked={selected.size > 0 && selected.size === invitations.length} ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < invitations.length; }} onChange={toggleSelectAll} className="h-4 w-4 accent-blue-600" /></th>
            <th className="px-4 py-3">Code</th><th className="px-4 py-3">Assessment</th><th className="px-4 py-3">Usage</th><th className="px-4 py-3">Expires</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
          </tr></thead><tbody className="divide-y divide-slate-800">{invitations.map((invitation) => {
            const expired = invitation.expiresAt ? new Date(invitation.expiresAt).getTime() <= Date.now() : false;
            const available = invitation.active && !expired && invitation.usedCount < invitation.maxUses;
            return <tr key={invitation.id} className={`text-slate-300 ${selected.has(invitation.id) ? 'bg-blue-600/5' : ''}`}>
              <td className="px-4 py-3"><input type="checkbox" aria-label={`Select link ${invitation.code}`} checked={selected.has(invitation.id)} onChange={() => toggleSelected(invitation.id)} className="h-4 w-4 accent-blue-600" /></td>
              <td className="px-4 py-3 font-mono font-semibold text-white">{invitation.code}<div className="font-sans text-xs font-normal text-slate-500">{invitation.note}</div></td>
              <td className="px-4 py-3">{assessmentLabel(invitation.assessmentType)}</td><td className="px-4 py-3">{invitation.usedCount}/{invitation.maxUses}</td>
              <td className="px-4 py-3">{invitation.expiresAt ? new Date(invitation.expiresAt).toLocaleDateString() : 'Never'}</td>
              <td className="px-4 py-3"><span className={available ? 'text-emerald-400' : 'text-slate-500'}>{available ? 'Active' : expired ? 'Expired' : 'Inactive'}</span></td>
              <td className="px-4 py-3"><div className="flex gap-2"><button type="button" onClick={() => void copy(invitation)} className="rounded-md bg-blue-600/15 px-3 py-1.5 text-blue-300 hover:bg-blue-600/25">{copied === invitation.id ? 'Copied' : 'Copy link'}</button><button type="button" onClick={() => void toggle(invitation.id)} className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700">{invitation.active ? 'Disable' : 'Enable'}</button></div></td>
            </tr>;
          })}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
