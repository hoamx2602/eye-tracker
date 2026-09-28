import ModuleHub from '@/components/ModuleHub';

/**
 * / — module hub. Each assessment has its own route:
 *   /eye-tracking   eye-tracking flow (was /)
 *   /facial-droop   facial movement and motor-speech capture
 *   /iop            frontal-eye IOP risk features
 */
export default function HubPage() {
  return <ModuleHub />;
}
