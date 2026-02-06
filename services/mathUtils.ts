import { RegressionMethod, SmoothingMethod, OutlierMethod } from "../types";

/**
 * Matrix Math Utilities
 */
export class Matrix {
  static transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
  }

  static multiply(a: number[][], b: number[][]): number[][] {
    const rowsA = a.length, colsA = a[0].length;
    const rowsB = b.length, colsB = b[0].length;
    if (colsA !== rowsB) throw new Error("Matrix dimensions do not match for multiplication.");

    const result = new Array(rowsA).fill(0).map(() => new Array(colsB).fill(0));
    for (let i = 0; i < rowsA; i++) {
        for (let j = 0; j < colsB; j++) {
            let sum = 0;
            for (let k = 0; k < colsA; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
  }

  // Gaussian Elimination for Inversion
  static invert(A: number[][]): number[][] | null {
    const n = A.length;
    // Create augmented matrix [A | I]
    const M = A.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);

    for (let i = 0; i < n; i++) {
        // Find pivot
        let pivot = M[i][i];
        let pivotRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(pivot)) {
                pivot = M[k][i];
                pivotRow = k;
            }
        }

        // Singular matrix
        if (Math.abs(pivot) < 1e-10) return null;

        // Swap rows
        [M[i], M[pivotRow]] = [M[pivotRow], M[i]];

        // Normalize row i
        for (let j = 0; j < 2 * n; j++) {
            M[i][j] /= pivot;
        }

        // Eliminate other rows
        for (let k = 0; k < n; k++) {
            if (k !== i) {
                const factor = M[k][i];
                for (let j = 0; j < 2 * n; j++) {
                    M[k][j] -= factor * M[i][j];
                }
            }
        }
    }

    return M.map(row => row.slice(n));
  }

  static solveLeastSquares(inputs: number[][], outputs: number[][]): number[][] | null {
    try {
      const X = inputs; 
      const Y = outputs; 
      const XT = Matrix.transpose(X);
      const XTX = Matrix.multiply(XT, X);
      
      const lambda = 0.001; // Ridge Regularization
      for(let i=0; i<XTX.length; i++) XTX[i][i] += lambda;

      const XTX_Inv = Matrix.invert(XTX);
      if (!XTX_Inv) return null;

      const XTY = Matrix.multiply(XT, Y);
      return Matrix.multiply(XTX_Inv, XTY);
    } catch (e) {
      return null;
    }
  }
}

/**
 * Thin Plate Spline (TPS) Regressor
 * Ideally suited for non-linear warping (like eye tracking on a screen).
 */
export class TPSRegressor {
  private controlPoints: number[][] = []; // The 'V' (source features)
  private weights: number[][] | null = null; // The 'w' coefficients
  private regularization: number = 0.5; // lambda > 0 makes it a "smoothing" spline (robust to noise)
  
  // FIX: Use specific indices to avoid singularity and overfitting.
  // 0 is Bias (Skip). 
  // 1=lx, 2=ly, 3=rx, 4=ry. 
  // We assume these exist in the input vector.
  // Using only 4 dims means we need N >= 5 points, which matches our Step 1 count.
  private featureIndices = [1, 2, 3, 4]; 

  private radialBasis(r: number): number {
    if (r === 0) return 0;
    return r * r * Math.log(r);
  }
  
  isReady(): boolean {
      return this.weights !== null;
  }
  
  private extractFeatures(input: number[]): number[] {
      return this.featureIndices.map(i => input[i] || 0);
  }

  train(fullInputs: number[][], outputs: number[][]): boolean {
    // 1. Filter inputs to reduced dimensionality
    const inputs = fullInputs.map(row => this.extractFeatures(row));
    
    const N = inputs.length; 
    const D = inputs[0].length;
    
    if (N < D + 1) {
        console.warn(`TPS: Not enough points. Need ${D+1}, got ${N}`);
        return false;
    }
    
    this.controlPoints = inputs;
    
    // 2. Construct Matrix L = [[K + lambda*I, P], [P^T, 0]]
    // K is NxN matrix of RBF distances
    const K: number[][] = Array(N).fill(0).map(() => Array(N).fill(0));
    for (let i = 0; i < N; i++) {
        for (let j = i; j < N; j++) {
            let dist = 0;
            for(let k=0; k<D; k++) {
                dist += (inputs[i][k] - inputs[j][k]) ** 2;
            }
            dist = Math.sqrt(dist);
            const val = this.radialBasis(dist);
            K[i][j] = val;
            K[j][i] = val; // Symmetric
        }
        K[i][i] += this.regularization;
    }

    // P is Nx(D+1). We manually add the bias column here.
    const P: number[][] = Array(N).fill(0).map((_, i) => [1, ...inputs[i]]);
    const PT = Matrix.transpose(P);

    // Assemble L matrix
    const totalDim = N + D + 1;
    const L: number[][] = Array(totalDim).fill(0).map(() => Array(totalDim).fill(0));

    // Fill K
    for(let i=0; i<N; i++) {
        for(let j=0; j<N; j++) L[i][j] = K[i][j];
    }
    // Fill P
    for(let i=0; i<N; i++) {
        for(let j=0; j<D+1; j++) L[i][N+j] = P[i][j];
    }
    // Fill PT
    for(let i=0; i<D+1; i++) {
        for(let j=0; j<N; j++) L[N+i][j] = PT[i][j];
    }

    // 3. Construct Vector V (Targets padded with 0s)
    const V: number[][] = Array(totalDim).fill(0).map((_, i) => {
        if (i < N) return outputs[i];
        return [0, 0];
    });

    // 4. Solve L * W = V
    const L_inv = Matrix.invert(L);
    if (!L_inv) {
        console.warn("TPS Matrix Singular - Fallback to Ridge");
        this.weights = null;
        return false;
    }

    this.weights = Matrix.multiply(L_inv, V);
    return true;
  }

  predict(fullInput: number[]): { x: number, y: number } {
    if (!this.weights || this.controlPoints.length === 0) return { x: 0, y: 0 };
    
    const input = this.extractFeatures(fullInput);
    const N = this.controlPoints.length;
    const D = input.length;
    
    let resX = 0;
    let resY = 0;

    // 1. Weighted RBFs
    for (let i = 0; i < N; i++) {
        let dist = 0;
        for (let k = 0; k < D; k++) {
            dist += (input[k] - this.controlPoints[i][k]) ** 2;
        }
        dist = Math.sqrt(dist);
        const u = this.radialBasis(dist);
        
        resX += this.weights[i][0] * u;
        resY += this.weights[i][1] * u;
    }

    // 2. Affine part
    // weights[N] is bias
    resX += this.weights[N][0]; 
    resY += this.weights[N][1]; 

    for (let j = 0; j < D; j++) {
        resX += this.weights[N + 1 + j][0] * input[j];
        resY += this.weights[N + 1 + j][1] * input[j];
    }

    return { x: resX, y: resY };
  }
}

/**
 * Hybrid Regressor (Ridge + kNN)
 */
export class HybridRegressor {
  private weights: number[][] | null = null;
  private trainingData: { input: number[], output: number[], error: number[] }[] = [];
  
  // TPS Instance
  private tps: TPSRegressor = new TPSRegressor();

  train(inputs: number[][], outputs: number[][]): boolean {
    // 1. Train Ridge (Always required as fallback)
    this.weights = Matrix.solveLeastSquares(inputs, outputs);
    if (!this.weights) return false;

    // Residuals for kNN
    this.trainingData = inputs.map((input, i) => {
      const predicted = this.predictLinear(input);
      const actual = outputs[i];
      const error = [actual[0] - predicted[0], actual[1] - predicted[1]];
      return { input, output: actual, error };
    });

    // 2. Train TPS
    try {
        const tpsSuccess = this.tps.train(inputs, outputs);
        if (!tpsSuccess) console.log("TPS Init failed (Singular), using Ridge.");
    } catch(e) {
        console.warn("TPS Training Exception", e);
    }

    return true;
  }

  private predictLinear(input: number[]): number[] {
    if (!this.weights) return [0, 0];
    let x = 0, y = 0;
    for (let i = 0; i < input.length; i++) {
      x += input[i] * this.weights[i][0];
      y += input[i] * this.weights[i][1];
    }
    return [x, y];
  }

  predict(input: number[], method: RegressionMethod = RegressionMethod.HYBRID): { x: number, y: number } {
    
    // Fallback logic: If TPS requested but not ready, downgrade to Hybrid/Ridge
    if (method === RegressionMethod.TPS && this.tps.isReady()) {
        return this.tps.predict(input);
    }

    if (!this.weights || this.trainingData.length === 0) return { x: 0, y: 0 };

    const [globalX, globalY] = this.predictLinear(input);

    if (method === RegressionMethod.RIDGE) {
      return { x: globalX, y: globalY };
    }

    // Hybrid: k-NN Residual Correction (k=4)
    const k = 4;
    const distances = this.trainingData.map(data => {
      let distSq = 0;
      for (let i = 0; i < input.length; i++) {
        const diff = input[i] - data.input[i];
        distSq += diff * diff;
      }
      return { ...data, dist: Math.sqrt(distSq) };
    });

    distances.sort((a, b) => a.dist - b.dist);
    const neighbors = distances.slice(0, k);

    let totalWeight = 0;
    let correctionX = 0;
    let correctionY = 0;

    for (const n of neighbors) {
      const weight = 1.0 / (n.dist + 0.0001); 
      correctionX += n.error[0] * weight;
      correctionY += n.error[1] * weight;
      totalWeight += weight;
    }

    correctionX /= totalWeight;
    correctionY /= totalWeight;

    return { 
      x: globalX + correctionX, 
      y: globalY + correctionY 
    };
  }
}

/**
 * --- SMOOTHING FILTERS ---
 */

class LowPassFilter {
  y: number;
  s: number;
  constructor(alpha: number, initval: number = 0) {
    this.y = initval;
    this.s = initval;
  }
  filterWithAlpha(value: number, alpha: number) {
    this.s = alpha * value + (1 - alpha) * this.s;
    return this.s;
  }
}

export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dcutoff: number;
  xFilter: LowPassFilter;
  dxFilter: LowPassFilter;
  tPrev: number;

  constructor(minCutoff: number = 1.0, beta: number = 0.0, dcutoff: number = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.xFilter = new LowPassFilter(0, 0);
    this.dxFilter = new LowPassFilter(0, 0);
    this.tPrev = 0;
  }
  
  updateParams(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(value: number, timestamp: number = -1): number {
    if (this.tPrev === 0) {
        this.tPrev = timestamp;
        this.xFilter.s = value;
        this.dxFilter.s = 0;
        return value;
    }
    let dt = (timestamp - this.tPrev) / 1000.0;
    if(dt <= 0) dt = 0.001; 

    const dx = (value - this.xFilter.s) / dt;
    const edx = this.dxFilter.filterWithAlpha(dx, this.alpha(this.dcutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.xFilter.filterWithAlpha(value, this.alpha(cutoff, dt));
    this.tPrev = timestamp;
    return result;
  }
  reset() {
      this.tPrev = 0;
      this.xFilter.s = 0;
      this.dxFilter.s = 0;
  }
}

export class MovingAverageFilter {
    private windowSize: number;
    private buffer: number[];

    constructor(windowSize: number = 5) {
        this.windowSize = windowSize;
        this.buffer = [];
    }

    updateParams(windowSize: number) {
        this.windowSize = windowSize;
        if (this.buffer.length > windowSize) {
            this.buffer = this.buffer.slice(this.buffer.length - windowSize);
        }
    }

    filter(value: number): number {
        this.buffer.push(value);
        if (this.buffer.length > this.windowSize) {
            this.buffer.shift();
        }
        const sum = this.buffer.reduce((a, b) => a + b, 0);
        return sum / this.buffer.length;
    }

    reset() {
        this.buffer = [];
    }
}

export class KalmanFilter {
    private R: number; 
    private Q: number; 
    private x: number; 
    private p: number; 
    private k: number; 
    private initialized: boolean = false;

    constructor(R: number = 1, Q: number = 1) {
        this.R = R;
        this.Q = Q;
        this.x = 0;
        this.p = 0;
        this.k = 0;
    }

    updateParams(Q: number, R: number) {
        this.Q = Q;
        this.R = R;
    }

    filter(value: number): number {
        if (!this.initialized) {
            this.x = value;
            this.p = 1;
            this.initialized = true;
            return value;
        }
        this.p = this.p + this.Q;
        this.k = this.p / (this.p + this.R);
        this.x = this.x + this.k * (value - this.x);
        this.p = (1 - this.k) * this.p;
        return this.x;
    }

    reset() {
        this.initialized = false;
        this.x = 0;
        this.p = 0;
    }
}

// Wrapper class for 2D Smoothing with Saccade Detection
export class GazeSmoother {
    method: SmoothingMethod = SmoothingMethod.ONE_EURO;
    saccadeThreshold: number = 50;
    
    private lastX: number = 0;
    private lastY: number = 0;
    
    // Filters
    oneEuroX: OneEuroFilter;
    oneEuroY: OneEuroFilter;
    
    maX: MovingAverageFilter;
    maY: MovingAverageFilter;
    
    kalmanX: KalmanFilter;
    kalmanY: KalmanFilter;

    constructor(minCutoff: number, beta: number) {
        this.oneEuroX = new OneEuroFilter(minCutoff, beta);
        this.oneEuroY = new OneEuroFilter(minCutoff, beta);
        
        this.maX = new MovingAverageFilter(5);
        this.maY = new MovingAverageFilter(5);
        
        this.kalmanX = new KalmanFilter(0.1, 0.1);
        this.kalmanY = new KalmanFilter(0.1, 0.1);
    }
    
    updateConfig(method: SmoothingMethod, params: any) {
        this.method = method;
        this.saccadeThreshold = params.saccadeThreshold || 50;

        this.oneEuroX.updateParams(params.minCutoff, params.beta);
        this.oneEuroY.updateParams(params.minCutoff, params.beta);
        
        this.maX.updateParams(params.maWindow);
        this.maY.updateParams(params.maWindow);
        
        this.kalmanX.updateParams(params.kalmanQ, params.kalmanR);
        this.kalmanY.updateParams(params.kalmanQ, params.kalmanR);
    }
    
    process(x: number, y: number, timestamp: number) {
        // SACCADE DETECTION
        // Calculate raw distance from last filtered point
        const dist = Math.sqrt(Math.pow(x - this.lastX, 2) + Math.pow(y - this.lastY, 2));
        
        // If the jump is massive (Saccade), temporarily bypass or reset filters to avoid lag
        let isSaccade = dist > this.saccadeThreshold;
        
        // If it is a saccade, we might want to reset the filter to catch up instantly
        // For OneEuro, we can just feed it, but for MA/Kalman, reset might be better.
        // Here we perform a "Soft Reset" by forcing the filter to jump closer to raw value
        
        if (isSaccade) {
             // Optional: You could log this event
             // Force state to current position to eliminate lag tail
             if (this.method === SmoothingMethod.KALMAN) {
                 this.kalmanX.reset();
                 this.kalmanY.reset();
             } else if (this.method === SmoothingMethod.MOVING_AVERAGE) {
                 this.maX.reset();
                 this.maY.reset();
             }
        }

        let result = { x, y };

        switch (this.method) {
            case SmoothingMethod.ONE_EURO:
                result = {
                    x: this.oneEuroX.filter(x, timestamp),
                    y: this.oneEuroY.filter(y, timestamp)
                };
                break;
            case SmoothingMethod.MOVING_AVERAGE:
                result = {
                    x: this.maX.filter(x),
                    y: this.maY.filter(y)
                };
                break;
            case SmoothingMethod.KALMAN:
                result = {
                    x: this.kalmanX.filter(x),
                    y: this.kalmanY.filter(y)
                };
                break;
            case SmoothingMethod.NONE:
            default:
                result = { x, y };
        }
        
        this.lastX = result.x;
        this.lastY = result.y;
        return result;
    }
    
    reset() {
        this.oneEuroX.reset();
        this.oneEuroY.reset();
        this.maX.reset();
        this.maY.reset();
        this.kalmanX.reset();
        this.kalmanY.reset();
        this.lastX = 0;
        this.lastY = 0;
    }
}

/**
 * --- DATA HYGIENE (OUTLIER REMOVAL) ---
 */
export class DataCleaner {
    static clean(buffer: number[][], method: OutlierMethod, threshold: number): number[][] {
        if (buffer.length < 5 || method === OutlierMethod.NONE) {
            return buffer;
        }
        
        const numFeatures = buffer[0].length;
        const columns = new Array(numFeatures).fill(0).map(() => [] as number[]);
        
        for (const row of buffer) {
            for (let i = 0; i < numFeatures; i++) {
                columns[i].push(row[i]);
            }
        }
        
        let indicesToKeep = new Set<number>(buffer.map((_, i) => i));

        if (method === OutlierMethod.TRIM_TAILS) {
            const refIndex = 1; 
            const sortedIndices = buffer.map((_, i) => i).sort((a, b) => buffer[a][refIndex] - buffer[b][refIndex]);
            
            const removeCount = Math.floor(buffer.length * threshold); 
            const lowerCut = removeCount;
            const upperCut = buffer.length - removeCount;
            
            indicesToKeep = new Set(sortedIndices.slice(lowerCut, upperCut));
        }
        else if (method === OutlierMethod.STD_DEV) {
            const meanVector = columns.map(col => col.reduce((a,b) => a+b, 0) / col.length);
            const distances = buffer.map(row => {
                let sumSq = 0;
                for(let i=0; i<numFeatures; i++) sumSq += Math.pow(row[i] - meanVector[i], 2);
                return Math.sqrt(sumSq);
            });
            
            const distMean = distances.reduce((a,b) => a+b, 0) / distances.length;
            const distSqDiffs = distances.map(d => Math.pow(d - distMean, 2));
            const distStdDev = Math.sqrt(distSqDiffs.reduce((a,b) => a+b, 0) / distances.length);
            
            const limit = distMean + (threshold * distStdDev); 
            
            indicesToKeep = new Set();
            distances.forEach((d, i) => {
                if (d <= limit) indicesToKeep.add(i);
            });
        }

        return buffer.filter((_, i) => indicesToKeep.has(i));
    }
}