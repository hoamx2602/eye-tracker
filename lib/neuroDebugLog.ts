/**
 * Opt-in neurological flow logging. Set NEXT_PUBLIC_NEURO_DEBUG=1 in .env.local
 * Remove or set to 0 when no longer needed.
 */
export function neuroDebugEnabled(): boolean {
  return (
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_NEURO_DEBUG === '1'
  );
}

export function neuroDebugLog(...args: unknown[]): void {
  if (!neuroDebugEnabled()) return;
  // eslint-disable-next-line no-console -- intentional debug channel
  console.log('[Neuro]', ...args);
}
