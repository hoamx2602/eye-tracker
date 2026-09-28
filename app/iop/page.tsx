import type { Metadata } from 'next';
import Link from 'next/link';
import IopAnalyzer from '@/components/iop/IopAnalyzer';
import { MODULE_PATHS } from '@/lib/paths';

export const metadata: Metadata = {
  title: 'IOP risk (research) · Bradford Eye Tracking System',
  description: 'Frontal-eye intraocular pressure risk features, measured in the browser.',
};

/** Public: the photo is processed in the browser and never uploaded. */
export default function IopPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 overflow-y-auto" style={{ height: '100vh' }}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <Link href={MODULE_PATHS.HUB} className="text-sm text-slate-400 hover:text-white transition">
          ← All assessments
        </Link>
        <IopAnalyzer />
      </div>
    </div>
  );
}
