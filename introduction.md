# Precision Eye Tracker — Project Introduction

## 1. Tổng Quan (Overview)

**Precision Eye Tracker** là một hệ thống theo dõi ánh mắt (eye-tracking) **hoàn toàn chạy trên trình duyệt web**, sử dụng webcam tiêu chuẩn — không yêu cầu phần cứng chuyên dụng nào. Hệ thống có khả năng xác định vị trí người dùng đang nhìn trên màn hình trong thời gian thực (real-time), với độ chính xác cao nhờ các thuật toán hồi quy phi tuyến và bộ lọc tín hiệu thông minh.

### Mục tiêu chính:
- **Không phần cứng chuyên dụng**: Chỉ cần một webcam (built-in hoặc USB).
- **100% client-side**: Toàn bộ xử lý (computer vision, regression, smoothing) diễn ra trong trình duyệt. Không có video hay dữ liệu nào được gửi lên server — đảm bảo **quyền riêng tư tuyệt đối**.
- **Độ chính xác cao (sub-300px mean error)** nhờ kết hợp nhiều thuật toán học máy và xử lý tín hiệu.
- **Ứng dụng**: Nghiên cứu UX, hỗ trợ chẩn đoán y tế (thần kinh, nhãn khoa), accessibility, gaming.

---

## 2. Technology Stack

| Layer               | Technology                                               |
| :------------------ | :------------------------------------------------------- |
| **Frontend**        | React 19 (TypeScript) + Vite                             |
| **Styling**         | Tailwind CSS v4                                          |
| **Computer Vision** | Google MediaPipe Face Landmarker (Float16, GPU Delegate)  |
| **State**           | React Hooks (`useRef` cho high-frequency loop, `useState` cho UI) |
| **Math Engine**     | Custom pure-TypeScript matrix/regression/filter classes   |

> Không sử dụng thư viện toán nặng (math.js, TensorFlow.js cho regression, v.v.). Tất cả đều được viết tay (from scratch) để tối ưu hiệu năng với typed arrays.

---

## 3. Luồng Hoạt Động (User Flow)

```
┌──────────────┐      ┌──────────────────┐      ┌────────────────┐      ┌──────────────┐
│   1. IDLE    │ ───▶ │ 2. HEAD POSITION │ ───▶ │ 3. CALIBRATION │ ───▶ │ 4. TRACKING  │
│  (Start UI)  │      │   (Validation)   │      │  (9-pt Grid)   │      │ (Real-time)  │
└──────────────┘      └──────────────────┘      └────────────────┘      └──────────────┘
```

### Bước 1: IDLE
- Hiển thị giao diện chính với nút **"Start Calibration"** và **"Settings"**.
- Nếu có session trước, hiển thị link tải video recording và gallery ảnh khuôn mặt đã chụp.

### Bước 2: HEAD POSITIONING
- Hệ thống mở webcam (fullscreen) và hiển thị **Head Position Guide** — một khung hình chữ nhật lớn với crosshair ở giữa.
- MediaPipe phát hiện 478 landmark khuôn mặt 3D và chạy **Head Validation Logic**:
  - **Centering**: Mũi phải nằm trong vùng ±6% (ngang) / ±8% (dọc) so với tâm khung hình.
  - **Distance**: Khoảng cách khuôn mặt chiếm 15%–60% chiều ngang khung hình (~50–70cm).
  - **Tilt**: Góc nghiêng đầu < 12°.
- Khi **hợp lệ liên tục 2 giây** → chuyển sang Calibration.

### Bước 3: CALIBRATION
Chia làm 2 phase:

#### Phase 1: Initial Mapping
- Hiển thị grid (mặc định **9 điểm** 3×3) trên nền đen.
- Hai phương pháp thu thập dữ liệu:
  - **Timer (Auto)**: Người dùng nhìn vào điểm đỏ, hệ thống tự đợi rồi thu thập.
  - **Click & Hold** *(khuyến nghị)*: Người dùng nhấn giữ chuột vào điểm đỏ. Hệ thống ghi nhận các frame trong khi nhấn giữ, nhưng **loại bỏ 20% đầu và 20% cuối** (temporal trimming) vì:
    - 20% đầu: jitter do hành động click.
    - 20% cuối: mắt đã bắt đầu di chuyển do anticipation.
    - Chỉ giữ **60% giữa** — dữ liệu sạch nhất.
- Dữ liệu được clean bằng **outlier removal** (Trim Tails hoặc Standard Deviation) trước khi train.
- Feature vector cho mỗi sample gồm **18 chiều**: bias, normalized gaze (L/R x/y), polar coordinates (radius/theta), head pose (pitch/yaw/roll), cross-terms (gaze × head pose), squared terms.

#### Phase 2: Validation
- 5 điểm xác thực (offsets khác grid ban đầu) để đo **Mean Error** (pixel).
- Kết quả < 300px → "Good Accuracy", ngược lại → "Low Accuracy".

### Bước 4: TRACKING (Real-time)
- Hiển thị **Gaze Cursor** (vị trí mắt nhìn) trên màn hình.
- Hỗ trợ **Heatmap Layer** — bản đồ nhiệt real-time từ dữ liệu gaze.
- Ghi nhận toàn bộ trajectory gaze để **export CSV** (timestamp, x, y).
- Nếu bật recording: quay video webcam + chụp ảnh khuôn mặt định kỳ.
- **Head validation chạy liên tục** — nếu người dùng di chuyển đầu ra ngoài vùng hợp lệ, gaze cursor tạm ẩn và hiện cảnh báo.

---

## 4. Kiến Trúc Thuật Toán (Algorithm Architecture)

### 4.1 Vision Pipeline — Feature Extraction

```
Webcam Frame
    │
    ▼
MediaPipe Face Landmarker (478 3D landmarks, GPU)
    │
    ├── Pupil Centroids (landmarks #468, #473)
    ├── Eye Corner Normalization (normalized 0.0–1.0)
    ├── Head Pose Estimation (Pitch, Yaw, Roll)
    │   └── Geometric calculation from nose, chin, ears
    ├── Blink Detection (eye aspect ratio < 0.18)
    │
    ▼
18-dim Feature Vector:
  [bias, lx, ly, rx, ry, lR, lθ, rR, rθ, pitch, yaw, roll,
   lx×yaw, rx×yaw, ly×pitch, ry×pitch, lx², ly²]
```

### 4.2 Regression (Feature → Screen Coordinate)

Hệ thống hỗ trợ **3 phương pháp hồi quy**, người dùng chọn trong Settings:

| Method | Mô tả | Ưu điểm | Nhược điểm |
| :--- | :--- | :--- | :--- |
| **Thin Plate Splines (TPS)** *(mặc định)* | Mô phỏng tấm kim loại mỏng uốn cong qua các điểm. Radial Basis Function $r^2 \ln r$, có regularization $\lambda$. | Mô hình hóa **biến dạng phi tuyến cục bộ** tốt nhất, đặc biệt ở rìa màn hình. | Tính toán nặng hơn Ridge. |
| **Hybrid (Ridge + k-NN)** | Ridge Regression cho hướng tổng quát + k-NN (k=4) hiệu chỉnh cục bộ từ residuals. | Cân bằng giữa stability và local accuracy. | Cần nhiều calibration points cho k-NN hiệu quả. |
| **Ridge Regression** | Hồi quy tuyến tính thuần với L2 regularization. | Nhanh, ổn định. | Kém chính xác ở góc màn hình (bài toán phi tuyến). |

### 4.3 Signal Processing — Gaze Smoother

Dữ liệu thô rất nhiễu nên cần pipeline lọc tín hiệu đa tầng:

| Filter | Cách hoạt động | Khi nào dùng |
| :--- | :--- | :--- |
| **1€ Filter** *(mặc định)* | Adaptive low-pass: lọc mạnh khi mắt đứng yên (minCutoff), giảm lọc khi mắt di chuyển nhanh (beta). | Universal — tốt nhất cho hầu hết trường hợp. |
| **Kalman Filter** | Bộ lọc dự đoán đệ quy: ước lượng state qua Process Noise (Q) và Measurement Noise (R). | Khi cần dự đoán quỹ đạo (trajectory prediction). |
| **Moving Average** | Trung bình N frame gần nhất. | Đơn giản nhất, cho demo nhanh. |

**Saccade Detection**: Nếu khoảng cách giữa 2 frame liên tiếp > `saccadeThreshold` (mặc định 50px), filter được bypass/reset → cho phép **phản hồi tức thì** khi mắt nhìn sang vị trí mới.

### 4.4 Data Hygiene — Outlier Removal

Trước khi train model, dữ liệu thô được clean:
- **Trim Tails** *(mặc định, 25%)*: Cắt bỏ 25% trên và 25% dưới của từng feature.
- **Standard Deviation**: Loại bỏ samples cách mean > N sigma.

---

## 5. Component Architecture

```
App.tsx (Main Controller — 944 lines)
│
├── services/
│   ├── eyeTrackingService.ts    ← MediaPipe wrapper, feature extraction, head validation
│   └── mathUtils.ts             ← Matrix ops, TPS, Ridge, Hybrid, Kalman, 1€, DataCleaner
│
├── components/
│   ├── HeadPositionGuide.tsx     ← Head positioning UI overlay (crosshair, scan lines)
│   ├── CalibrationLayer.tsx      ← Calibration grid dots, click & hold progress
│   ├── GazeCursor.tsx            ← Real-time gaze position cursor
│   ├── HeatmapLayer.tsx          ← Canvas-based heatmap (alpha accumulation + colorization)
│   ├── DiagnosticsPanel.tsx      ← Debug panel (camera toggle, feature display, blink status)
│   └── SettingsModal.tsx         ← Full configuration UI (regression, smoothing, calibration, recording)
│
├── types.ts                      ← TypeScript types, enums, AppConfig, DEFAULT_CONFIG
├── index.tsx                     ← React entry point
└── index.html                    ← Single HTML entry point
```

---

## 6. Tính Năng Nổi Bật

### 🎥 Video Recording & Face Capture
- **Quay video**: Ghi lại toàn bộ webcam stream (WebM/VP9) trong suốt tracking session.
- **Chụp ảnh khuôn mặt**: Tự động crop khuôn mặt từ landmarks mỗi N giây, hiển thị thumbnail sidebar và cho phép tải về.

### 🔥 Heatmap Visualization
- Canvas-based heatmap dùng **alpha accumulation** trên shadow canvas (downscaled 4×) → colorize bằng gradient palette (Blue → Cyan → Green → Yellow → Red).
- Real-time render qua `requestAnimationFrame`.

### ⚙️ Fully Configurable
Toàn bộ hệ thống có thể tuỳ chỉnh qua Settings Modal:
- Phương pháp regression (TPS / Hybrid / Ridge)
- Filter type (1€ / Kalman / Moving Average / None)
- Các tham số filter (minCutoff, beta, saccadeThreshold, kalmanQ, kalmanR, v.v.)
- Số điểm calibration (5, 9, 16, 20...)
- Phương pháp calibration (Timer / Click & Hold)
- Outlier removal method & threshold
- Face distance target
- Toggle video recording & face capture interval
- Config được lưu vào **localStorage** và tự load khi khởi động lại.

### 📊 Data Export
- Export toàn bộ gaze trajectory ra file **CSV** (Timestamp, ScreenX, ScreenY) để phân tích offline.

---

## 7. Điểm Thiết Kế Kỹ Thuật Đáng Chú Ý

1. **Tách biệt high-frequency loop và React render**: Dữ liệu tracking dùng `useRef` (không trigger re-render), chỉ `useState` cho UI elements → tránh bottleneck 60fps.

2. **Custom Matrix class**: Tự implement transpose, multiply, Gaussian elimination inverse, least squares — tránh dependency nặng, tối ưu cho typed arrays.

3. **Temporal Trimming (Click & Hold)**: Ý tưởng sáng tạo — loại bỏ 20% đầu/cuối của buffer lấy dữ liệu khi click, chỉ giữ 60% "steady state" giữa.

4. **Continuous Head Validation**: Head validation **không chỉ chạy ở bước setup** — nó chạy liên tục trong cả calibration và tracking. Nếu người dùng di chuyển đầu, hệ thống tạm pause xử lý gaze để tránh dữ liệu sai.

5. **GPU Delegation**: MediaPipe sử dụng WebGL/GPU delegates cho landmark detection → hiệu năng real-time ngay cả trên laptop.

6. **Privacy-first**: Zero data transmission. Mọi thứ xử lý locally trong browser.

---

## 8. Tóm Tắt

**Precision Eye Tracker** là một hệ thống eye-tracking web-based hoàn chỉnh, production-grade, kết hợp:
- **MediaPipe** cho computer vision real-time (478 face landmarks)
- **Thin Plate Splines / Hybrid / Ridge Regression** cho gaze mapping phi tuyến
- **1€ / Kalman / Moving Average Filters** cho smoothing thông minh
- **Saccade Detection** cho responsiveness
- **Temporal Trimming + Outlier Removal** cho data quality
- **Heatmap, Recording, Face Capture, CSV Export** cho analysis

Tất cả chạy **100% trong browser**, không cần server, không cần phần cứng đặc biệt — chỉ cần một webcam.
