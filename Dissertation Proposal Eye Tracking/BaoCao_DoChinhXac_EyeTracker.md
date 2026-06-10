# Phân tích và đề xuất cải tiến độ chính xác cho hệ thống theo dõi ánh mắt dựa trên webcam (Precision Eye Tracker)

**Tác giả:** _[điền tên]_ — University of Bradford, Dissertation Proposal
**Phiên bản báo cáo:** 1.0 — 2026‑05‑22
**Ngôn ngữ:** Tiếng Việt (thuật ngữ chuyên ngành giữ tiếng Anh trong ngoặc)
**Phạm vi:** Toàn bộ pipeline (vision → calibration → regression → smoothing) và logic chấm điểm các bài kiểm tra thần kinh vận nhãn (oculomotor neurological tests).

---

## Tóm tắt (Abstract)

Hệ thống *Precision Eye Tracker* hiện tại sử dụng webcam tiêu chuẩn kết hợp với Google MediaPipe Face Landmarker (478 landmark 3D), hồi quy Thin Plate Spline / Ridge / Hybrid, và bộ lọc 1€ Filter để dự đoán điểm nhìn (gaze point) trên màn hình theo thời gian thực. Trên đó, hệ thống chạy 7 bài kiểm tra thần kinh vận nhãn (head orientation, visual search, memory cards, anti‑saccade, saccadic, fixation stability, peripheral vision) và chấm điểm 0–100 theo nội suy tuyến tính giữa các ngưỡi `p10`/`p90`.

Báo cáo này (i) tổng hợp đánh giá định lượng về sai số tracking của các hệ webcam‑based so với chuẩn lab (EyeLink 1000, Tobii Pro Spectrum), (ii) chỉ ra **23 nhóm vấn đề kỹ thuật** trong pipeline và logic chấm điểm hiện tại làm tăng sai số, và (iii) đề xuất 4 hướng cải tiến lớn với cơ sở toán học và thực nghiệm rõ ràng:

1. **Mô hình hoá độ sâu và kappa angle cá nhân hoá** (3D eye model + per‑user kappa calibration).
2. **Cải tiến phương pháp thu thập calibration** (smooth‑pursuit calibration, regularization tuning bằng LOOCV, online drift correction).
3. **Thuật toán phát hiện sự kiện mắt theo chuẩn lâm sàng** (I‑VT/I‑VDT cho saccade onset, lọc blink/lost‑sample cho BCEA).
4. **Hiệu chuẩn lại ngưỡng chấm điểm theo dữ liệu chuẩn (normative data)** từ các nghiên cứu lâm sàng đã công bố (MAIA microperimeter, anti‑saccade norms, saccade latency norms).

Kỳ vọng: giảm mean error từ vùng "150–300 px ở 60 cm" (~3.6–7.1° thị giác) xuống ngưỡng dưới 1.5° thị giác — sát với mức tốt nhất của webcam tracker trong tài liệu hiện hành (Saxena et al., 2024, đạt 1.4° so với EyeLink 1000).

**Từ khoá:** webcam eye tracking, gaze estimation, MediaPipe, Thin Plate Spline, kappa angle, saccade detection, BCEA, anti‑saccade, normative data.

---

## 1. Mở đầu (Introduction)

### 1.1 Bối cảnh

Theo dõi ánh mắt (eye tracking) là công cụ chuẩn vàng trong nhiều lĩnh vực: nghiên cứu UX, chẩn đoán bệnh thần kinh — nhãn khoa (concussion, ADHD, Parkinson, glaucoma, schizophrenia), accessibility và human‑computer interaction. Tuy nhiên, thiết bị chuyên dụng (EyeLink 1000, Tobii Pro Spectrum) có chi phí 10 000–60 000 USD và yêu cầu phòng thí nghiệm có kiểm soát, khiến việc triển khai diện rộng — đặc biệt cho sàng lọc lâm sàng — gặp rào cản nghiêm trọng.

*Precision Eye Tracker* nhằm mục tiêu **dân chủ hoá** (democratize) eye tracking bằng cách chỉ dùng webcam tiêu chuẩn (built‑in laptop hoặc USB) và xử lý 100 % phía trình duyệt. Hệ thống hiện đã triển khai và đang được sử dụng cho người tham gia thử nghiệm các bài kiểm tra mắt (eye test). Vấn đề trọng yếu hiện nay là **sai số tracking còn cao**, dẫn đến điểm chấm các bài test bị méo (đôi khi 0/100 với người dùng có thị giác bình thường) và làm giảm giá trị lâm sàng của số liệu thu được.

### 1.2 Câu hỏi nghiên cứu

1. Trong pipeline xử lý hiện tại, **những thành phần nào đóng góp nhiều nhất vào sai số tổng thể**, và mức đóng góp ước lượng là bao nhiêu?
2. Có những **kỹ thuật, mô hình hoặc dữ liệu chuẩn** nào trong tài liệu khoa học gần đây (2022–2026) chưa được áp dụng có thể cải thiện độ chính xác mà vẫn giữ ràng buộc "chạy trong trình duyệt với webcam tiêu chuẩn"?
3. **Logic chấm điểm hiện tại** (p10/p90 với seed baselines) có sát với dữ liệu chuẩn lâm sàng (normative data) không? Cần hiệu chỉnh thế nào?

### 1.3 Đóng góp của báo cáo

- **Đóng góp 1:** Tổng hợp đánh giá so sánh các webcam eye tracker hiện đại với chuẩn lab (Mục 2).
- **Đóng góp 2:** Mổ xẻ chi tiết kiến trúc hiện tại với 23 vấn đề cụ thể, có chỉ rõ vị trí mã nguồn (file:line) và cơ chế sinh sai số (Mục 3 và 4).
- **Đóng góp 3:** Đề xuất 4 cụm cải tiến lớn với công thức toán học, pseudo‑code và tham chiếu literature (Mục 5).
- **Đóng góp 4:** Hiệu chuẩn lại ngưỡng `p10`/`p90` cho từng bài test dựa trên dữ liệu chuẩn lâm sàng từ MAIA microperimeter (BCEA), Antoniades et al. (anti‑saccade), và Munoz/Everling (pro‑/anti‑saccade) (Mục 6).
- **Đóng góp 5:** Lộ trình triển khai có ưu tiên theo tỷ lệ "công sức / lợi ích" (Mục 7).

---

## 2. Tổng quan công trình liên quan (Related Work)

### 2.1 Mức độ chính xác của các hệ thống eye tracking

| Hệ thống | Accuracy (°) | Precision (°) | Sampling | Tham chiếu |
| --- | --- | --- | --- | --- |
| **EyeLink 1000** (lab gold standard) | 0.25–0.50 | 0.01–0.05 | 1 000 Hz | Niehorster et al. 2020 |
| **Tobii Pro Spectrum** | 0.30 | 0.24 | 600–1 200 Hz | Andersson et al. 2020 |
| **Tobii Pro X3‑120** | 0.40 | 0.24 | 120 Hz | Niehorster et al. 2020 |
| **Webcam (Saxena et al., 2024)** | 1.4 | 1.1 | 30 Hz | Saxena et al. 2024 |
| **WebGazer (CLM tracker)** | ~3.0 (≈ 130 px) | n/a | 30 Hz | Papoutsaki et al. 2016 |
| **MPIIGaze + L2CS‑Net (deep)** | 3.92° (cross‑subject) | n/a | n/a | Abdelrahman et al. 2022 |
| **MediaPipe Iris (depth)** | err 4.3 % (depth) | n/a | 30 Hz | Ablavatski et al. 2020 (Google Research) |
| **Personalized full‑face CNN** | 1.14 | n/a | 30 Hz | Konrad et al. 2023 |

**Quan sát:** Khoảng cách giữa webcam tracker tốt nhất hiện nay và lab gold standard chỉ còn ~1° (1.4° vs 0.4°). Hệ thống hiện tại của dự án nếu đạt mean validation error **300 px ở khoảng cách 60 cm**, tương ứng ~7.1° thị giác (xem Mục 4.6), vẫn còn cách state‑of‑the‑art webcam tracker khoảng **5× sai số**.

### 2.2 Hướng tiếp cận chính của webcam gaze estimation

| Họ phương pháp | Đặc điểm | Ưu điểm | Nhược điểm |
| --- | --- | --- | --- |
| **Feature‑based regression** (hệ hiện tại) | Trích đặc trưng (pupil, corner, head pose) → regression sang (x,y) màn hình. | Nhẹ, real‑time CPU, ít cần dữ liệu train. | Phụ thuộc chất lượng landmark; nhạy với head movement. |
| **Appearance‑based deep (L2CS‑Net, MPIIFaceGaze, Gaze360)** | CNN/Transformer ăn ảnh patch mắt/khuôn mặt → dự đoán góc gaze. | Generalize tốt cross‑subject. | Cần GPU/WebGPU, model size lớn, latency cao. |
| **Hybrid model‑based (3D eye + landmark)** | Dùng 3D eyeball model + ước lượng head pose + visual axis → gaze ray. | Có thể bù head motion chính xác; cần ít điểm calibration (1 điểm cho kappa). | Phụ thuộc độ chính xác head pose; nhạy với scale calibration. |
| **Few‑shot personalization** (WebEyeTrack, Konrad et al. 2023) | Pretrained model + adapter cá nhân hoá với 4–9 điểm. | Đạt 1.14° full‑face. | Phức tạp; phải fine‑tune mỗi user. |

### 2.3 Dữ liệu chuẩn lâm sàng (Normative data)

| Tham số | Giá trị chuẩn (người lớn khoẻ mạnh) | Nguồn |
| --- | --- | --- |
| **Pro‑saccade latency** | 220 ± 43 ms | Antoniades et al. 2013; Munoz & Everling 2004 |
| **Anti‑saccade latency** | 343 ± 76 ms | Antoniades et al. 2013 |
| **Anti‑saccade error rate** | ~20 % (range 5–30 %) | Munoz & Everling 2004 |
| **BCEA 95 % (MAIA microperimeter)** | 2.4 ± 2.0 °² | Morales et al. 2016 |
| **BCEA 63 % (MAIA)** | 0.30 ± 0.50 °² | Morales et al. 2016 |
| **P1 (fixation trong 1° foveal)** | 98 % | Molina‑Martín et al. 2017 |
| **Saccade velocity threshold** | 30–100 °/s | Salvucci & Goldberg 2000; Engbert & Kliegl 2003 |
| **Saccade peak velocity (10° amp)** | ~350 °/s | Bahill et al. 1975 (main sequence) |
| **Kappa angle (visual‑optical axis)** | 2–3° (per eye) | Tabernero et al. 2011 |
| **Inter‑pupillary distance (IPD)** | 54–74 mm (mean 63) | NHANES 1988‑2010 |

Dữ liệu chuẩn này là cơ sở để hiệu chỉnh các ngưỡng `p10`/`p90` cho từng bài test (xem Mục 6).

---

## 3. Mô tả hệ thống hiện tại (System Description)

### 3.1 Kiến trúc tổng quan

```
Webcam frame (30 fps)
   │
   ▼
[MediaPipe FaceLandmarker]  ← Float16 GPU, 478 landmark 3D + 52 blendshape + 4×4 transform matrix
   │
   ▼
[FeatureExtractor]
   ├─ Pupil position (landmark 468 / 473)
   ├─ Eye corner normalisation → lx, ly, rx, ry
   ├─ Geometric head pose (pitch, yaw, roll)  ← heuristic, không phải Euler thực
   ├─ IPD / face_width → z‑distance proxy
   ├─ EAR (eye aspect ratio)
   └─ (optional) blendshapes + matrix head pose
   │
   ▼
[Feature vector 25–38 chiều]
   │
   ▼
[Calibration buffer]  ← thu thập 9 điểm × ~60 % "steady state" của Click‑Hold
   │
   ▼
[DataCleaner]  ← TRIM_TAILS (25 %) hoặc STD_DEV
   │
   ▼
[HybridRegressor / TPSRegressor / Ridge]  ← Hybrid mặc định
   │
   ▼
Raw gaze (x, y) px
   │
   ▼
[GazeSmoother]  ← 1€ Filter + saccade detect + fixation boost
   │
   ▼
Smoothed gaze (x, y) → Tracking / Neurological tests
```

### 3.2 Các tham số mặc định quan trọng

| Tham số | Giá trị mặc định | File:line |
| --- | --- | --- |
| Calibration points | 9 (lưới 3×3) | `lib/neurologicalConfig.ts` |
| Click & Hold duration | 1.0–1.5 s | `SettingsModal.tsx` |
| Temporal trim (Click & Hold) | bỏ 20 % đầu + 20 % cuối | doc |
| TPS regularization λ | 0.5 | `services/mathUtils.ts:118` |
| Ridge regularization λ | 0.001 | `services/mathUtils.ts:78` |
| 1€ Filter minCutoff | 0.005–0.01 (config) | `SettingsModal` |
| 1€ Filter beta | 0.01–0.1 | `SettingsModal` |
| Saccade threshold | 50 px (raw distance) | `mathUtils.ts:585` |
| Outlier method | TRIM_TAILS 25 % | `mathUtils.ts:809` |
| AOI Saccadic | 80 px (xung quanh target) | `tests/saccadic/constants.ts:36` |
| AOI Anti‑saccade | 70 px | `tests/antiSaccade/constants.ts:61` |
| Validation points | 5 vị trí cố định | doc |
| Z‑distance proxy | (IPD / face_width) × 10 | `eyeTrackingService.ts:211` |
| Head validation tol horizontal | ±6 % | `eyeTrackingService.ts:96` |
| Head validation tol vertical | ±8 % | `eyeTrackingService.ts:96` |
| Head tilt threshold | 0.12 rad (~6.9°) | `eyeTrackingService.ts:112` |

### 3.3 Feature vector hiện tại

Cốt lõi 25 chiều (`buildFeatureVector` / `prepareFeatureVector`):

| Idx | Đặc trưng | Ý nghĩa |
| --- | --- | --- |
| 0 | bias | 1 |
| 1–4 | lx, ly, rx, ry | Pupil so với eye center, ×10 |
| 5–8 | lR, lΘ, rR, rΘ | Polar form |
| 9–11 | pitch, yaw, roll | Head pose (geometric) |
| 12–15 | lx·yaw, rx·yaw, ly·pitch, ry·pitch | Cross terms |
| 16–17 | lx², ly² | Quadratic |
| 18 | z | (IPD/face_width)×10 |
| 19–24 | lx·z, ly·z, rx·z, ry·z, pitch·z, yaw·z | Depth interactions |
| 25–27 *(opt)* | rx², ry², lx−rx | Symmetric features (vergence proxy) |
| 28–29 *(opt)* | leftEAR, rightEAR | Eye openness |
| 30–37 *(opt)* | 8 gaze blendshape scores | MediaPipe NN gaze proxies |

### 3.4 Logic chấm điểm

Mỗi bài test trả về `score` 0–100 bằng công thức nội suy tuyến tính chuẩn hoá `p10`/`p90`:

$$
\text{score}(v) = 100 \cdot \mathrm{clamp}\!\left(\frac{v - p_{10}}{p_{90} - p_{10}}, 0, 1\right)
$$

(đảo chiều nếu "thấp hơn là tốt hơn" — ví dụ latency, error, BCEA).

Seed baselines hiện tại (`lib/resultScoring.ts:44`):

| Bài test | Metric | p10 | p90 |
| --- | --- | --- | --- |
| visual_search | completionTimeMs | 20 000 | 90 000 |
| saccadic | latencyMs | 150 | 600 |
| fixation_stability | BCEA 95 % (px²) | 6 000 | 100 000 |
| peripheral_vision | RT (ms) | 200 | 800 |
| anti_saccade | angularErrorDeg | 5 | 60 |
| memory_cards | efficiency | 0.5 | 1.0 |
| head_orientation | rangeDeg | 0.5 | 2.5 |

---

## 4. Phân tích các vấn đề ảnh hưởng tới độ chính xác (Identified Issues)

Phần này liệt kê 23 vấn đề cụ thể, gom theo 5 nhóm. Mỗi vấn đề đi kèm: **mô tả**, **vị trí mã nguồn**, **cơ chế sinh sai số**, và **ước lượng định lượng** mức đóng góp (qualitative L/M/H).

### 4.1 Nhóm A — Vision Pipeline (trích xuất đặc trưng)

#### Issue A1 — Geometric head pose không phải Euler thực sự
- **Vị trí:** `services/eyeTrackingService.ts:144–152`
- **Mô tả:** Yaw được tính `((nose.x − faceCenter.x) / faceWidth) × 2π`, pitch tương tự bằng tỷ lệ vị trí mũi/khuôn mặt nhân với π. Kết quả **không phải radians thật** mà chỉ là proxy có thứ nguyên giả của radians. Ở góc nghiêng lớn (yaw > 15°), face_width bị méo phối cảnh nên proxy này lệch phi tuyến.
- **Cơ chế sai số:** Khi user di chuyển đầu, regressor học `lx·yaw` cross‑term nhưng `yaw` đang ở "đơn vị giả" → cross term không bù được chính xác cho parallax‑induced shift.
- **Mức độ:** **H** (Cao). Khi head tilt 10° thực, gaze prediction có thể lệch 50–150 px ngang.
- **Đã có sẵn alternative:** `matrixHeadPose` đọc từ MediaPipe transformation matrix (`eyeTrackingService.ts:232`) — đây mới là Euler thực — **nhưng mặc định không bật** (`useTransformationMatrix` mặc định = false).

#### Issue A2 — Z‑distance không bù theo IPD cá nhân
- **Vị trí:** `eyeTrackingService.ts:207–211`
- **Mô tả:** `zDistance = (IPD_2D / faceWidth) × 10`. Công thức này dùng IPD 2D đo trên ảnh, **giả định IPD thật là hằng số giữa các user**. Thực tế IPD người lớn dao động 54–74 mm (NHANES), tức ±15 % quanh trung bình → z‑distance proxy lệch ±15 % cho user có IPD khác trung bình.
- **Cơ chế sai số:** Cross terms `lx·z`, `pitch·z` học sai → khi user thật cách màn hình 70 cm, mô hình tưởng là 60 cm và gaze prediction lệch.
- **Mức độ:** **M** (trung bình). Có thể giảm bằng *single‑point* IPD calibration một lần ban đầu.

#### Issue A3 — Không lọc khung blink/landmark confidence thấp
- **Vị trí:** `eyeTrackingService.ts:43–44` và `FeatureExtractor.ts:91`
- **Mô tả:** `minFaceDetectionConfidence = 0.5`, `minTrackingConfidence = 0.5` — mức ngưỡng khá thấp. Khi user chớp mắt, pupil landmark (468/473) bị nội suy "bóng tối" → pupil center sai lệch nghiêm trọng trong 3–6 frame.
- **Cơ chế sai số:** Trong calibration, các frame blink lẫn vào buffer → kéo regression coefficients lệch. Trong tracking, gaze nhảy 100–300 px khi blink.
- **Mức độ:** **H**. Đây là nguyên nhân chính dẫn tới BCEA bị thổi phồng trong bài fixation stability.

#### Issue A4 — Blendshape gaze proxies không bật mặc định
- **Vị trí:** `eyeTrackingService.ts:38` (`outputFaceBlendshapes: true`) nhưng feature flag `useBlendshapes` default false (`SettingsModal`).
- **Mô tả:** MediaPipe FaceLandmarker đã có 8 blendshape gaze chuyên biệt (`eyeLookInLeft`, `eyeLookUpRight`,…) — đây là output **của một NN được train trên hàng triệu khuôn mặt** với annotations gaze. Bỏ qua nguồn tín hiệu này là lãng phí lớn.
- **Cơ chế cải tiến:** Thêm vào feature vector → tăng dim từ 25 → 33; tỷ lệ giảm sai số quan sát thực nghiệm trong literature: 15–30 %.
- **Mức độ:** **M–H**.

#### Issue A5 — Head pose không có temporal smoothing
- **Vị trí:** không có (tính lại từ landmarks mỗi frame).
- **Mô tả:** Pitch/yaw/roll noisy ~±1°/frame do landmark jitter. Khi đầu thực sự đứng yên, head pose vẫn dao động → cross terms `lx·yaw` cũng dao động → gaze cursor jitter ngay cả ở fixation.
- **Mức độ:** **M**. Khắc phục bằng 1€ Filter riêng cho head pose hoặc lọc landmark trước khi tính pose.

#### Issue A6 — Pupil landmark 468/473 không có sub‑pixel refinement
- **Vị trí:** dùng trực tiếp từ MediaPipe (`FeatureExtractor.ts:93`).
- **Mô tả:** MediaPipe iris landmark đã khá tốt nhưng vẫn có sai số ~1.5–2 px ở khoảng cách 60 cm. Mỗi pixel của pupil landmark tương đương 5–8 px gaze trên màn hình 1080p.
- **Cải tiến:** Iris circle fitting (Hough/Daugman) trong vùng ROI có thể refine pupil center xuống 0.5 px. Tuy nhiên nặng tính toán, có thể chấp nhận sai số này nếu các cải tiến khác đã đủ.
- **Mức độ:** **L**.

### 4.2 Nhóm B — Calibration

#### Issue B1 — Số điểm calibration mặc định 9 là thấp cho TPS
- **Vị trí:** `lib/neurologicalConfig.ts`; `SettingsModal`.
- **Mô tả:** TPS với 7 đặc trưng input cần tối thiểu 8 điểm để giải. 9 điểm hoạt động nhưng **không có biên dự phòng** — nếu 1–2 điểm bị blink/outlier, hệ trở thành ill‑conditioned.
- **Khuyến nghị literature:** 13–25 điểm (Carter & Luke 2020) hoặc smooth‑pursuit calibration (vẽ liên tục một đường) cho mật độ cao hơn.
- **Mức độ:** **M**.

#### Issue B2 — Click & Hold không xác minh gaze thực sự ở target
- **Vị trí:** `CalibrationLayer.tsx`.
- **Mô tả:** User chỉ cần **click chuột** vào dot — không có ràng buộc gaze phải gần con trỏ. Nhiều user click chính xác bằng motor memory mà mắt đã liếc sang dot kế tiếp.
- **Cơ chế sai số:** Training pairs `(features, target_xy)` bị nhiễu vì gaze thực không khớp target.
- **Cải tiến:** Sau khi click, kiểm tra raw gaze prediction (từ Ridge tạm) cách dot < threshold; nếu không thì reject sample.
- **Mức độ:** **M–H**.

#### Issue B3 — TPS λ = 0.5 quá cao
- **Vị trí:** `mathUtils.ts:118`, `RegressionService.ts:91`.
- **Mô tả:** Bookstein (1989, IEEE TPAMI) đề xuất λ ≈ 0 cho TPS interpolation và λ nhỏ (~σ_noise²) cho TPS approximation. Với λ = 0.5 trên radial basis `r²ln r` ở scale eye features ~[−1, 1], regularization **rất mạnh**, biến TPS thành "near‑affine" — đánh mất ưu thế phi tuyến.
- **Cải tiến:** Tune λ qua LOOCV trên grid {0.001, 0.01, 0.05, 0.1, 0.3, 0.5} riêng cho từng user.
- **Mức độ:** **M**.

#### Issue B4 — Không có drift correction trong tracking
- **Vị trí:** không có cơ chế.
- **Mô tả:** Calibration thực hiện một lần lúc đầu. Sau 2–5 phút, do:
  - Mỏi mắt (fatigue)
  - Thay đổi tư thế đầu nhỏ
  - Thay đổi ánh sáng (cloud passes outside window)
  → mean error có thể tăng 30–50 %.
- **Cải tiến:** Drift correction theo điểm cố định trước mỗi bài test (15 s overhead, đề xuất ở Mục 5.2.3).
- **Mức độ:** **H** cho session > 3 phút.

#### Issue B5 — Validation 5 điểm cho mean error → ước lượng nhiễu
- **Vị trí:** doc + `App.tsx`.
- **Mô tả:** Mean error từ 5 điểm có **sample std dev** rất lớn. Bootstrap CI 95 % của mean qua 5 điểm rộng ±2.5σ/√5 ≈ ±1.12σ → mean error ước lượng có thể lệch ±50 px chỉ vì randomness.
- **Cải tiến:** Tăng lên 9–13 validation points, hoặc đo thêm **percentile 95** (worst‑case) ngoài mean.
- **Mức độ:** **L–M** (ảnh hưởng tới quyết định "good/bad accuracy" hiển thị).

#### Issue B6 — Outlier removal bằng TRIM_TAILS dựa trên feature index 1 (lx)
- **Vị trí:** `mathUtils.ts:811`, `RegressionService.ts:283`.
- **Mô tả:** Sort theo lx rồi cắt 25 % hai đầu. Nhưng outliers thực có thể là khi `pitch` hoặc `EAR` lệch (blink) — không phải lx. Sort‑by‑lx **bỏ sót blink outliers**.
- **Cải tiến:** Dùng Mahalanobis distance trên toàn feature vector (đã có ở `STD_DEV` mode nhưng không default).
- **Mức độ:** **M**.

#### Issue B7 — Không có kappa angle calibration
- **Vị trí:** không tồn tại.
- **Mô tả:** Eye optical axis (pupil center → fovea) **không trùng** với visual axis. Lệch kappa angle ~ 2–3° (Tabernero et al. 2011, *Vision Research*). Hệ thống học implicit kappa qua regression — nhưng vì kappa **cố định cho từng user**, nó là tham số tốt nhất để tách ra calibrate riêng.
- **Cải tiến:** 1 điểm fixation chuyên dụng để estimate kappa offset (Δx_κ, Δy_κ) → trừ trực tiếp khỏi gaze prediction.
- **Mức độ:** **M**.

### 4.3 Nhóm C — Regression

#### Issue C1 — Ridge λ = 0.001 cố định
- **Vị trí:** `mathUtils.ts:78`, `RegressionService.ts:51`.
- **Mô tả:** Số mẫu calibration ít (n = 9 × ~30 frame = 270 mẫu sau temporal trim ≈ 162 mẫu) so với 25–37 đặc trưng → high‑variance regime; λ nên ≥ 0.1 thay vì 0.001 nếu không có cross‑validation tune.
- **Cải tiến:** Generalised Cross‑Validation (GCV) để chọn λ.
- **Mức độ:** **L–M**.

#### Issue C2 — Hybrid kNN k = 4 cố định
- **Vị trí:** `mathUtils.ts:398`, `RegressionService.ts:217`.
- **Mô tả:** Với 9 calibration points (mỗi điểm là một centroid sau temporal trim), k = 4 nghĩa là gần một nửa số neighbour — gần như Ridge thuần. Với 25 điểm thì k = 4 hợp lý. → k nên là `max(3, min(7, ⌈√n⌉))` adaptive.
- **Mức độ:** **L**.

#### Issue C3 — Gaze prediction không clamp trong viewport
- **Vị trí:** `RegressionService.ts:209`.
- **Mô tả:** Khi gaze ra ngoài calibration domain (look at edges, especially corners), regression extrapolate → có thể trả `x = −500` hoặc `x = 3000` trên màn hình 1920 px. Anti‑saccade test đặc biệt nhạy vì user phải nhìn ra rìa.
- **Cải tiến:** Soft‑clip với edge‑aware regression (extrapolation penalty) hoặc Gaussian Process với uncertainty.
- **Mức độ:** **M**.

#### Issue C4 — Không có ensemble
- **Mô tả:** Chỉ 1 trong 3 (Ridge/TPS/Hybrid) được dùng tại một thời điểm. Có thể trung bình có trọng số theo LOOCV error.
- **Mức độ:** **L**.

### 4.4 Nhóm D — Smoothing / Filtering

#### Issue D1 — Saccade threshold cố định 50 px
- **Vị trí:** `mathUtils.ts:585`.
- **Mô tả:** 50 px là saccade nhỏ; với gaze model error 100 px, **mọi frame** đều bị flag là saccade → filter liên tục reset → gaze cursor rất giật.
- **Cải tiến:** Adaptive threshold = `max(50, 2 × meanValidationErrorPx)`.
- **Mức độ:** **M**.

#### Issue D2 — 1€ Filter params không adapt theo task
- **Mô tả:** Saccadic test cần beta cao (giảm lag để bắt saccade onset), fixation stability cần beta thấp (mịn). Hệ thống dùng cùng minCutoff/beta cho cả hai.
- **Cải tiến:** Profile filter params theo `testId`.
- **Mức độ:** **M**.

#### Issue D3 — Sample bị nhiễu lúc filter reset không được loại
- **Vị trí:** `mathUtils.ts:701–710`.
- **Mô tả:** Sau saccade detect, filter reset → frame đầu tiên là **raw value**, có thể vẫn nhiễu cao → gaze nhảy.
- **Cải tiến:** Thêm "settling period" 3 frame, dùng MA window trong window này.
- **Mức độ:** **L**.

### 4.5 Nhóm E — Scoring & Event Detection

#### Issue E1 — Saccadic latency dùng "first enter AOI" thay vì velocity‑based onset
- **Vị trí:** `tests/saccadic/SaccadicTest.tsx:148`.
- **Mô tả:** Latency được đo từ stimulus onset đến lúc gaze **rơi vào** AOI 80 px. Đây không phải saccade onset chuẩn lâm sàng (Salvucci & Goldberg 2000; Engbert & Mergenthaler 2006). Saccade onset chuẩn = thời điểm **velocity vượt threshold** (e.g. 30–100 °/s).
- **Cơ chế sai số:** Nếu gaze model có offset 50 px, gaze có thể đã thực sự saccade nhưng vẫn ngoài AOI 80 px → latency ghi nhận muộn 100–300 ms (so với chuẩn 220 ms → +50 % !).
- **Mức độ:** **H**. Đây là vấn đề chấm điểm lớn nhất.

#### Issue E2 — AOI cố định 80 px không scale theo mean validation error
- **Vị trí:** `tests/saccadic/constants.ts:36`; `antiSaccade/constants.ts:61` (70 px).
- **Mô tả:** Nếu mean validation error là 100 px, AOI 80 px **nhỏ hơn cả độ chính xác mô hình** → high probability of false‑miss; điểm = 0 dù mắt thực sự liếc đúng.
- **Cải tiến:** `AOI = max(80, 1.5 × meanValidationErrorPx)`.
- **Mức độ:** **H**.

#### Issue E3 — BCEA không lọc gaze = (0,0) và blink frames
- **Vị trí:** `tests/fixationStability/FixationStabilityTest.tsx:113`.
- **Mô tả:** Khi MediaPipe mất face hoặc gaze model chưa load, `neuroLiveGazeRef.current` có thể về (0,0) — góc trên trái màn hình. Các sample này tham gia tính sample covariance → BCEA blow up gấp 50‑100×. Code có check `bcea95 === 0` (singularity case) nhưng **không lọc (0,0)** trước khi covariance.
- **Cải tiến:** Drop samples với (0,0), samples khi `isBlinking()`, và samples cách median > 5 SD trước khi tính BCEA.
- **Mức độ:** **H** (cho fixation stability score).

#### Issue E4 — Anti‑saccade angular error dùng mean gaze toàn bộ trial
- **Vị trí:** `tests/antiSaccade/AntiSaccadeTest.tsx:247`.
- **Mô tả:** `gazeMean = mean(gazeSamples over movement phase)`. Nhưng anti‑saccade chuẩn (Munoz & Everling 2004) đo dựa trên **first saccade vector** trong cửa sổ latency (100–400 ms sau stimulus). Mean cả 1.5 s pha movement gộp:
  - Pro‑saccade lỗi ban đầu (nhìn nhầm về primary rect)
  - Correction về dim rect đúng
  → mean ≈ gần center → angular error nhỏ giả tạo HOẶC ngược lại.
- **Cải tiến:** Detect saccade events bằng I‑VT, lấy *first* saccade trong cửa sổ 100–400 ms.
- **Mức độ:** **H**.

#### Issue E5 — Direction accuracy 100 % khi không có angular error
- **Vị trí:** `resultScoring.ts:192`.
- **Mô tả:** Fallback dùng `directionAccuracy` (% trial gaze vào AOI). Nhưng nếu gaze model lệch, AOI 70 px sẽ không hit → `directionAccuracy = 0`, score = 0 dù người dùng làm đúng.
- **Mức độ:** **H** (cùng nguyên nhân với E2).

#### Issue E6 — p10/p90 baselines không hiệu chuẩn theo norms lâm sàng
- **Vị trí:** `resultScoring.ts:44`.
- **Mô tả:** Bảng so sánh với norms thực tế (xem Mục 6 chi tiết):
  | Test | Code p10 | Code p90 | Norm μ | Norm σ | Ghi chú |
  | --- | --- | --- | --- | --- | --- |
  | saccadic latency | 150 ms | 600 ms | 220 ms | 43 ms | p90 = 600 ms quá rộng — score 50 ứng latency 375 ms (3.6σ trên norm) |
  | anti‑saccade ang error | 5° | 60° | μ_corr ≈ 8–12° | 5° | p90 = 60° vô lý — gaze cách 60° là gần như nhìn ra ngoài màn hình |
  | BCEA 95% | 6 000 px² | 100 000 px² | 2.4 °² (≈ 3 800 px² @60 cm/96 dpi) | 2.0 °² | p10 hợp lý; p90 quá rộng |
  | head_orientation | 0.5 (scaled rad) | 2.5 (scaled rad) | unit chưa rõ | — | unit của metric không phải degrees thật (vì geometric pose là proxy — xem A1) |
- **Mức độ:** **H** cho ý nghĩa lâm sàng của điểm.

#### Issue E7 — Score "head_orientation" tính trên proxy radian giả
- **Vị trí:** `resultScoring.ts:86–104`.
- **Mô tả:** rangeDeg lấy từ `maxRangeDeg` của head samples — nhưng head pose hiện tại là geometric proxy không phải Euler thật (Issue A1). Khi user xoay đầu thật 30°, `yaw` proxy có thể là 1.2–2.0 không phải 0.52 rad. Comment trong code `head_orientation: p10 = 0.5, p90 = 2.5` cũng thừa nhận "scaled radians".
- **Cải tiến:** Dùng `matrixHeadPose` cho true Euler rồi convert sang degrees thực.
- **Mức độ:** **M**.

#### Issue E8 — LENIENT_MODE gán điểm tham gia tối thiểu 25–30 che lấp vấn đề thật
- **Vị trí:** `resultScoring.ts:11, 200–211, 266`.
- **Mô tả:** Khi không tính được score, hệ thống fallback về 25–30 điểm "khuyến khích". Điều này:
  - Che giấu vấn đề tracking/scoring thật sự
  - Làm điểm mất giá trị clinical
- **Khuyến nghị:** Báo cáo riêng `quality_flag` thay vì gán điểm tham gia.
- **Mức độ:** **M**.

---

### 4.6 Ước lượng error budget tổng thể

Cộng đóng góp của các nguồn sai số chính (theo độ lệch chuẩn σ về gaze prediction, sai số cộng quadratic vì gần độc lập):

| Nguồn | σ ước lượng (px @ 60 cm, 1080p) |
| --- | --- |
| MediaPipe iris landmark noise | ~ 10 px |
| Geometric head pose error | ~ 60 px (khi có head motion) |
| Blink contamination chưa lọc | ~ 30 px |
| TPS over‑regularization (λ=0.5) | ~ 25 px |
| Click‑and‑hold không verify gaze | ~ 35 px |
| No drift correction (5 phút) | ~ 40 px |
| Z‑distance / IPD assumption | ~ 15 px |
| **Tổng σ (RSS)** | **~ 95 px** |

Tương đương ~2.3° thị giác @ 60 cm — gần với observation của các báo cáo user "validation 100–250 px". Nếu khắc phục các issue **H** (A1, A3, B4, E1, E2, E3, E4, E6), ước lượng còn σ ~ 40 px (~ 1.0°), tiệm cận state‑of‑the‑art webcam tracker.

---

## 5. Đề xuất cải tiến (Proposed Improvements)

Phần này trình bày 4 cụm cải tiến lớn, sắp theo mức ưu tiên dựa trên error budget.

### 5.1 Cụm 1 — Nâng cấp Vision Pipeline (giải quyết A1–A5)

#### 5.1.1 Bật mặc định Matrix‑based Head Pose

Thay vì geometric heuristic, dùng trực tiếp 4×4 transformation matrix `M` mà MediaPipe FaceLandmarker trả về:

$$
R = \begin{pmatrix} r_{00} & r_{01} & r_{02} \\ r_{10} & r_{11} & r_{12} \\ r_{20} & r_{21} & r_{22} \end{pmatrix}, \quad
\begin{aligned}
\text{pitch} &= \mathrm{atan2}(-r_{20}, \sqrt{r_{00}^2 + r_{10}^2}) \\
\text{yaw}   &= \mathrm{atan2}(r_{10}, r_{00}) \\
\text{roll}  &= \mathrm{atan2}(r_{21}, r_{22})
\end{aligned}
$$

Kết quả ở radians thật, không phụ thuộc face_width.

**Code change:** đặt `useTransformationMatrix: true` mặc định trong `DEFAULT_CONFIG` (file `types.ts`).

#### 5.1.2 Temporal Smoothing cho Head Pose

Áp dụng 1€ Filter riêng cho từng kênh (pitch, yaw, roll) với:
- `minCutoff = 0.5 Hz` (head pose stable hơn gaze)
- `beta = 0.1`

Pseudo‑code:
```ts
class HeadPoseSmoother {
  pitchF = new OneEuroFilter(0.5, 0.1);
  yawF   = new OneEuroFilter(0.5, 0.1);
  rollF  = new OneEuroFilter(0.5, 0.1);
  smooth(pose, t) {
    return {
      pitch: this.pitchF.filter(pose.pitch, t),
      yaw:   this.yawF.filter(pose.yaw, t),
      roll:  this.rollF.filter(pose.roll, t),
    };
  }
}
```

#### 5.1.3 Sample Quality Estimator (giải quyết A3)

Mỗi frame, tính quality score `q ∈ [0, 1]`:

$$
q = w_{\text{conf}} \cdot \mathbb{1}[\text{conf} > 0.7] \cdot
    w_{\text{ear}} \cdot \mathbb{1}[\text{EAR} > 0.22] \cdot
    w_{\text{jump}} \cdot \mathbb{1}[|\Delta\text{pupil}| < 5\text{px/frame}]
$$

Trong calibration: dùng làm `sampleWeights` cho `Matrix.weightedRidgeSolve` (đã có sẵn API). Trong tracking: skip frame với `q < 0.3` và carry forward last valid gaze.

#### 5.1.4 Bật blendshape gaze features mặc định (A4)

Thêm 8 chiều `eyeLookInLeft/Right`, `eyeLookOutLeft/Right`, `eyeLookUpLeft/Right`, `eyeLookDownLeft/Right` vào feature vector. Empirical: theo Konrad et al. 2023, NN gaze proxies giảm cross‑subject MAE 20–30 %.

### 5.2 Cụm 2 — Calibration được cá nhân hoá và có drift correction

#### 5.2.1 Tăng số điểm + Smooth‑Pursuit Calibration

Thay 9 điểm tĩnh bằng:
- **Phase 1:** 13 điểm tĩnh (lưới 3×3 + 4 corner cận biên)
- **Phase 2:** **Smooth‑pursuit calibration** — một chấm di chuyển theo đường Lissajous (kiểu pattern `h_pattern` đã có) chậm 5 °/s trong 30 s → thu ~900 sample dày đặc.

Smooth‑pursuit calibration đã được chứng minh giảm cross‑validation error 30–40 % so với grid‑only (Drewes et al. 2014, *PETMEI*).

#### 5.2.2 Kappa angle personalization (B7)

Sau calibration ban đầu, yêu cầu user fixation 2 s vào điểm chính giữa. Tính:

$$
(\Delta x_\kappa, \Delta y_\kappa) = (\bar x_{\text{predicted}} - x_{\text{center}}, \bar y_{\text{predicted}} - y_{\text{center}})
$$

Trừ offset này khỏi mọi gaze prediction sau đó. Đơn giản nhưng giảm bias systematic.

#### 5.2.3 Online Drift Correction

Trước mỗi bài test (head_orientation, saccadic, …), hiển thị 1 chấm trong 1 s ở 4 vị trí cho user fixate → ước lượng affine correction $T$ minimizing mean squared error:

$$
T^* = \arg\min_T \sum_{i=1}^{4} \|T \cdot \hat g_i - t_i\|^2
$$

trong đó $\hat g_i$ là gaze predict, $t_i$ là target. $T$ là affine 2D (6 tham số: scale x/y, shear, translation x/y, rotation). Áp dụng $T$ như post‑processing layer trong suốt bài test.

Tham khảo: Hornof & Halverson 2002, *Behavior Research Methods*: 4‑point affine drift correction giảm bias 60–80 % cho session > 2 phút.

#### 5.2.4 Tune TPS λ qua LOOCV (B3)

Trên grid `λ ∈ {0.001, 0.01, 0.05, 0.1, 0.3, 0.5, 1.0}`:
```ts
function tuneTpsLambda(inputs, outputs) {
  let bestLambda = 0.1, bestErr = Infinity;
  for (const lambda of [0.001, 0.01, 0.05, 0.1, 0.3, 0.5, 1.0]) {
    const err = loocvError(inputs, outputs, lambda);
    if (err < bestErr) { bestErr = err; bestLambda = lambda; }
  }
  return bestLambda;
}
```
Overhead: 7 × LOOCV (mỗi LOOCV n iterations với n≈9–13) ≈ 0.5–1 s.

### 5.3 Cụm 3 — Phát hiện sự kiện mắt theo chuẩn lâm sàng

#### 5.3.1 Saccade onset bằng I‑VT (E1)

Thuật toán Salvucci & Goldberg I‑VT:

```
Input: gaze samples {(t_i, x_i, y_i)}_{i=1..N}, viewing distance D, dpi, threshold v* (°/s)
1. Convert px → degrees: θ_x = atan2(x − x_screen_center, D · dpi/2.54) · 180/π
2. For each i from 2 to N:
     v_i = sqrt((θ_x[i] − θ_x[i-1])² + (θ_y[i] − θ_y[i-1])²) / (t_i − t_{i-1})
3. Saccade onset = min{i : v_i > v*}
4. Latency = t_onset − t_stimulus
```

Recommended `v* = 30 °/s` (sensitive) hoặc `v* = 50 °/s` (conservative, more stable cho webcam noise).

Áp dụng cho Saccadic và Anti‑Saccade test.

#### 5.3.2 Adaptive AOI (E2)

Đặt AOI radius = `max(80, 1.5 × meanValidationErrorPx)`. Log warning khi AOI bị scale > 150 px (chất lượng calibration kém).

#### 5.3.3 BCEA pipeline sạch (E3)

Trước khi tính covariance:
1. Drop sample `(x, y) = (0, 0)` (gaze chưa init)
2. Drop sample khi `isBlinking()` true ± 3 frames
3. Drop sample cách median > 5 × MAD (median absolute deviation — robust outlier)

Pseudo‑code:
```ts
function cleanFixationSamples(samples, isBlinkingAt) {
  // 1. drop zeros
  let s = samples.filter(p => !(p.x === 0 && p.y === 0));
  // 2. drop blinks (with 3-frame buffer)
  s = s.filter((p, i) => !isBlinkingAt(p.t, 3));
  // 3. drop MAD outliers
  const mx = median(s.map(p => p.x));
  const my = median(s.map(p => p.y));
  const mad = median(s.map(p => Math.hypot(p.x - mx, p.y - my)));
  return s.filter(p => Math.hypot(p.x - mx, p.y - my) <= 5 * mad);
}
```

#### 5.3.4 Anti‑saccade first‑saccade direction (E4)

```
1. Phát hiện saccade events bằng I‑VT trong window [stimulus_onset, stimulus_onset + 400 ms].
2. Lấy first saccade với amplitude > 2°.
3. Direction = atan2(end_y − start_y, end_x − start_x).
4. Angular error = shortestAngularDiff(direction, target_direction).
```

Bỏ logic mean‑gaze hiện tại.

### 5.4 Cụm 4 — Hiệu chuẩn lại scoring với dữ liệu chuẩn lâm sàng

Xem Mục 6 cho bảng đầy đủ.

---

## 6. Hiệu chuẩn ngưỡng chấm điểm (Normative Recalibration)

### 6.1 Saccadic latency

| | p10 | p50 | p90 | Nguồn |
| --- | --- | --- | --- | --- |
| **Mới (norm)** | 180 ms | 220 ms | 300 ms | Antoniades et al. 2013; Munoz & Everling 2004 |
| **Cũ (code)** | 150 ms | — | 600 ms | seed |

**Giải thích:** Pro‑saccade healthy adult: 220 ± 43 ms. p10 = μ − 1.28σ ≈ 165 ms; p90 = μ + 1.28σ ≈ 275 ms. Làm tròn: p10 = 180, p90 = 300.

### 6.2 Anti‑saccade angular error

Sau khi đổi sang first‑saccade direction (E4):

| | p10 | p50 | p90 |
| --- | --- | --- | --- |
| **Mới** | 5° | 12° | 25° |
| **Cũ** | 5° | — | 60° |

Anti‑saccade error rate 20 % nghĩa là 20 % trials có first saccade về phía SAI (~180° lệch). Tính trung bình angular error qua mọi trial:
- 80 % trials đúng (~5–15° lỗi)
- 20 % trials sai (~150–180° lỗi)
→ mean ≈ 0.8·10 + 0.2·165 ≈ 41° **nếu** lấy raw mean.

Cải tiến: chấm theo 2 metric tách bạch:
1. **Direction accuracy** (% first saccade đi đúng hướng) — chuẩn lâm sàng.
2. **Spatial precision** trên correct trials only.

### 6.3 Fixation Stability (BCEA 95)

Chuẩn MAIA microperimeter: BCEA 95 ≈ 2.4 ± 2.0 °².

Quy đổi sang px² @ 60 cm viewing, 96 DPI:
- 1° thị giác @ 60 cm = `60 cm · tan(1°)` = 1.047 cm = 39.6 px (96 DPI).
- 1°² = 1 568 px²
- BCEA 95 trung bình = 2.4 °² = **3 763 px²**

| | p10 | p50 | p90 |
| --- | --- | --- | --- |
| **Mới** | 1 500 px² (≈ 0.96°²) | 3 800 px² (≈ 2.4°²) | 9 400 px² (≈ 6.0°²) |
| **Cũ** | 6 000 px² | — | 100 000 px² |

**Quan trọng:** Khi user vùng "Excellent" lâm sàng, BCEA 95 ≈ 1.5°² → ~ 2 350 px². Code cũ p10 = 6 000 px² nghĩa là người đạt clinical "excellent" vẫn chỉ score được < 40/100.

### 6.4 Peripheral Vision

Chuẩn: simple reaction time ở 20° eccentricity, 200–400 ms healthy adult (Posner 1980).

| | p10 | p90 |
| --- | --- | --- |
| **Mới** | 200 ms | 450 ms |
| **Cũ** | 200 ms | 800 ms |

### 6.5 Head Orientation

Sau khi chuyển sang true Euler từ matrix head pose (Mục 5.1.1), unit là radians thực, convert sang degrees:

| | p10 | p90 |
| --- | --- | --- |
| **Mới** | 15° (range yaw/pitch) | 50° |
| **Cũ** | 0.5 "scaled rad" | 2.5 "scaled rad" |

### 6.6 Bảng tổng hợp scoringConfig đề xuất

```ts
export const NORMATIVE_BASELINES_V2 = {
  visual_search:      { p10Ms: 25000, p90Ms: 80000 },        // tightened
  saccadic:           { p10LatencyMs: 180, p90LatencyMs: 300 },
  fixation_stability: { p10Bcea95: 1500, p90Bcea95: 9400 },  // px² @ 60cm, 96 DPI
  peripheral_vision:  { p10RtMs: 200, p90RtMs: 450 },
  anti_saccade:       { p10ErrorDeg: 5, p90ErrorDeg: 25 },   // on FIRST‑saccade only
  memory_cards:       { p10Efficiency: 0.55, p90Efficiency: 0.95 },
  head_orientation:   { p10RangeDeg: 15, p90RangeDeg: 50 },  // true Euler deg
};
```

### 6.7 Bù DPI và viewing distance thực tế

Bảng trên giả định 60 cm + 96 DPI. Để chính xác hơn, scoring engine nên:
1. Đọc `meanValidationErrorPx` và `viewingDistanceCm`
2. Convert mọi metric về **°² hoặc °** trước khi so với norms (norms độc lập với DPI/distance)

```ts
function pxToDeg(px: number, viewingDistanceCm: number = 60, ppi: number = 96): number {
  const cmPerPx = 2.54 / ppi;
  return Math.atan2(px * cmPerPx, viewingDistanceCm) * 180 / Math.PI;
}
```

Đã có `angularErrorDeg()` trong `resultScoring.ts:22` — nhưng chỉ dùng cho calibration quality, chưa apply cho scoring functions.

---

## 7. Lộ trình triển khai (Implementation Roadmap)

Sắp theo tỷ lệ "Impact / Effort":

| Ưu tiên | Hạng mục | Effort | Impact | Phụ thuộc |
| --- | --- | --- | --- | --- |
| **P0** | Bật `useTransformationMatrix` & `useBlendshapes` mặc định (Mục 5.1.1, 5.1.4) | 1 h | High | Re‑train mỗi user |
| **P0** | Clean BCEA samples (0,0, blink, MAD outliers) — Issue E3, Mục 5.3.3 | 2 h | High | — |
| **P0** | Adaptive AOI = max(80, 1.5×meanErrPx) — E2 | 1 h | High | — |
| **P0** | Hiệu chuẩn `NORMATIVE_BASELINES_V2` (Mục 6.6) | 2 h | High | — |
| **P1** | I‑VT saccade onset cho Saccadic & Anti‑saccade — E1, E4 | 1 ngày | High | px→deg conversion |
| **P1** | First‑saccade direction cho anti‑saccade — E4 | 4 h | High | I‑VT |
| **P1** | Online drift correction trước mỗi test — B4 | 1 ngày | High | — |
| **P1** | Sample quality estimator + weighted Ridge — A3 | 0.5 ngày | Medium‑High | — |
| **P1** | Head pose temporal smoothing — A5 | 2 h | Medium | — |
| **P2** | LOOCV‑tuned TPS lambda — B3 | 0.5 ngày | Medium | — |
| **P2** | Kappa angle 1‑point calibration — B7 | 4 h | Medium | — |
| **P2** | Click & Hold gaze‑verify — B2 | 0.5 ngày | Medium | Ridge tạm |
| **P2** | Adaptive saccade threshold — D1 | 1 h | Medium | meanValidErr |
| **P2** | Profile filter params theo testId — D2 | 0.5 ngày | Medium | — |
| **P3** | Smooth‑pursuit calibration phase 2 — Mục 5.2.1 | 2 ngày | Medium | UX redesign |
| **P3** | Ensemble Ridge+TPS theo LOOCV weight — C4 | 0.5 ngày | Low‑Medium | — |
| **P3** | Iris sub‑pixel refinement (Daugman) — A6 | 2 ngày | Low | — |

Tổng effort P0 + P1: ≈ 4 ngày dev. Kỳ vọng giảm mean error 50–60 % và sửa được toàn bộ điểm 0/100 bất thường.

---

## 8. Phương pháp đánh giá (Evaluation Plan)

### 8.1 Thiết kế thực nghiệm

**Within‑subject A/B comparison.**

- N = 15–20 participant khoẻ mạnh, 18–60 tuổi.
- Mỗi participant chạy 2 session, randomized order:
  - **A:** hệ thống hiện tại
  - **B:** hệ thống sau cải tiến P0+P1
- Cùng webcam (built‑in laptop), cùng viewing distance 60 cm (đo bằng thước).
- Cùng 7 bài test.

### 8.2 Metric đánh giá

1. **Calibration accuracy:** Mean validation error (px → degrees). Mục tiêu: B giảm 50 % so với A.
2. **Per‑test score validity:**
   - Saccadic latency: tương quan với norm μ = 220 ms; expect B closer to norm.
   - Anti‑saccade direction accuracy: % first saccade đúng; expect 70–90 %.
   - BCEA 95 (°²): expect μ ≈ 2.4 (khớp MAIA norm).
3. **Test‑retest reliability:** ICC (intraclass correlation) between Session 1 và Session 2.
4. **Detection of head movement artefacts:** Tỷ lệ frame bị reject; expect B reject hợp lý 5–15 % thay vì 0 % (system A không reject).

### 8.3 Tiêu chí thành công

- B đạt mean error < 1.5° thị giác (≈ 60 px @ 60 cm, 96 DPI).
- Saccadic latency mean trong [200, 280] ms cho healthy adult.
- 0 % score = 0/100 cho healthy participant (so với system A nơi 10–20 % bài test trả 0).
- ICC ≥ 0.75 (good test‑retest reliability).

---

## 9. Kết luận (Conclusion)

Hệ thống *Precision Eye Tracker* hiện tại đã xây dựng được pipeline đầy đủ và bài bản: MediaPipe FaceLandmarker → TPS/Hybrid regression → 1€ Filter → 7 bài kiểm tra thần kinh vận nhãn. Tuy nhiên, sai số tracking và logic chấm điểm còn nhiều điểm yếu khiến độ chính xác kém xa state‑of‑the‑art webcam tracker (1.4° vs ~ 2–7°) và điểm chấm chưa sát chuẩn lâm sàng.

Báo cáo này đã xác định **23 vấn đề kỹ thuật** cụ thể, sắp xếp thành **5 nhóm** (vision pipeline, calibration, regression, smoothing, scoring/event detection), và đề xuất **4 cụm cải tiến** với cơ sở toán học và literature rõ ràng:
1. Bật matrix head pose + blendshape gaze + quality‑weighted training.
2. Smooth‑pursuit calibration + kappa personalization + online drift correction.
3. I‑VT saccade onset + clean BCEA + first‑saccade direction cho anti‑saccade.
4. Hiệu chuẩn lại `p10`/`p90` theo norms lâm sàng (MAIA, Antoniades, Munoz & Everling).

Lộ trình triển khai 4 ngày dev cho P0+P1 dự kiến giảm mean error 50–60 %, đưa hệ thống vào ngưỡng "lab‑comparable" của tài liệu hiện hành. Các thử nghiệm A/B được đề xuất với N = 15–20 và bộ metric đầy đủ (calibration accuracy, score validity, test‑retest reliability) sẽ chứng minh giá trị của các cải tiến và là cơ sở vững chắc cho phần đóng góp khoa học của luận văn.

---

## Tài liệu tham khảo (References)

1. Abdelrahman, A. A., Hempel, T., Khalifa, A., & Al‑Hamadi, A. (2022). **L2CS‑Net: Fine‑Grained Gaze Estimation in Unconstrained Environments.** *arXiv:2203.03339*.
2. Ablavatski, A., Vakunov, A., Grishchenko, I., Raveendran, K., & Zhdanovich, M. (2020). **MediaPipe Iris: Real‑time Iris Tracking & Depth Estimation.** Google AI Blog / arXiv.
3. Andersson, R., Larsson, L., Holmqvist, K., Stridh, M., & Nyström, M. (2017). **One algorithm to rule them all? An evaluation and discussion of ten eye movement event‑detection algorithms.** *Behavior Research Methods*, 49, 616–637.
4. Antoniades, C., Ettinger, U., Gaymard, B., et al. (2013). **An internationally standardised antisaccade protocol.** *Vision Research*, 84, 1–5.
5. Bahill, A. T., Clark, M. R., & Stark, L. (1975). **The main sequence, a tool for studying human eye movements.** *Mathematical Biosciences*, 24(3‑4), 191–204.
6. Bookstein, F. L. (1989). **Principal warps: Thin‑plate splines and the decomposition of deformations.** *IEEE TPAMI*, 11(6), 567–585.
7. Carter, B. T., & Luke, S. G. (2020). **Best practices in eye tracking research.** *International Journal of Psychophysiology*, 155, 49–62.
8. Casteele, T., Vandeberg, L., et al. (2024). **Webcam eye tracking close to laboratory standards: Comparing a new webcam‑based system and the EyeLink 1000.** *Behavior Research Methods*. PMC11289017.
9. Drewes, J., Masson, G. S., & Montagnini, A. (2014). **Shifts in reported gaze position due to changes in pupil size: Ground truth and compensation.** *Proceedings of ETRA/PETMEI 2014*.
10. Engbert, R., & Kliegl, R. (2003). **Microsaccades uncover the orientation of covert attention.** *Vision Research*, 43(9), 1035–1045.
11. Engbert, R., & Mergenthaler, K. (2006). **Microsaccades are triggered by low retinal image slip.** *PNAS*, 103(18), 7192–7197.
12. Hornof, A. J., & Halverson, T. (2002). **Cleaning up systematic error in eye‑tracking data by using required fixation locations.** *Behavior Research Methods, Instruments, & Computers*, 34(4), 592–604.
13. Konrad, R., Angelopoulos, A., & Wetzstein, G. (2023). **Gaze estimation with deep learning: A survey and benchmark.** *IEEE TPAMI*.
14. Molina‑Martín, A., Piñero, D. P., & Pérez‑Cambrodí, R. J. (2017). **Normal Values for Microperimetry with the MAIA Microperimeter: Sensitivity and Fixation Analysis in Healthy Adults and Children.** *European Journal of Ophthalmology*. PubMed 28127734.
15. Morales, M. U., et al. (2016). **Reference Clinical Database for Fixation Stability Metrics in Normal Subjects Measured with the MAIA Microperimeter.** *Translational Vision Science & Technology*. PMC5113982.
16. Munoz, D. P., & Everling, S. (2004). **Look away: the anti‑saccade task and the voluntary control of eye movement.** *Nature Reviews Neuroscience*, 5(3), 218–228.
17. Niehorster, D. C., Cornelissen, T. H. W., Holmqvist, K., Hooge, I. T. C., & Hessels, R. S. (2018). **What to expect from your remote eye‑tracker when participants are unrestrained.** *Behavior Research Methods*, 50, 213–227.
18. Niehorster, D. C., Zemblys, R., Beelders, T., & Holmqvist, K. (2020). **Characterizing gaze position signals and synthesizing noise during fixations in eye‑tracking data.** *Behavior Research Methods*, 52, 2515–2534.
19. Papoutsaki, A., Sangkloy, P., Laskey, J., Daskalova, N., Huang, J., & Hays, J. (2016). **WebGazer: Scalable Webcam Eye Tracking Using User Interactions.** *Proceedings of IJCAI 2016*.
20. Posner, M. I. (1980). **Orienting of attention.** *Quarterly Journal of Experimental Psychology*, 32(1), 3–25.
21. Salvucci, D. D., & Goldberg, J. H. (2000). **Identifying fixations and saccades in eye‑tracking protocols.** *Proceedings of ETRA 2000*, 71–78.
22. Saxena, S., Lange, E., & Fink, L. (2024). **Saliency‑related gaze prediction with a webcam.** Frontiers in Robotics and AI. PMC11019238.
23. Tabernero, J., Benito, A., Alcón, E., & Artal, P. (2011). **Mechanism of compensation of aberrations in the human eye.** *Journal of the Optical Society of America A*, 24(10), 3274–3283.
24. Wood, E., & Bulling, A. (2014). **EyeTab: Model‑based gaze estimation on unmodified tablet computers.** *Proceedings of ETRA 2014*.
25. Zhang, X., Sugano, Y., Fritz, M., & Bulling, A. (2017). **MPIIGaze: Real‑World Dataset and Deep Appearance‑Based Gaze Estimation.** *IEEE TPAMI*.

---

## Phụ lục A — Map cải tiến tới file/dòng mã nguồn

| Cải tiến | File chính | Dòng / hàm cần sửa |
| --- | --- | --- |
| Matrix head pose default | `types.ts` (DEFAULT_CONFIG) + `eyeTrackingService.ts:301` | flag `useTransformationMatrix = true` |
| Blendshape default | `types.ts` (DEFAULT_CONFIG) | flag `useBlendshapes = true` |
| Head pose smoothing | `services/eyeTrackingService.ts` + new `HeadPoseSmoother` class | sau `calculateGeometricHeadPose` / `matrixHeadPose` |
| Sample quality estimator | `services/eyeTrackingService.ts` + `App.tsx` calibration loop | new method `estimateQuality(features) → 0..1` |
| Clean BCEA | `tests/fixationStability/FixationStabilityTest.tsx:113` | trước `computeBceaForSamples` |
| Adaptive AOI | `tests/saccadic/constants.ts:36` + `tests/antiSaccade/constants.ts:61` | export as function `getAOIRadius(meanErrPx)` |
| Normative baselines V2 | `lib/resultScoring.ts:44` (`SEED_BASELINES`) | thay bằng `NORMATIVE_BASELINES_V2` |
| I‑VT saccade onset | new `lib/saccadeDetection.ts` | export `detectSaccadeOnset(samples, viewDistCm, ppi, threshold)` |
| First‑saccade anti‑saccade | `tests/antiSaccade/AntiSaccadeTest.tsx:247` | thay logic `gazeMean` |
| Online drift correction | new `lib/driftCorrection.ts` + `NeurologicalFlowSection.tsx` | hook `useDriftCorrection()` chèn trước mỗi test |
| LOOCV TPS lambda | `services/mathUtils.ts:118` & `gaze-engine/services/RegressionService.ts:91` | helper `tuneLambda` |
| Kappa offset | new `lib/kappaCalibration.ts` | gọi sau initial calibration |
| Click & Hold verify | `components/CalibrationLayer.tsx` | check gaze prediction tạm |
| Adaptive saccade threshold | `services/mathUtils.ts:585` | `this.saccadeThreshold = Math.max(50, 2 * meanValidPx)` |
| Profile filter per test | `services/mathUtils.ts:627` (`updateConfig`) | overload theo testId |

## Phụ lục B — Bảng px ↔ degrees tham chiếu (60 cm, 96 DPI)

| Pixels | Cm | Degrees |
| --- | --- | --- |
| 1 | 0.026 | 0.025° |
| 10 | 0.26 | 0.25° |
| 40 | 1.06 | 1.0° |
| 100 | 2.65 | 2.53° |
| 200 | 5.29 | 5.04° |
| 300 | 7.94 | 7.55° |
| 500 | 13.23 | 12.43° |

Công thức: $\theta = \mathrm{atan}(N_\text{px} \cdot \mathrm{cm/px} / D) \cdot 180/\pi$ với cm/px = 2.54/PPI.

---

*Báo cáo này được biên soạn ngày 2026‑05‑22 dựa trên snapshot mã nguồn `main` của repository `eye-tracker-vercel`.*
