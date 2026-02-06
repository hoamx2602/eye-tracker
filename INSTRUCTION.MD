
# Precision Web-Based Eye Tracking System
## Technical Architecture & Algorithm Documentation

This document details the technologies, mathematical models, signal processing pipelines, and configuration options implemented to achieve high-precision, webcam-based eye tracking directly in the browser.

---

## 1. Core Technologies

*   **Frontend Framework**: React 19 (TypeScript) + Vite.
*   **Computer Vision**: Google MediaPipe Face Landmarker (Vision Tasks).
    *   *Model*: `face_landmarker.task` (Float16 GPU Delegate).
    *   *Features*: Detects 478 3D facial landmarks in real-time.
*   **Styling**: Tailwind CSS (for UI/UX overlays).
*   **State Management**: React Hooks (`useRef` for high-frequency loop data, `useState` for UI).

---

## 2. The Vision Pipeline

### A. Feature Extraction (`EyeTrackingService.ts`)
Instead of using raw pixel data, we extract a sophisticated feature vector from the 3D face mesh:
1.  **Pupil Centroid**: Landmarks 468 (Left) and 473 (Right).
2.  **Eye Corner Normalization**: We calculate the pupil's position relative to the eye corners (Inner/Outer) to create a normalized coordinate system (0.0 to 1.0) for each eye. This makes the system robust to distance changes.
3.  **Head Pose Estimation**: using geometric calculation from nose, chin, and ear landmarks to compute:
    *   **Pitch**: Up/Down rotation.
    *   **Yaw**: Left/Right rotation.
    *   **Roll**: Tilt.
4.  **Feature Vector**: The model input is a flat vector containing:
    *   Normalized Gaze (Left X, Left Y, Right X, Right Y)
    *   Polar coordinates (Radius, Theta) of the iris
    *   Head Pose (Pitch, Yaw, Roll)
    *   Cross-terms (interaction features like `GazeX * Yaw`) to compensate for head movement distortions.

### B. Head Validation Logic
To ensure data quality before calibration begins, a strict validation logic runs continuously:
*   **Centering**: Checks if the nose tip is within a 12% tolerance zone of the frame center.
*   **Distance (Z-Axis)**: Uses inter-cheek distance relative to frame width to enforce a ~50-70cm range.
*   **Tilt**: Ensures the head is vertical (Roll < 12 degrees).

---

## 3. Calibration & Regression Algorithms

Mapping eye features to screen coordinates (X, Y) is a non-linear problem due to screen curvature perception and lens distortion. We support three regression strategies:

### A. Thin Plate Splines (TPS) - *Recommended*
*   **Theory**: A physical analogy involving the bending of a thin sheet of metal. It minimizes an energy function balancing "smoothness" and "fit".
*   **Why**: Unlike linear regression, TPS can model **non-linear local distortions** on the screen edges.
*   **Implementation**: 
    *   Uses Radial Basis Functions ($r^2 \ln r$).
    *   Solves the linear system $(K + \lambda I)W = V$ where $K$ is the kernel matrix.
    *   Includes regularization ($\lambda$) to prevent overfitting to noise.

### B. Hybrid Regression (Ridge + k-NN)
*   **Step 1 (Global)**: Uses **Ridge Regression** (Linear Least Squares with L2 regularization) to determine the general gaze direction.
*   **Step 2 (Local)**: Uses **k-Nearest Neighbors (k=4)** on the training residuals. It finds the closest calibration points to the current input and adds a weighted correction vector.
*   **Benefit**: Good balance between stability (Ridge) and local accuracy (kNN).

### C. Ridge Regression
*   A pure linear mapping. Fast but less accurate at screen corners.

---

## 4. Signal Processing & Smoothing

Raw gaze data from webcams is noisy. We implement a multi-stage filtering pipeline (`GazeSmoother.ts`):

### A. Saccade Detection
*   **Problem**: Heavy smoothing causes "lag" when the user intentionally looks at a new target.
*   **Solution**: If the distance between the current point and the last point exceeds `saccadeThreshold` (e.g., 50px), the filter is temporarily bypassed/reset. This allows **instant responsiveness** for large movements while keeping microsaccades smooth.

### B. 1€ Filter (One Euro Filter) - *Default*
*   An adaptive low-pass filter.
*   **Jitter Reduction (`minCutoff`)**: High filtering when the eye is still.
*   **Lag Reduction (`beta`)**: Reduces filtering strength as speed increases.
*   **Result**: Cursor is rock-solid when staring, but moves instantly when looking around.

### C. Kalman Filter
*   A predictive recursive filter that estimates the state of a dynamic system.
*   Uses Process Noise (`Q`) and Measurement Noise (`R`) matrices.
*   Best for predicting trajectories but computationally heavier.

---

## 5. Data Acquisition Methods

High-quality calibration data is essential.

### A. Method 1: Auto Timer
*   User stares at a point, system waits, then captures.
*   *Pros*: Hands-free.
*   *Cons*: User might blink or lose focus during the capture window.

### B. Method 2: Click & Hold (Active Attention) - *New*
*   User must Click and Hold the calibration dot.
*   **Active Attention**: The physical act of clicking forces the brain to lock visual focus on the target.
*   **Temporal Trimming**: The system records frames while holding, but **discards the first 20% and last 20%**.
    *   *Why?* The moment of clicking introduces "finger tremor" (jitter). The moment of releasing implies "anticipation" (eye starts moving away). The middle 60% is the cleanest data.

### C. Data Hygiene (Outlier Removal)
Before training the model, raw samples are cleaned:
*   **Trim Tails**: Removes the top/bottom X% of values for each feature.
*   **Std Dev**: Removes samples more than $n$ standard deviations from the mean (Statistical filtering).

---

## 6. Optimization Options (Settings)

The system is fully configurable via the Settings Modal:

| Category | Option | Description | Recommended |
| :--- | :--- | :--- | :--- |
| **Mapping** | Regression Method | Algorithm to map eyes to screen. | **TPS** (Best accuracy) |
| **Smoothing** | Filter Type | Algorithm to reduce jitter. | **1€ Filter** |
| | MinCutoff | Stabilizing factor when still. | **0.005 - 0.01** |
| | Beta | Speed factor when moving. | **0.01 - 0.1** |
| | Saccade Thresh | Distance to bypass smoothing. | **50px - 100px** |
| **Calibration** | Method | How to collect data. | **Click & Hold** |
| | Click Duration | Time required to hold click. | **1.0s - 1.5s** |
| **Data** | Outlier Method | Removing bad frames. | **Trim Tails (25%)** |
| **Recording** | Video Recording | Capture full session + face crops. | **On** |

---

## 7. Performance & Privacy

*   **GPU Acceleration**: MediaPipe uses WebGL/GPU delegates for landmark detection.
*   **Local Processing**: All calculations (Vision, Regression, Smoothing) happen **90% in the browser**. No video data is ever sent to a server.
*   **Memory Management**: Custom matrix classes avoid the overhead of heavy math libraries (like math.js), using optimized typed arrays.
