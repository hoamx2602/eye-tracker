/**
 * Simple Matrix Math for Least Squares Regression
 */

export class Matrix {
  static transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
  }

  static multiply(a: number[][], b: number[][]): number[][] {
    const result = new Array(a.length).fill(0).map(() => new Array(b[0].length).fill(0));
    return result.map((row, i) =>
      row.map((val, j) =>
        a[i].reduce((sum, elm, k) => sum + elm * b[k][j], 0)
      )
    );
  }

  static invert(matrix: number[][]): number[][] | null {
    // Gaussian elimination for matrix inversion (simplified for square matrices)
    // Note: For production, use a robust library like math.js or gl-matrix.
    // This is a basic implementation for the purpose of the demo.
    const size = matrix.length;
    const augmented = matrix.map((row, i) => [...row, ...Array(size).fill(0).map((_, j) => (i === j ? 1 : 0))]);

    for (let i = 0; i < size; i++) {
      let pivot = augmented[i][i];
      if (Math.abs(pivot) < 1e-8) return null; // Singular matrix

      for (let j = 0; j < 2 * size; j++) {
        augmented[i][j] /= pivot;
      }

      for (let k = 0; k < size; k++) {
        if (k !== i) {
          const factor = augmented[k][i];
          for (let j = 0; j < 2 * size; j++) {
            augmented[k][j] -= factor * augmented[i][j];
          }
        }
      }
    }

    return augmented.map(row => row.slice(size));
  }

  // Solves Y = X * Beta for Beta using (X^T * X)^-1 * X^T * Y
  static solveLeastSquares(inputs: number[][], outputs: number[][]): number[][] | null {
    try {
      const X = inputs; // N samples x M features (augmented with 1 for bias)
      const Y = outputs; // N samples x 2 outputs (Screen X, Screen Y)

      const XT = Matrix.transpose(X);
      const XTX = Matrix.multiply(XT, X);
      
      // Add slight regularization (Ridge) to avoid singular matrix issues
      const lambda = 0.001; 
      for(let i=0; i<XTX.length; i++) XTX[i][i] += lambda;

      const XTX_Inv = Matrix.invert(XTX);
      
      if (!XTX_Inv) {
        console.error("Matrix Inversion Failed: Singular Matrix");
        return null;
      }

      const XTY = Matrix.multiply(XT, Y);
      const Beta = Matrix.multiply(XTX_Inv, XTY);

      return Beta; // M features x 2 outputs
    } catch (e) {
      console.error("Regression failed", e);
      return null;
    }
  }

  // RANSAC Implementation for Robust Regression
  static solveRANSAC(inputs: number[][], outputs: number[][], iterations: number = 50, sampleSize: number = 6, threshold: number = 50): number[][] | null {
    const N = inputs.length;
    if (N < sampleSize) return Matrix.solveLeastSquares(inputs, outputs);

    let bestModel: number[][] | null = null;
    let maxInliers = -1;

    for (let i = 0; i < iterations; i++) {
      // 1. Random Sample
      const indices: number[] = [];
      while (indices.length < sampleSize) {
        const idx = Math.floor(Math.random() * N);
        if (!indices.includes(idx)) indices.push(idx);
      }
      
      const X_subset = indices.map(idx => inputs[idx]);
      const Y_subset = indices.map(idx => outputs[idx]);

      // 2. Fit Model
      const model = Matrix.solveLeastSquares(X_subset, Y_subset);
      if (!model) continue;

      // 3. Count Inliers
      let inliers = 0;
      for (let j = 0; j < N; j++) {
        // Prediction
        let pX = 0, pY = 0;
        for (let k = 0; k < inputs[j].length; k++) {
          pX += inputs[j][k] * model[k][0];
          pY += inputs[j][k] * model[k][1];
        }

        const err = Math.sqrt(Math.pow(pX - outputs[j][0], 2) + Math.pow(pY - outputs[j][1], 2));
        if (err < threshold) inliers++;
      }

      // 4. Update Best
      if (inliers > maxInliers) {
        maxInliers = inliers;
        bestModel = model;
      }
    }

    return bestModel || Matrix.solveLeastSquares(inputs, outputs);
  }
}

/**
 * Exponential Moving Average for Smoothing Gaze
 */
export class KalmanSmoother {
  private x: number = 0;
  private y: number = 0;
  private alpha: number; // Smoothing factor (0 < alpha < 1). Lower = smoother but more lag.

  constructor(alpha: number = 0.2) {
    this.alpha = alpha;
  }

  process(newX: number, newY: number): { x: number, y: number } {
    // First run initialization
    if (this.x === 0 && this.y === 0) {
      this.x = newX;
      this.y = newY;
      return { x: this.x, y: this.y };
    }

    // Simple Exponential Smoothing
    this.x = this.alpha * newX + (1 - this.alpha) * this.x;
    this.y = this.alpha * newY + (1 - this.alpha) * this.y;

    return { x: this.x, y: this.y };
  }
  
  reset() {
    this.x = 0;
    this.y = 0;
  }
}