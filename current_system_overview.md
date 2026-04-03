# Solution Architecture Report - Eye Tracking System

## Đánh giá tổng quan

Hệ thống đã có kiến trúc tốt: Worker-based pipeline, modular engine abstraction, multi-model regression (Ridge/TPS/Hybrid), và adaptive filtering (One-Euro/Kalman). Tuy nhiên, so với commercial-grade (Tobii), có **3 bottleneck nghiêm trọng** và một số thiếu sót chiến lược.

---

## 3 Bottleneck Nghiêm Trọng Nhất

### 1. Không có Drift Compensation (Nghiêm trọng nhất)

**Vấn đề:** Hệ thống **hoàn toàn không có online drift correction**. Sau calibration, gaze mapping là static — nhưng thực tế:
- Người dùng di chuyển đầu/ghế dần dần
- Webcam có thể bị rung nhẹ
- Ánh sáng thay đổi → pupil detection shift

Tobii giải quyết bằng **continuous micro-recalibration**. Hệ thống hiện tại chỉ có fixation boosting (tăng smoothing) — đây là **che giấu triệu chứng, không phải sửa gốc**.

**Giải pháp đề xuất — Implicit Drift Correction:**

```
Khi phát hiện fixation ổn định (variance < threshold):
  → Ghi nhận (predicted_gaze, fixation_center) pair
  → Tính offset = mean(predicted - actual) trên N fixation gần nhất
  → Áp dụng correction vector: gaze_corrected = gaze_raw - offset
  → Decay offset dần theo thời gian (exponential moving average)
```

Cụ thể, cần thêm vào pipeline sau bước regression, trước smoothing:

- **Fixation Detector**: Dùng dispersion-based (IDT) — nếu N frame liên tục trong bán kính R pixels → fixation
- **Drift Estimator**: Accumulate fixation centroids, tính running offset vector
- **Correction Applicator**: Trừ offset trước khi feed vào smoother

### 2. One-Euro Filter Parameters Là Static

**Vấn đề:** `minCutoff=0.005`, `beta=0.01` là hardcoded. Nhưng:
- Ở 30fps, mỗi frame = 33ms → velocity estimation thô
- Ở 15fps (máy yếu), cùng parameter sẽ cho kết quả rất khác
- Không có auto-tuning dựa trên actual frame rate

**Giải pháp — Dynamic Parameter Scaling:**

```typescript
// Auto-tune One-Euro based on actual FPS
function computeOneEuroParams(actualFps: number) {
  const refFps = 30;
  const fpsRatio = actualFps / refFps;

  return {
    // Lower FPS → need more aggressive smoothing (lower cutoff)
    minCutoff: 0.005 / Math.sqrt(fpsRatio),
    // Lower FPS → velocity estimates noisier → reduce beta
    beta: 0.01 * Math.sqrt(fpsRatio),
    // Derivative cutoff scales with FPS
    dcutoff: 1.0 * fpsRatio,
  };
}
```

Ngoài ra, cần **saccade threshold cũng scale theo FPS**: ở 15fps, một saccade có thể nhảy xa hơn trong 1 frame so với 30fps.

### 3. Confidence Score Quá Đơn Giản (Binary)

**Vấn đề:** Confidence hiện tại chỉ là: EAR > 0.18 → 1.0, else → 0.3. Đây là **binary**, không phản ánh quality thực.

Một frame có thể có EAR > 0.18 nhưng vẫn kém chất lượng vì:
- Face detection confidence thấp
- Iris landmark jitter cao
- Head rotation quá lớn (góc nhìn xiên)
- Lighting không đều

**Giải pháp — Multi-Factor Confidence Score:**

```typescript
function computeConfidence(landmarks, faceConfidence, headPose, prevFeatures) {
  let score = 1.0;

  // 1. Face detection confidence (from MediaPipe)
  score *= clamp(faceConfidence, 0.5, 1.0);

  // 2. Eye openness (continuous, not binary)
  const earScore = smoothstep(0.15, 0.25, Math.min(leftEAR, rightEAR));
  score *= earScore;

  // 3. Head angle penalty (gaze less reliable at extreme angles)
  const anglePenalty = Math.max(0.3, 1 - (Math.abs(yaw) + Math.abs(pitch)) / Math.PI);
  score *= anglePenalty;

  // 4. Temporal consistency (iris jitter = low quality)
  if (prevFeatures) {
    const irisJitter = distance(currentIris, prevIris);
    const jitterPenalty = Math.max(0.2, 1 - irisJitter / maxExpectedJitter);
    score *= jitterPenalty;
  }

  return score;
}
```

Confidence này sau đó nên **weight vào smoother** — frame quality thấp → tăng smoothing/hold.

---

## Các Thiếu Sót Bổ Sung & Giải Pháp

### 4. Không có Confidence-Weighted Calibration

**Vấn đề:** Trong calibration, mọi data point đều equal weight. Nhưng:
- Points ở **center** screen dễ nhìn chính xác hơn corners
- Points thu được khi user mới bắt đầu fixate (đầu dwell) kém hơn cuối dwell

**Giải pháp:**
- Weight center points 1.0×, corner points 0.6-0.8× (distance from center)
- Weight đầu dwell 0.5×, cuối dwell 1.0× (temporal ramp)
- Feed weights vào Weighted Ridge (đã có sẵn `solveWeightedRidge`)

### 5. Pupil Size Jitter Chưa Được Filter

**Vấn đề:** Ánh sáng thay đổi → pupil dilation/constriction → iris landmark shift → fake gaze movement. Hệ thống dùng iris center trực tiếp mà không compensate cho pupil size.

**Giải pháp:**
- Track pupil diameter (khoảng cách vertical iris landmarks) qua frames
- Low-pass filter pupil size riêng (cutoff rất thấp, ~0.5Hz)
- Khi pupil size thay đổi nhanh (>threshold): reduce confidence, increase smoothing

### 6. Không Có Auto-Config Detection

**Vấn đề:** User phải chọn manual: regression method, filter params, glasses mode, etc.

**Giải pháp — Strategic Config Manager:**
- **Pre-calibration (3-5 giây đầu):**
  - Đo actual FPS → auto-tune filter params
  - Đo face detection confidence variability → detect glasses/lighting issues
  - Đo head pose stability → recommend calibration point count
- **Post-calibration:**
  - Nếu LOOCV Ridge < 15px: dùng Ridge (đủ tốt, nhanh hơn)
  - Nếu LOOCV Ridge > 20px nhưng TPS < 12px: dùng TPS
  - Nếu cả hai > 20px: recommend recalibrate

---

## Priority Implementation Order

| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Drift Compensation (Fixation-based) | Cao nhất — accuracy degrades over time | Medium |
| **P1** | Multi-factor Confidence Score | Cải thiện filtering + user feedback | Low |
| **P1** | Dynamic One-Euro tuning theo FPS | Ổn định trên máy yếu | Low |
| **P2** | Confidence-weighted Calibration | Tăng accuracy 10-15% | Low |
| **P2** | Auto-Config Manager | UX improvement | Medium |
| **P3** | Pupil dilation compensation | Edge case improvement | Medium |
