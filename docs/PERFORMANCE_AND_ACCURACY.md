# Tối ưu Performance & Độ chính xác — Eye Tracker

Tài liệu phân tích **hiệu năng**, **độ chính xác**, **yếu tố ngoại cảnh** (ánh sáng, rung) và **cách chọn tham số** tối ưu cho ứng dụng eye tracking.

---

## 1. Phân tích Performance (hiệu năng)

### 1.1 Luồng xử lý hiện tại

- **processVideo** chạy trên `requestAnimationFrame` (≈ 60 FPS nếu màn hình 60 Hz).
- **MediaPipe detect** chỉ gọi khi `video.currentTime` thay đổi → thực tế bị giới hạn bởi **frame rate của camera** (thường 30 fps).
- Toàn bộ chạy trên **main thread**: detect → extract features → smooth → update UI. Nếu detect chậm sẽ kéo lag cả UI.

### 1.2 Điểm nghẽn có thể

| Thành phần | Độ phức tạp / Ghi chú | Khuyến nghị |
|------------|------------------------|-------------|
| **MediaPipe Face Landmarker** | Nặng nhất (GPU), ~10–30 ms/frame tùy máy | Giữ GPU; có thể thêm tùy chọn **frame skip** (xử lý mỗi 2 frame) cho máy yếu. |
| **TPS predict** | O(N) với N = số control points (~9–200) | Chấp nhận được; TPS chỉ dùng 4 feature dimensions. |
| **TPS train** | O(N²) khi build matrix, N = số sample | Với N ≈ 200 vẫn ổn; nếu N > 500 có thể cân nhắc giảm sample (downsample exercises). |
| **OneEuro / MA / Kalman** | Rất nhẹ | Không cần tối ưu thêm. |
| **Camera** | Mặc định browser (thường 720p/1080p, 30fps) | Có thể thêm **constraints** (max width/height, ideal max 1280) để giảm tải trên máy yếu. |

### 1.3 Đề xuất tối ưu performance

1. **Frame skip (tùy chọn)**  
   - Biến config `processEveryNthFrame: 1 | 2`.  
   - Nếu = 2: chỉ gọi `detect` khi `frameCount % 2 === 0` → giảm ~50% tải, giảm một nửa effective FPS gaze (vẫn đủ cho nhiều use case).

2. **Camera constraints**  
   - Khi gọi `getUserMedia`, thêm ví dụ:
     - `video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }`  
   - Tránh resolution quá cao (4K) gây tốn tài nguyên mà không cần thiết cho landmark.

3. **Web Worker (nâng cao)**  
   - Chuyển `FaceLandmarker.detectForVideo` sang Worker, gửi ImageBitmap hoặc frame data. Giảm block main thread, UI mượt hơn; implementation phức tạp hơn (shared memory / OffscreenCanvas nếu dùng).

---

## 2. Phân tích Độ chính xác

### 2.1 Pipeline ảnh hưởng đến accuracy

- **Feature extraction**: pupil relative to eye corners (chuẩn hóa theo kích thước mắt) + head pose + cross-terms → đã phù hợp.
- **Calibration**: Grid + exercises phủ đủ vùng; wiggling đã chỉnh full range.
- **Regression**: TPS phi tuyến tốt cho góc/rìa; Ridge đơn giản hơn, kém ở rìa.
- **Smoothing**: Giảm jitter nhưng thêm latency; saccade detection tránh lag khi nhảy mắt.
- **Data hygiene**: Trim tails / STD_DEV loại frame nhiễu khi calibrate.

### 2.2 Chọn tham số theo mục tiêu

| Mục tiêu | Regression | Smoothing | MinCutoff | Beta | Saccade (px) | Outlier | Calibration points |
|----------|------------|-----------|-----------|------|---------------|---------|---------------------|
| **Độ chính xác cao** (precision) | TPS | OneEuro | 0.003–0.005 | 0.005–0.01 | 40–60 | Trim 25% hoặc STD 2 | 16–20, bật exercises |
| **Ổn định khi nhìn cố định** (stable cursor) | TPS | OneEuro | 0.002–0.004 | 0.01–0.02 | 50 | Trim 25% | 9+ |
| **Phản hồi nhanh** (low latency) | TPS hoặc Hybrid | OneEuro | 0.01–0.02 | 0.02–0.05 | 60–80 | Trim 20% | 9 |
| **Môi trường nhiều nhiễu** (noisy) | TPS | OneEuro | 0.004–0.008 | 0.02 | 40–50 | STD_DEV 2, threshold 2 | 16+, Click & Hold |

- **MinCutoff** càng thấp → smoothing mạnh hơn → cursor ổn nhưng lag hơn.  
- **Beta** càng cao → phản hồi nhanh hơn khi mắt di chuyển.  
- **Saccade threshold** quá thấp → dễ coi movement nhỏ là saccade và reset filter; quá cao → lag khi nhảy mắt thật.

---

## 3. Yếu tố ngoại cảnh

### 3.1 Ánh sáng (Lighting)

**Ảnh hưởng:**

- Thiếu sáng → webcam noise tăng → landmark (đặc biệt iris/pupil) dao động, gaze jumpy.
- Ánh sáng lệch một bên → shadow trên mắt → bias hoặc outlier.
- Backlight (màn hình sáng phía sau) → mặt tối, camera tăng gain → noise.

**Đề xuất:**

1. **Gợi ý người dùng (trong UI / README)**  
   - Đèn phía trước hoặc ánh sáng đều từ trước mặt.  
   - Tránh để nguồn sáng mạnh phía sau đầu.  
   - Phòng không quá tối.

2. **Kiểm tra độ sáng (brightness check)**  
   - Lấy frame từ video (canvas + `getImageData`), tính trung bình hoặc luminance.  
   - Nếu trung bình < ngưỡng (ví dụ 40–60): hiển thị cảnh báo “Lighting may be too low for best accuracy” và gợi ý bật đèn / chỉnh vị trí.  
   - Không cần chặn hoạt động, chỉ cảnh báo.

3. **Trong calibration**  
   - Đã có Data Hygiene (trim/outlier) → một phần frame quá tối/nhiễu sẽ bị loại.  
   - Có thể tăng nhẹ **outlier threshold** (trim 30% hoặc STD_DEV 2) khi phát hiện môi trường tối (nếu đã implement brightness check).

### 3.2 Rung / dao động (Vibration, Shake)

**Ảnh hưởng:**

- Webcam hoặc đầu người dùng rung → landmark dịch chuyển từng frame → gaze output nhảy.
- Smoothing (OneEuro/Kalman/MA) đã giảm nhiều; saccade detection tránh “kéo đuôi” khi thực sự nhảy mắt.

**Đề xuất:**

1. **Giữ / tinh chỉnh smoothing**  
   - Môi trường rung: **MinCutoff thấp hơn** (0.003–0.005), **Beta vừa** (0.01–0.02) để ổn định hơn.  
   - Có thể thêm preset “Stable (for shaky setup)” trong Settings.

2. **Temporal consistency (tùy chọn, nâng cao)**  
   - Nếu khoảng cách gaze (x,y) so với frame trước > ngưỡng **và** không coi là saccade (ví dụ không có chuyển động mắt nhanh điển hình) → có thể đánh dấu frame “suspicious” hoặc blend với prediction trước để giảm spike do rung.  
   - Cần thử nghiệm để tránh làm chậm phản hồi thật.

3. **Khuyến nghị phần cứng**  
   - Ghi trong tài liệu: đặt laptop/webcam ổn định, tránh bàn rung; dùng giá đỡ nếu cần.

---

## 4. Bảng tham số gợi ý nhanh

| Parameter | Mặc định | High precision | Low latency | Noisy / shaky |
|-----------|----------|-----------------|-------------|----------------|
| **Regression** | TPS | TPS | TPS | TPS |
| **Smoothing** | OneEuro | OneEuro | OneEuro | OneEuro |
| **minCutoff** | 0.005 | 0.003 | 0.01–0.02 | 0.004 |
| **beta** | 0.01 | 0.01 | 0.03–0.05 | 0.015 |
| **saccadeThreshold** | 50 | 45–55 | 60–80 | 40–50 |
| **outlierMethod** | TRIM_TAILS | TRIM_TAILS | TRIM_TAILS | STD_DEV |
| **outlierThreshold** | 0.25 | 0.25 | 0.2 | 2 (sigma) |
| **calibrationPointsCount** | 9 | 16–20 | 9 | 16 |
| **calibrationMethod** | TIMER | Click & Hold | TIMER / Click | Click & Hold |
| **enableExercises** | true | true | true | true |

---

## 5. Tóm tắt hành động đề xuất

### Có thể làm ngay (không đổi logic nặng)

- Thêm **preset** trong Settings: “High precision”, “Low latency”, “Stable (shaky)” với bộ tham số trên.  
- Ghi rõ **khuyến nghị môi trường** (ánh sáng, ổn định) trong UI hoặc README.  
- **Camera constraints**: đã thêm `width: { ideal: 1280 }, height: { ideal: 720 }` trong `getUserMedia` (App.tsx) để giảm tải trên máy yếu.  
- **Brightness check**: đã thêm kiểm tra độ sáng trung bình mỗi ~2s; nếu quá tối (luminance < 50) thì hiển thị cảnh báo “Lighting may be too low…” trong CALIBRATION/TRACKING.

### Cải thiện vừa (implementation rõ ràng)

- **Brightness check**: đã implement — lấy frame mẫu mỗi 2s, tính luminance trung bình vùng giữa; nếu < 50 → cảnh báo trong UI.  
- **Frame skip**: config `processEveryNthFrame: 2` cho máy yếu, chỉ gọi detect mỗi 2 frame (chưa implement).

### Nâng cao (tùy roadmap)

- Web Worker cho MediaPipe detect.  
- Temporal consistency filter khi phát hiện rung (suspicious jump).  
- Validation mid-edge (đã nêu trong CALIBRATION_REVIEW.md) để đánh giá lỗi theo vùng và điều chỉnh tham số/phủ calibration.

---

Tài liệu này bổ sung cho **CALIBRATION_REVIEW.md** (tập trung vào calibration và phân bố điểm). Kết hợp cả hai giúp tối ưu cả **độ chính xác** và **hiệu năng** trong các điều kiện ánh sáng và rung khác nhau.
