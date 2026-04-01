/**
 * RegressionService — gaze prediction models.
 *
 * Three models available, all implementing the same predict() signature:
 *   • Ridge  — fast linear baseline (L2 regularisation, λ=0.001)
 *   • TPS    — Thin Plate Spline non-linear warping (best accuracy, ≥8 points)
 *   • Hybrid — Ridge global + k-NN residual correction (k=4)
 *
 * HybridRegressor is the primary entry-point; Ridge and TPS are internal.
 */

import type { LOOCVMetrics } from '../core/IGazeEngine';

// ─── Matrix Utilities ────────────────────────────────────────────────────────

class Matrix {
  static transpose(m: number[][]): number[][] {
    return m[0].map((_, c) => m.map(r => r[c]));
  }

  static multiply(a: number[][], b: number[][]): number[][] {
    const ra = a.length, ca = a[0].length, cb = b[0].length;
    const out = Array.from({ length: ra }, () => new Array<number>(cb).fill(0));
    for (let i = 0; i < ra; i++)
      for (let j = 0; j < cb; j++)
        for (let k = 0; k < ca; k++)
          out[i][j] += a[i][k] * b[k][j];
    return out;
  }

  /** Gaussian-elimination matrix inversion. Returns null if singular. */
  static invert(A: number[][]): number[][] | null {
    const n = A.length;
    const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let i = 0; i < n; i++) {
      let pivot = M[i][i], pivotRow = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(pivot)) { pivot = M[k][i]; pivotRow = k; }
      if (Math.abs(pivot) < 1e-10) return null;
      [M[i], M[pivotRow]] = [M[pivotRow], M[i]];
      for (let j = 0; j < 2 * n; j++) M[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const f = M[k][i];
        for (let j = 0; j < 2 * n; j++) M[k][j] -= f * M[i][j];
      }
    }
    return M.map(row => row.slice(n));
  }

  /** Ridge-regularised least squares: W = (XᵀX + λI)⁻¹ XᵀY */
  static ridgeSolve(X: number[][], Y: number[][], lambda = 0.001): number[][] | null {
    try {
      const XT = Matrix.transpose(X);
      const XTX = Matrix.multiply(XT, X);
      for (let i = 0; i < XTX.length; i++) XTX[i][i] += lambda;
      const inv = Matrix.invert(XTX);
      if (!inv) return null;
      return Matrix.multiply(inv, Matrix.multiply(XT, Y));
    } catch { return null; }
  }

  /**
   * Weighted Ridge: W = (XᵀDX + λI)⁻¹ XᵀDY where D = diag(weights).
   * High-quality samples (weight≈1) contribute fully; artifact frames (weight≈0) are ignored.
   */
  static weightedRidgeSolve(X: number[][], Y: number[][], weights: number[], lambda = 0.001): number[][] | null {
    try {
      const n = X.length, d = X[0].length, o = Y[0].length;
      const XtWX: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
      const XtWY: number[][] = Array.from({ length: d }, () => new Array<number>(o).fill(0));
      for (let i = 0; i < n; i++) {
        const w = weights[i] ?? 1;
        for (let j = 0; j < d; j++) {
          for (let k = 0; k < d; k++) XtWX[j][k] += w * X[i][j] * X[i][k];
          for (let k = 0; k < o; k++) XtWY[j][k] += w * X[i][j] * Y[i][k];
        }
      }
      for (let i = 0; i < d; i++) XtWX[i][i] += lambda;
      const inv = Matrix.invert(XtWX);
      return inv ? Matrix.multiply(inv, XtWY) : null;
    } catch { return null; }
  }
}

// ─── TPS Regressor ───────────────────────────────────────────────────────────

class TPSRegressor {
  private controlPoints: number[][] = [];
  private weights: number[][] | null = null;
  private activeIdx: number[] = [1, 2, 3, 4]; // base eye features
  private static readonly LAMBDA = 0.5;

  /** φ(r) = r² ln r — the TPS radial basis function. */
  private rbf(r: number): number { return r === 0 ? 0 : r * r * Math.log(r); }

  isReady(): boolean { return this.weights !== null; }

  train(fullInputs: number[][], outputs: number[][]): boolean {
    const baseIdx = [1, 2, 3, 4];
    const headIdx = [9, 10, 11];
    // Use head compensation when we have enough samples (need D+1 at minimum)
    const canHead = fullInputs.length >= baseIdx.length + headIdx.length + 1;
    this.activeIdx = canHead ? [...baseIdx, ...headIdx] : [...baseIdx];

    const inputs = fullInputs.map(r => this.activeIdx.map(i => r[i] ?? 0));
    const N = inputs.length, D = inputs[0].length;
    if (N < D + 1) return false;

    this.controlPoints = inputs;

    // Build L = [[K + λI, P], [Pᵀ, 0]]
    const K: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        let d = 0;
        for (let k = 0; k < D; k++) d += (inputs[i][k] - inputs[j][k]) ** 2;
        const v = this.rbf(Math.sqrt(d));
        K[i][j] = v; K[j][i] = v;
      }
      K[i][i] += TPSRegressor.LAMBDA;
    }
    const P = inputs.map(r => [1, ...r]);
    const PT = Matrix.transpose(P);
    const dim = N + D + 1;
    const L: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) L[i][j] = K[i][j];
    for (let i = 0; i < N; i++) for (let j = 0; j <= D; j++) L[i][N + j] = P[i][j];
    for (let i = 0; i <= D; i++) for (let j = 0; j < N; j++) L[N + i][j] = PT[i][j];

    const V: number[][] = Array.from({ length: dim }, (_, i) => (i < N ? outputs[i] : [0, 0]));
    const Linv = Matrix.invert(L);
    if (!Linv) { this.weights = null; return false; }
    this.weights = Matrix.multiply(Linv, V);
    return true;
  }

  predict(fullInput: number[]): { x: number; y: number } {
    if (!this.weights || !this.controlPoints.length) return { x: 0, y: 0 };
    const input = this.activeIdx.map(i => fullInput[i] ?? 0);
    const N = this.controlPoints.length, D = input.length;
    let rx = 0, ry = 0;
    for (let i = 0; i < N; i++) {
      let d = 0;
      for (let k = 0; k < D; k++) d += (input[k] - this.controlPoints[i][k]) ** 2;
      const u = this.rbf(Math.sqrt(d));
      rx += this.weights[i][0] * u;
      ry += this.weights[i][1] * u;
    }
    rx += this.weights[N][0];
    ry += this.weights[N][1];
    for (let j = 0; j < D; j++) {
      rx += this.weights[N + 1 + j][0] * input[j];
      ry += this.weights[N + 1 + j][1] * input[j];
    }
    return { x: rx, y: ry };
  }
}

// ─── Hybrid Regressor (public API) ───────────────────────────────────────────

export type RegressionMethod = 'RIDGE' | 'HYBRID' | 'TPS';

interface TrainingEntry {
  input: number[];
  output: number[];
  /** Ridge residual used by k-NN correction. */
  error: [number, number];
}

export class HybridRegressor {
  private weights: number[][] | null = null;
  private data: TrainingEntry[] = [];
  private readonly tps = new TPSRegressor();

  /** Mean LOOCV pixel errors from the last train() call. */
  loocv: LOOCVMetrics = { ridgePx: 0, hybridPx: 0 };

  hasModel(): boolean { return this.weights !== null && this.data.length > 0; }

  /**
   * @param sampleWeights Optional per-sample quality weights (0–1).
   *   When provided (glasses mode), uses weighted Ridge so glare-artifact frames
   *   during calibration have proportionally less influence on the model.
   *   Undefined → standard uniform Ridge (backward compatible).
   */
  train(inputs: number[][], outputs: number[][], sampleWeights?: number[]): boolean {
    this.weights = sampleWeights
      ? Matrix.weightedRidgeSolve(inputs, outputs, sampleWeights)
      : Matrix.ridgeSolve(inputs, outputs);
    if (!this.weights) return false;

    this.data = inputs.map((inp, i) => {
      const [px, py] = this.linearPredict(inp);
      return { input: inp, output: outputs[i], error: [outputs[i][0] - px, outputs[i][1] - py] };
    });

    try { this.tps.train(inputs, outputs); } catch { /* TPS is optional */ }
    this.loocv = this.computeLOOCV(inputs, outputs);
    return true;
  }

  private linearPredict(input: number[]): [number, number] {
    if (!this.weights) return [0, 0];
    let x = 0, y = 0;
    for (let i = 0; i < input.length; i++) { x += input[i] * this.weights![i][0]; y += input[i] * this.weights![i][1]; }
    return [x, y];
  }

  predict(input: number[], method: RegressionMethod = 'HYBRID'): { x: number; y: number } {
    if (method === 'TPS' && this.tps.isReady()) return this.tps.predict(input);
    if (!this.weights || !this.data.length) return { x: 0, y: 0 };

    const [gx, gy] = this.linearPredict(input);
    if (method === 'RIDGE') return { x: gx, y: gy };

    // Hybrid: k-NN residual correction (k=4, inverse-distance weights)
    const k = 4;
    const sorted = this.data
      .map(d => {
        let dsq = 0;
        for (let i = 0; i < input.length; i++) dsq += (input[i] - d.input[i]) ** 2;
        return { ...d, dist: Math.sqrt(dsq) };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k);

    let tw = 0, cx = 0, cy = 0;
    for (const n of sorted) {
      const w = 1 / (n.dist + 1e-4);
      cx += n.error[0] * w; cy += n.error[1] * w; tw += w;
    }
    return { x: gx + cx / tw, y: gy + cy / tw };
  }

  /** Leave-One-Out Cross-Validation — measures generalisation error. */
  private computeLOOCV(inputs: number[][], outputs: number[][]): LOOCVMetrics {
    if (inputs.length < 5) return { ridgePx: 0, hybridPx: 0 };
    let sumR = 0, sumH = 0;
    const n = inputs.length;

    for (let i = 0; i < n; i++) {
      const trX = inputs.filter((_, j) => j !== i);
      const trY = outputs.filter((_, j) => j !== i);
      const w = Matrix.ridgeSolve(trX, trY);
      if (!w) continue;

      let px = 0, py = 0;
      for (let j = 0; j < inputs[i].length; j++) { px += inputs[i][j] * w[j][0]; py += inputs[i][j] * w[j][1]; }

      sumR += Math.hypot(px - outputs[i][0], py - outputs[i][1]);

      // Hybrid correction on CV fold
      const cvData = trX.map((inp, idx) => {
        let ex = 0, ey = 0;
        for (let j = 0; j < inp.length; j++) { ex += inp[j] * w[j][0]; ey += inp[j] * w[j][1]; }
        return { input: inp, error: [trY[idx][0] - ex, trY[idx][1] - ey] as [number, number] };
      });
      const nn = cvData
        .map(d => { let dsq = 0; for (let j = 0; j < inputs[i].length; j++) dsq += (inputs[i][j] - d.input[j]) ** 2; return { ...d, dist: Math.sqrt(dsq) }; })
        .sort((a, b) => a.dist - b.dist).slice(0, 4);
      let tw = 0, cx = 0, cy = 0;
      for (const nb of nn) { const ww = 1 / (nb.dist + 1e-4); cx += nb.error[0] * ww; cy += nb.error[1] * ww; tw += ww; }
      sumH += Math.hypot(px + cx / tw - outputs[i][0], py + cy / tw - outputs[i][1]);
    }

    const metrics = { ridgePx: sumR / n, hybridPx: sumH / n };
    console.log(`[LOOCV] Ridge: ${metrics.ridgePx.toFixed(1)}px | Hybrid: ${metrics.hybridPx.toFixed(1)}px`);
    return metrics;
  }
}

// ─── Data Cleaner ────────────────────────────────────────────────────────────

export type OutlierMethod = 'NONE' | 'TRIM_TAILS' | 'STD_DEV';

export class DataCleaner {
  /** Remove outlier feature vectors before regression training. */
  static clean(buf: number[][], method: OutlierMethod, threshold: number): number[][] {
    if (buf.length < 5 || method === 'NONE') return buf;

    if (method === 'TRIM_TAILS') {
      // Sort by the primary eye feature (index 1 = lx) and trim both tails
      const sorted = [...buf.keys()].sort((a, b) => buf[a][1] - buf[b][1]);
      const cut = Math.floor(buf.length * threshold);
      const keep = new Set(sorted.slice(cut, buf.length - cut));
      return buf.filter((_, i) => keep.has(i));
    }

    // STD_DEV: Mahalanobis-like distance from mean
    const dim = buf[0].length;
    const mean = Array.from({ length: dim }, (_, d) => buf.reduce((s, r) => s + r[d], 0) / buf.length);
    const dists = buf.map(r => Math.sqrt(r.reduce((s, v, d) => s + (v - mean[d]) ** 2, 0)));
    const mu = dists.reduce((a, b) => a + b, 0) / dists.length;
    const sigma = Math.sqrt(dists.reduce((s, d) => s + (d - mu) ** 2, 0) / dists.length);
    const limit = mu + threshold * sigma;
    return buf.filter((_, i) => dists[i] <= limit);
  }
}
