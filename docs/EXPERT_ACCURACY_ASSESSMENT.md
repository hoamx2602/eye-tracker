# Đánh giá chuyên gia CV — Độ chính xác & Thiết kế hệ thống (Offline, Max-Accuracy)

> **Bối cảnh & ràng buộc:** Hệ KHÔNG cần real-time. Mục tiêu là **độ chính xác cao nhất**,
> dùng webcam thường (không phần cứng chuyên dụng). Dữ liệu bệnh nhân (concussion/không)
> sẽ được dùng để train classifier sau. Tài liệu này phản biện cả thiết kế hiện tại
> *lẫn* đề xuất backend L2CS trong `backend/` — không mặc định thiết kế nào đúng.
>
> Bổ sung cho `PERFORMANCE_AND_ACCURACY.md`, `CALIBRATION_REVIEW.md`,
> `tickets/eye_tracking_optimization_analysis.md` và báo cáo dissertation.

---

## TL;DR — chẩn đoán gốc rễ

Độ chính xác bị chặn bởi **3 tầng lỗi cộng dồn**; cả hệ hiện tại lẫn backend đề xuất
ban đầu **chưa giải quyết tầng dưới cùng**:

1. **Sàn vật lý:** iris ở 720p chỉ ~15–25px → sai 1px landmark ≈ 20–40px màn hình.
   Phương pháp landmark đơn-điểm (MediaPipe iris) **không thể** vượt sàn này.
2. **Tầng hình học:** ánh xạ feature→(x,y) bằng hồi quy 2D giả định **đầu đứng yên**.
   Mọi dịch chuyển đầu phá mapping → lỗi parallax + extrapolation (xác nhận trong literature).
3. **Tầng đo lường:** sai số tracking **trộn lẫn** tín hiệu lâm sàng → người khỏe có thể bị 0/100.

**Thứ tự sửa đúng:** chất lượng dữ liệu → lõi CNN + 3D → đo lường.
Tối ưu thuật toán trên video VP9 nén là tối ưu sai chỗ.

---

## 1. Điểm mù chưa được đánh giá

### 1.1 Recording VP9 nén — sát thủ thầm lặng của hướng offline
`App.tsx:719` dùng `video/webm;codecs=vp9` ở bitrate mặc định. Backend offline chỉ tốt
bằng chất lượng pixel nó nhận; VP9 mặc định **xóa texture mống mắt** — đúng cái CNN/landmark cần.
→ Đang tối ưu thuật toán trên dữ liệu đã hỏng. **Sửa:** lưu frame chất lượng cao
(PNG sequence vùng mặt, hoặc webm bitrate ~20–50 Mbps). Rẻ, tác động lớn nhất cho offline.

### 1.2 LOOCV ≠ độ chính xác thật
LOOCV đo trên chính điểm calibration → lạc quan. Hệ **có** validation points riêng
(`VALIDATION_POINTS`, `validationErrorsRef`, chart "Per-point validation error") — điểm mạnh.
Nhưng cần báo cáo lỗi theo **vùng màn hình** (tâm vs rìa), theo **góc gaze lớn**, và
**sau khi đầu dịch chuyển**. Một con số trung bình che giấu lỗi rìa.

### 1.3 Scoring p10/p90 dùng seed cứng, không phải normative lâm sàng
`resultScoring.ts:45-56`: `saccadic 150/600ms`, `anti_saccade 5–60°`... là số phỏng đoán.
Dissertation đã có normative thật (pro-saccade 220±43ms, anti-saccade 343±76ms, BCEA 2.4±2.0°²)
nhưng code chưa dùng. Quan trọng hơn: score **không tách lỗi đo khỏi tín hiệu**.

### 1.4 Calibration capture dùng TIMER, không gaze-contingent
`App.tsx:1298`: chờ 800ms rồi thu 1200ms, **không kiểm tra mắt đã nhìn vào dot chưa**.
Điểm góc (saccade lớn) có thể chưa ổn định trong 800ms → calibrate bằng dữ liệu rác ở
đúng vùng khó nhất (rìa). **Sửa:** chỉ thu khi gaze hội tụ gần dot, hoặc loại window variance cao.

### 1.5 Không có mô hình 3D đầu thật
`zDistance = IPD/faceWidth` là proxy scale thô, không phải depth mét. Không PnP,
không vị trí 3D mắt → không bù được head translation, không ray-screen intersection.

---

## 2. Vấn đề KÍNH — chẩn đoán đúng + giải pháp đa tầng

Xử lý hiện tại (`mathUtils.ts:596+`, `glassesMode`) chỉ là **bộ lọc làm mượt**:
EAR proxy glare → giữ frame cũ / hạ trọng số Kalman. Hai sai lầm cốt lõi:

- **EAR đo độ mở mắt, KHÔNG đo glare.** Glare xảy ra cả khi mắt mở to.
- **Kính cận gây lỗi *hệ thống*, không phải nhiễu.** Thấu kính khúc xạ dịch vị trí biểu kiến
  đồng tử theo góc nhìn. Lọc/giữ frame **không xóa bias hệ thống** — chỉ giấu spike.

**Giải pháp (không cần phần cứng):**
1. **Appearance-based CNN** là cách chống kính tốt nhất — học biểu diễn bất biến với
   occlusion/glare (kiến trúc attention-branch), nếu train có ảnh đeo kính.
2. **Per-subject calibration nhiều điểm (16–25) khi đeo kính** → mapping cá nhân hấp thụ distortion.
   Offline cho phép fine-tune CNN thật, không chỉ regression bên trên.
3. **Phát hiện glare đúng:** dò **specular highlight** (đốm sáng bão hòa trong vùng mắt),
   không phải EAR. Frame có glint mới nên loại.
4. **Offline reflection removal/inpainting** vùng mắt trước infer (khả thi vì không real-time).
5. **Trung vị qua nhiều frame/điểm** giảm phần noise.
6. **Hướng dẫn setup** (độ sáng màn hình + góc ngồi) giảm glare trước khi đo.

---

## 3. Tự phản biện — backend L2CS (`backend/`) có 2 lỗ hổng

**Lỗ hổng 1:** `calibration.py` map (yaw,pitch)→(x,y) bằng polynomial 2D → **vẫn dính bệnh
head-movement** của hệ cũ. Đúng cho chính xác tối đa: **PnP vị trí 3D mắt → CNN hướng gaze 3D
→ giao tia với mặt phẳng màn hình**, chỉ calibrate kappa cá nhân + pose màn hình.

**Lỗ hổng 2:** L2CS cross-subject ~3.92° trên MPIIGaze — **tệ hơn mục tiêu 1.5°**.
Số đẹp chỉ đến **sau personalization**. → Trọng tâm là **chiến lược cá nhân hóa**,
không phải "chạy L2CS là xong". Model ít quan trọng hơn personalization.

---

## 4. "Offline" — vũ khí lớn nhất chưa khai thác

1. **Per-subject fine-tuning CNN** (5–9 ảnh + gaze-redirection augmentation chống overfit) —
   đòn bẩy chính xác lớn nhất (research 2024).
2. **Bidirectional smoothing (RTS / forward-backward Kalman)** — hơn OneEuro nhân quả.
3. **Frame-quality selection + super-resolution** vùng mắt trước infer.
4. **Ensemble nhiều model** (L2CS + ETH-XGaze + geometric) fuse theo độ tin cậy.
5. **Test-time augmentation** (lật, multi-crop) lấy trung bình.
6. **Bundle adjustment head-pose** qua cả chuỗi.

---

## 5. Lộ trình ưu tiên (lợi ích / công sức)

| # | Hành động | Vì sao | Mức |
|---|---|---|---|
| 1 | **Lưu frame chất lượng cao** thay VP9 nén (ít nhất vùng mặt) | Tiền đề mọi thứ offline | 🔴 Rẻ, tác động lớn nhất |
| 2 | **Calibration gaze-contingent + 16–25 điểm khi đeo kính** | Sửa garbage-in ở rìa + hấp thụ bias kính | 🔴 Trung bình |
| 3 | **Lõi CNN + per-subject fine-tuning** (ETH-XGaze/L2CS pretrain) | Vượt sàn iris-landmark; chống kính | 🟠 Lớn |
| 4 | **3D: PnP head pose + ray-screen intersection** thay polynomial 2D | Bù head movement (sửa lỗ hổng backend) | 🟠 Lớn |
| 5 | **Tách lỗi đo khỏi score**: normative thật + truyền confidence | Score lâm sàng đáng tin | 🟡 Trung bình |
| 6 | **Validation theo vùng + góc + sau dịch đầu** | Biết lỗi thật, không phải 1 con số | 🟡 Rẻ |

---

## Tham chiếu (2024–2025)

- Democratizing eye-tracking — appearance-based gaze với attention branch (ScienceDirect 2025)
- Recent Progress on Eye-Tracking & Gaze Estimation for AR/VR (MDPI 2025)
- Dual Focus-3D: Hybrid Deep Learning for Robust 3D Gaze (PMC 2024)
- Webcam-based gaze estimation for screen interaction (Frontiers/PMC 2024)
- ETH-XGaze: large-scale dataset, extreme head pose (arXiv 2007.15837)
- Test-Time Personalization with Meta Prompt for Gaze Estimation (2024)
- Real-Time Webcam CNN Gaze incl. glasses glare notes (MDPI 2025)
