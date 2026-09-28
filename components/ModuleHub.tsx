import React from 'react';
import Link from 'next/link';
import { MODULE_PATHS } from '@/lib/paths';

interface ModuleCard {
  href: string;
  title: string;
  tagline: string;
  description: string;
  meta: string;
  accent: string;
  icon: React.ReactNode;
}

const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, className: 'w-6 h-6' } as const;

const MODULES: ModuleCard[] = [
  {
    href: MODULE_PATHS.EYE_TRACKING,
    title: 'Eye tracking',
    tagline: 'Neurological assessment',
    description: 'Webcam calibration, eye-movement exercises and the neurological test battery, with a results report.',
    meta: 'Webcam',
    accent: 'bg-blue-500/10 text-blue-400',
    icon: (
      <svg {...iconProps}>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: MODULE_PATHS.FACIAL_DROOP,
    title: 'Facial droop',
    tagline: 'Facial movement & motor speech',
    description: 'Guided expressions and speech tasks recorded on camera and microphone, measured for asymmetry and articulation.',
    meta: 'Camera + microphone',
    accent: 'bg-teal-500/10 text-teal-300',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 10h.01M15 10h.01M8.5 15.5c1.5 1 5 .5 7-1" />
      </svg>
    ),
  },
  {
    href: MODULE_PATHS.IOP,
    title: 'IOP risk',
    tagline: 'Frontal eye image analysis',
    description: 'Upload a close-up eye photo to measure pupil/iris ratio, sclera redness and sclera contour features.',
    meta: 'Photo upload · runs in the browser',
    accent: 'bg-amber-500/10 text-amber-300',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="1.5" />
        <path d="M3 12a9 9 0 0 1 18 0M12 3v2M4.6 6.6l1.4 1.4M19.4 6.6 18 8" />
      </svg>
    ),
  },
];

/** Landing page: one entry per assessment module. */
export default function ModuleHub() {
  return (
    <div className="h-screen overflow-y-auto bg-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-900/95">
        <div className="max-w-5xl mx-auto px-8 h-14 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-3.5 h-3.5" aria-hidden>
              <circle cx="10" cy="10" r="7" />
              <circle cx="10" cy="10" r="3" />
              <circle cx="10" cy="10" r="0.8" fill="white" stroke="none" />
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-tight">Eye Assessment</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Choose an assessment</h1>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Each module runs on its own. Research use only; none of these results is a diagnosis.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {MODULES.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="group flex flex-col rounded-2xl border border-gray-700 bg-gray-800 p-6 transition duration-150 ease-out hover:border-blue-500 hover:bg-gray-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${module.accent}`}>{module.icon}</div>
              <h2 className="mt-5 text-lg font-bold tracking-tight">{module.title}</h2>
              <p className="text-sm text-gray-400">{module.tagline}</p>
              <p className="mt-4 text-sm text-gray-300 flex-1">{module.description}</p>
              <div className="mt-6 flex items-center justify-between text-xs text-gray-500">
                <span>{module.meta}</span>
                <span className="text-blue-400 group-hover:translate-x-0.5 transition">Open →</span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
