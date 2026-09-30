import { useLayoutEffect } from 'react';

/**
 * Time a stimulus actually reached the screen, on the performance.now() clock.
 *
 * `performance.now()` next to the setState that shows a stimulus is taken
 * before React has rendered it, and a setInterval tick can land anywhere in
 * the frame. The first requestAnimationFrame after the commit runs at the
 * start of the frame that paints it, which is the closest a page can get to
 * the photons. Pairs with the camera frames' capture times in
 * lib/gazeFrameStream, which are on the same clock.
 *
 * Calls `onOnset(t)` once per change of `key` while `active` is true.
 */
export function useStimulusOnset(key: unknown, active: boolean, onOnset: (t: number) => void): void {
  useLayoutEffect(() => {
    if (!active) return;
    const raf = requestAnimationFrame((t) => onOnset(t));
    return () => cancelAnimationFrame(raf);
    // onOnset is expected to write a ref; re-running on its identity would re-stamp the onset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
}
