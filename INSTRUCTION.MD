
# Precision Web-Based Eye Tracking System
## Technical Architecture & Algorithm Documentation

This document details the technologies, mathematical models, signal processing pipelines, and configuration options implemented to achieve high-precision, webcam-based eye tracking directly in the browser.

---

## 1. Core Technologies

### Frontend & Build
*   **Framework**: **Next.js 16** (App Router) với **React 19** và **TypeScript**.
*   **Styling**: **Tailwind CSS** cho toàn bộ UI/UX.
*   **State**: React Hooks (`useRef` cho dữ liệu vòng lặp tần số cao, `useState` cho UI).

### Computer Vision
*   **Google MediaPipe Face Landmarker** (Vision Tasks).
    *   *Model*: `face_landmarker.task` (Float16 GPU Delegate).
    *   *Tính năng*: Phát hiện 478 landmark 3D trên khuôn mặt theo thời gian thực trong trình duyệt.

### Backend & Data
*   **Database**: **PostgreSQL** (khuyến nghị Neon/Supabase cho Vercel) qua **Prisma ORM**.
*   **Storage**: **AWS S3** — lưu video calibration, ảnh face crop; hỗ trợ upload qua API (base64) hoặc **presigned URL** (tránh giới hạn 4.5 MB body của Vercel).
*   **Admin Auth**: **JWT** (thư viện `jose`), mật khẩu hash bằng **bcryptjs**; cookie `httpOnly` 24h.

### Analytics & Visualization
*   **Recharts**: Biểu đồ phân tích session (scatter, bar, radar, line) trong Admin — SessionAnalytics.
*   **React Three Fiber + Three.js**: Component **HeadPose3D** — mô hình 3D đầu người và trục Pitch/Yaw/Roll để trực quan hóa head pose (dùng trong Admin).

---

## 2. The Vision Pipeline

### A. Feature Extraction (`eyeTrackingService.ts`)
Thay vì dùng dữ liệu pixel thô, hệ thống trích xuất vector đặc trưng từ face mesh 3D:
1.  **Pupil Centroid**: Landmark 468 (trái) và 473 (phải).
2.  **Chuẩn hóa theo góc mắt**: Vị trí pupil tính tương đối so với góc trong/ngoài mắt → hệ tọa độ chuẩn (0.0–1.0) cho mỗi mắt, giúp ổn định khi đổi khoảng cách.
3.  **Head Pose**: Tính từ landmark mũi, cằm, tai:
    *   **Pitch**: Xoay lên/xuống.
    *   **Yaw**: Xoay trái/phải.
    *   **Roll**: Nghiêng.
4.  **Feature Vector**: Đầu vào cho mô hình là vector phẳng gồm:
    *   Gaze chuẩn hóa (Left X, Left Y, Right X, Right Y)
    *   Tọa độ cực (Radius, Theta) của iris
    *   Head Pose (Pitch, Yaw, Roll)
    *   Cross-terms (tương tác, ví dụ `GazeX * Yaw`) để bù méo do chuyển động đầu.

### B. Head Validation Logic
Trước khi bắt đầu calibration, logic kiểm tra liên tục:
*   **Centering**: Mũi nằm trong vùng dung sai ~12% so với tâm khung hình.
*   **Khoảng cách (trục Z)**: Dùng khoảng cách giữa hai má so với chiều rộng khung để giữ khoảng ~50–70 cm (cấu hình `faceDistance`, `faceWidthScale`).
*   **Tilt**: Đầu thẳng đứng (Roll &lt; 12°).

---

## 3. Calibration & Regression Algorithms

Ánh xạ đặc trưng mắt → tọa độ màn hình (X, Y) là bài toán phi tuyến (độ cong màn hình, méo thấu kính). Hệ thống hỗ trợ ba chiến lược hồi quy:

### A. Thin Plate Splines (TPS) — *Khuyến nghị*
*   **Lý thuyết**: Tương tự tấm kim loại mỏng uốn cong; tối thiểu hóa hàm năng lượng cân bằng "độ trơn" và "độ khớp".
*   **Lý do**: Khác với hồi quy tuyến tính, TPS mô hình được **méo phi tuyến cục bộ** ở rìa màn hình.
*   **Triển khai**: Radial Basis Functions ($r^2 \ln r$); giải hệ tuyến tính $(K + \lambda I)W = V$; có regularization ($\lambda$) chống overfitting.

### B. Hybrid Regression (Ridge + k-NN)
*   **Bước 1 (toàn cục)**: **Ridge Regression** (L2) để xác định hướng gaze tổng quát.
*   **Bước 2 (cục bộ)**: **k-Nearest Neighbors (k=4)** trên phần dư; cộng vector hiệu chỉnh theo trọng số từ các điểm calibration gần nhất.
*   **Lợi ích**: Cân bằng ổn định (Ridge) và độ chính xác cục bộ (kNN).

### C. Ridge Regression
*   Ánh xạ tuyến tính thuần; nhanh nhưng kém chính xác ở góc màn hình.

---

## 4. Signal Processing & Smoothing

Dữ liệu gaze thô từ webcam nhiễu. Pipeline lọc đa giai đoạn (`GazeSmoother` trong `mathUtils.ts`):

### A. Saccade Detection
*   **Vấn đề**: Làm mượt mạnh gây "lag" khi người dùng nhìn sang mục tiêu mới.
*   **Giải pháp**: Nếu khoảng cách giữa điểm hiện tại và điểm trước vượt `saccadeThreshold` (vd. 50px), bộ lọc tạm bỏ qua/reset → **phản hồi tức thì** với chuyển động lớn, vẫn giữ microsaccade mượt.

### B. 1€ Filter (One Euro Filter) — *Mặc định*
*   Bộ lọc low-pass thích nghi.
*   **Giảm jitter (`minCutoff`)**: Lọc mạnh khi mắt đứng yên.
*   **Giảm lag (`beta`)**: Giảm độ lọc khi tốc độ tăng.
*   **Kết quả**: Con trỏ ổn định khi nhìn chằm chằm, di chuyển nhanh khi liếc.

### C. Kalman Filter
*   Bộ lọc đệ quy dự đoán trạng thái; dùng ma trận Process Noise (Q) và Measurement Noise (R).
*   Phù hợp dự đoán quỹ đạo nhưng nặng tính toán hơn.

### D. Moving Average
*   Làm mượt đơn giản theo cửa sổ `maWindow` khung.

---

## 5. Data Acquisition Methods

### Calibration: Tổng quan các bước (số bước cụ thể)

Quy trình calibration gồm **3 giai đoạn** (2 bắt buộc, 1 tùy chọn), với số bước rõ ràng như sau:

| Giai đoạn | Số bước / Nội dung | Ghi chú |
| :--- | :--- | :--- |
| **1. Head Positioning** | **1 bước** | Giữ đầu trong khung ~2 giây; hệ thống kiểm tra centering, khoảng cách, tilt. |
| **2. Initial Mapping** | **N điểm** (cấu hình được) | Lưới điểm calibration. Mặc định **9 điểm** (lưới 3×3). Có thể đổi trong Settings → *Calibration Points Count* (vd. 5, 9, 16). Mỗi điểm: nhìn/chớp hoặc click & giữ tùy method. |
| **3. Eye Exercises** (tùy chọn) | **6 bài** | Chỉ chạy khi bật *Enable Exercises* trong Settings. Mỗi bài: countdown 2s rồi dot di chuyển theo pattern. Thứ tự: **wiggling** → **horizontal** (2 vòng) → **vertical** (2 vòng) → **forward_backward** → **diagonal** → **h_pattern**. |
| **4. Validation** | **5 điểm** cố định | Đo sai số (px) so với dự đoán. 5 vị trí: (25%,25%), (75%,75%), (25%,75%), (75%,25%), (50%,50%). Kết thúc → báo mean error (px) và chuyển sang Tracking. |

**Tóm tắt số bước (khi dùng mặc định, bật exercises):**
- Head Positioning: **1**
- Initial Mapping: **9** điểm
- Exercises: **6** bài (horizontal & vertical mỗi bài 2 vòng)
- Validation: **5** điểm  
→ **Tổng cộng**: 1 + 9 + 6 + 5 = **21 bước** (nếu tính mỗi điểm/bài là 1 bước). Nếu tắt exercises: 1 + 9 + 5 = **15 bước**.

---

### A. Method 1: Auto Timer
*   Người dùng nhìn vào điểm, hệ thống đợi rồi thu thập.
*   *Ưu*: Rảnh tay. *Nhược*: Có thể chớp mắt hoặc mất tập trung trong cửa sổ thu thập.

### B. Method 2: Click & Hold (Active Attention) — *Khuyến nghị*
*   Người dùng phải **Click và giữ** vào chấm calibration.
*   **Active Attention**: Hành động giữ chuột buộc mắt tập trung vào mục tiêu.
*   **Temporal Trimming**: Ghi frame khi giữ, nhưng **bỏ 20% đầu và 20% cuối** — phần giữa 60% là dữ liệu sạch nhất (tránh jitter lúc click và anticipation lúc thả).

### C. Calibration bổ sung: Eye Movement Exercises
*   Sau lưới điểm (Initial Mapping), có thể bật **enableExercises** trong Settings.
*   **Số bài**: **6 pattern** lần lượt: **wiggling**, **horizontal** (2 vòng trái↔phải), **vertical** (2 vòng trên↔dưới), **forward_backward**, **diagonal**, **h_pattern**.
*   Dữ liệu exercise được trim 10% đầu/cuối và down-sample về ~30 mẫu mỗi pattern trước khi đưa vào training.

### D. Data Hygiene (Outlier Removal)
*   **Trim Tails**: Bỏ X% giá trị trên/dưới theo từng feature.
*   **Std Dev**: Bỏ mẫu ngoài $n$ độ lệch chuẩn so với trung bình.

---

## 6. API & Backend Features

### API Routes (Next.js App Router)
| Route | Method | Mô tả |
| :--- | :--- | :--- |
| `/api/sessions` | GET | Danh sách session (query: `limit`, `cursor`, `testOnly`) |
| `/api/sessions` | POST | Tạo session (config, demographics, validationErrors, videoUrl, calibrationImageUrls, calibrationGazeSamples; testTrajectories → TestRun) |
| `/api/upload` | POST | Upload file (body: base64 + filename) lên S3 → trả về URL |
| `/api/upload/presign` | POST | Lấy presigned S3 PUT URL để client upload trực tiếp (tránh giới hạn 4.5 MB) |
| `/api/admin/login` | POST | Đăng nhập admin → JWT cookie |
| `/api/admin/logout` | POST | Xóa cookie |
| `/api/admin/register` | POST | Đăng ký admin (seed) |
| `/api/admin/me` | GET | Thông tin admin từ JWT |
| `/api/admin/signed-url` | POST | Presigned GET URL cho S3 (xem video/ảnh trong Admin) |

### Database (Prisma)
*   **Session**: config (JSON), demographics, validationErrors, meanErrorPx, status, videoUrl, calibrationImageUrls, calibrationGazeSamples; quan hệ 1–1 với TestRun.
*   **TestRun**: sessionId, trajectories (JSON) — mảng segment target vs gaze (test mode).
*   **Admin**: email, passwordHash, name.

---

## 7. Optimization Options (Settings)

Cấu hình qua Settings Modal và lưu vào `localStorage` (`eye_tracker_config`):

| Category | Option | Description | Recommended |
| :--- | :--- | :--- | :--- |
| **Mapping** | Regression Method | Thuật toán ánh xạ mắt → màn hình. | **TPS** |
| **Smoothing** | Filter Type | Giảm rung. | **1€ Filter** |
| | MinCutoff | Độ ổn định khi đứng yên. | **0.005 – 0.01** |
| | Beta | Hệ số tốc độ khi di chuyển. | **0.01 – 0.1** |
| | Saccade Thresh | Khoảng cách (px) để bỏ qua smoothing. | **50–100** |
| **Calibration** | Method | Cách thu thập: Timer hoặc Click & Hold. | **Click & Hold** |
| | Click Duration | Thời gian giữ click (giây). | **1.0 – 1.5** |
| | Calibration Points Count | Số điểm lưới. | **9** |
| | Enable Exercises | Bật bài tập chuyển động mắt. | **On** |
| **Data** | Outlier Method | Lọc frame nhiễu. | **Trim Tails (25%)** |
| **Head** | Face Distance | Khoảng cách mục tiêu (cm). | **60** |
| | Face Width Scale | Hệ số FOV camera (1 = webcam tích hợp; 0.65–0.8 cho webcam ngoài). | **1** |
| **Recording** | Video Recording | Ghi toàn bộ session + face crops. | **On** |
| | Face Capture Interval | Chụp vùng mặt định kỳ (giây); 0 = tắt. | **5** |

---

## 8. User Flows & Features

### Participant (Client)
*   **Consent** → **Demographics** (tuổi, giới tính, quốc gia, tình trạng mắt) → **Head Positioning** (1 bước, ~2s) → **Calibration**:
    *   **Initial Mapping**: N điểm lưới (mặc định 9); có thể bật **Exercises** (6 bài: wiggling, horizontal 2 vòng, vertical 2 vòng, forward_backward, diagonal, h_pattern);
    *   **Validation**: 5 điểm cố định, báo mean error (px).
*   Sau đó → **Tracking**. Tracking modes: **Free Gaze** (con trỏ + heatmap), **Dot Test** (RandomDotsOverlay), **Article Reading** (ArticleReadingOverlay).
*   **Stop & Save**: Tải CSV gaze, video, ảnh face capture (nếu có).
*   **Test mode**: Chạy calibration + exercises nhưng không lưu mẫu training; ghi target vs gaze theo thời gian → lưu vào TestRun để phân tích độ lệch trong Admin.

### Admin
*   Đăng nhập JWT; dashboard; danh sách sessions (phân trang, lọc test-only).
*   Chi tiết session: config, demographics, validation errors, video/ảnh calibration (presigned S3), **SessionAnalytics** (Recharts: scatter calibration, bar validation, radar features, line test trajectories).
*   Xem từng calibration sample (ảnh, features); với session có TestRun: biểu đồ trajectory target vs gaze theo từng pattern.
*   **HeadPose3D** (React Three Fiber): trực quan hóa Pitch/Yaw/Roll từ dữ liệu head pose.

---

## 9. Performance & Privacy

*   **GPU**: MediaPipe dùng WebGL/GPU delegate cho phát hiện landmark.
*   **Xử lý cục bộ**: Toàn bộ Vision, Regression, Smoothing chạy **100% trong trình duyệt**; không gửi video lên server.
*   **Lưu trữ**: Chỉ metadata và URL (S3) được gửi lên server khi lưu session; video/ảnh upload riêng (base64 qua API hoặc presigned PUT).
*   **Bộ nhớ**: Lớp matrix tùy biến dùng typed array, tránh overhead thư viện toán nặng (vd. math.js).
