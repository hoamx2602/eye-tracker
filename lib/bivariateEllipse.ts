/**
 * Bivariate Contour Ellipse Area (BCEA) and 2D covariance ellipse for fixation stability.
 * Uses the χ² contour on the sample covariance of gaze (x, y) in pixels.
 *
 * References: Steinman et al.; Crossland et al.; standard eye-tracking fixation metrics.
 */

export type BceaContour = '68' | '95';

/** χ² critical values, 2 degrees of freedom (bivariate normal). */
const CHI2_DF2: Record<BceaContour, number> = {
  /** ~68.3% of bivariate normal mass */
  '68': 2.283,
  /** 95% */
  '95': 5.991,
};

export interface Covariance2D {
  meanX: number;
  meanY: number;
  cxx: number;
  cyy: number;
  cxy: number;
  n: number;
}

export interface BceaResult {
  contour: BceaContour;
  /** Area of the ellipse in px² */
  areaPx2: number;
  /** Semi-axes in px (along principal axes, before rotation) */
  semiMajorPx: number;
  semiMinorPx: number;
  /** Rotation of the major axis from +x, radians (same convention as Math.atan2) */
  rotationRad: number;
  centerX: number;
  centerY: number;
}

/**
 * Sample covariance of (x, y). Uses n-1 denominator when n >= 2.
 */
export function computeCovariance2D(samples: Array<{ x: number; y: number }>): Covariance2D | null {
  const n = samples.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const s of samples) {
    sx += s.x;
    sy += s.y;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const s of samples) {
    const dx = s.x - meanX;
    const dy = s.y - meanY;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const denom = n - 1;
  return {
    meanX,
    meanY,
    cxx: cxx / denom,
    cyy: cyy / denom,
    cxy: cxy / denom,
    n,
  };
}

/** det(Σ) for 2×2 symmetric covariance. */
export function covarianceDeterminant(c: Covariance2D): number {
  return c.cxx * c.cyy - c.cxy * c.cxy;
}

/**
 * BCEA = π · χ² · √(det Σ) — area of the χ² contour ellipse for bivariate normal.
 */
export function computeBceaAreaPx2(cov: Covariance2D, contour: BceaContour): number {
  const det = covarianceDeterminant(cov);
  if (det <= 0 || !Number.isFinite(det)) return 0;
  const chi2 = CHI2_DF2[contour];
  return Math.PI * chi2 * Math.sqrt(det);
}

/**
 * Eigen-decomposition of 2×2 symmetric matrix [[cxx, cxy], [cxy, cyy]].
 * Returns sorted eigenvalues λ1 ≥ λ2 and rotation θ of the first eigenvector.
 */
function eigSymmetric2x2(cxx: number, cxy: number, cyy: number): {
  lambda1: number;
  lambda2: number;
  theta: number;
} {
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  let l1 = trace / 2 + disc;
  let l2 = trace / 2 - disc;
  if (l2 > l1) {
    const t = l1;
    l1 = l2;
    l2 = t;
  }
  // Eigenvector for larger eigenvalue l1: (cxy, l1 - cxx) or (l1 - cyy, cxy)
  let vx = cxy;
  let vy = l1 - cxx;
  if (Math.abs(vx) + Math.abs(vy) < 1e-12) {
    vx = l1 - cyy;
    vy = cxy;
  }
  const len = Math.hypot(vx, vy);
  if (len < 1e-12) {
    return { lambda1: Math.max(l1, 0), lambda2: Math.max(l2, 0), theta: 0 };
  }
  vx /= len;
  vy /= len;
  return { lambda1: Math.max(l1, 0), lambda2: Math.max(l2, 0), theta: Math.atan2(vy, vx) };
}

/**
 * Parameters for SVG `<ellipse>`: center, radii along major/minor axes, rotation.
 * Major axis is aligned with the first eigenvector; semi-axis lengths = √(χ² · λᵢ).
 */
export function computeBceaEllipse(cov: Covariance2D, contour: BceaContour): BceaResult | null {
  const det = covarianceDeterminant(cov);
  if (det <= 0 || !Number.isFinite(det)) return null;
  const chi2 = CHI2_DF2[contour];
  const { lambda1, lambda2, theta } = eigSymmetric2x2(cov.cxx, cov.cxy, cov.cyy);
  const semiMajorPx = Math.sqrt(Math.max(0, chi2 * lambda1));
  const semiMinorPx = Math.sqrt(Math.max(0, chi2 * lambda2));
  const areaPx2 = Math.PI * semiMajorPx * semiMinorPx;
  return {
    contour,
    areaPx2,
    semiMajorPx,
    semiMinorPx,
    rotationRad: theta,
    centerX: cov.meanX,
    centerY: cov.meanY,
  };
}

export function computeBceaForSamples(
  samples: Array<{ x: number; y: number }>,
  contour: BceaContour
): { areaPx2: number; ellipse: BceaResult | null; cov: Covariance2D | null } {
  const cov = computeCovariance2D(samples);
  if (!cov) {
    return { areaPx2: 0, ellipse: null, cov: null };
  }
  const areaPx2 = computeBceaAreaPx2(cov, contour);
  const ellipse = computeBceaEllipse(cov, contour);
  return { areaPx2, ellipse, cov };
}
