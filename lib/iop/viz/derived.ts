/**
 * Masks and numbers several visualisation blocks share, computed once per
 * eye: regions at display resolution, the inverse of the reddish mask, what
 * was excluded from the sclera, the vessel map, and the notebook's
 * region-area ratios (measured at the normalised scale).
 */
import type { DisplayEye } from './display';
import { countOnes, regionMasks, type RegionMasks } from './regions';
import { vesselMap, type VesselMap } from './vessels';

export interface DerivedViz {
  regions: RegionMasks;
  /** Sclera pixels not counted as reddish. */
  inverted: Uint8Array;
  /** Opening outside the iris that the sclera mask left out (canthi, glare). */
  excluded: Uint8Array;
  excludedShare: number;
  vessels: VesselMap;
  /** Pupil, iris and sclera areas as shares of their sum (notebook cell 36), measurement scale. */
  areaShares: { pupil: number; iris: number; sclera: number };
  areaPixels: { pupil: number; iris: number; sclera: number };
}

/** a AND NOT b. */
export const without = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => (v && !b[i] ? 1 : 0));

export function deriveViz(view: DisplayEye): DerivedViz {
  const regions = regionMasks(view);
  const excluded = without(view.openingOutsideIris, view.scleraMask);
  const measured = regionMasks(view.eye);
  const areaPixels = { pupil: countOnes(measured.pupil), iris: countOnes(measured.iris), sclera: countOnes(measured.sclera) };
  const total = areaPixels.pupil + areaPixels.iris + areaPixels.sclera || 1;
  const outside = countOnes(view.openingOutsideIris);
  return {
    regions,
    inverted: without(view.scleraMask, view.redMask),
    excluded,
    excludedShare: outside ? countOnes(excluded) / outside : 0,
    vessels: vesselMap(view.roi, view.scleraMask, view.factor),
    areaShares: { pupil: areaPixels.pupil / total, iris: areaPixels.iris / total, sclera: areaPixels.sclera / total },
    areaPixels,
  };
}
