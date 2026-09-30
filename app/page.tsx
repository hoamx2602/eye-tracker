import ModuleHub from '@/components/ModuleHub';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'neurotree — Neurological assessments',
  description: 'Explore eye tracking, facial movement and eye image assessments with neurotree.',
};

/**
 * / — module hub. Each assessment has its own route:
 *   /eye-tracking   eye-tracking flow (was /)
 *   /facial-droop   facial movement and motor-speech capture
 *   /iop            frontal-eye IOP risk features
 */
export default function HubPage() {
  return <ModuleHub />;
}
