# Review lâm sàng — Bộ test vận nhãn (Neuro Eye-Movement Battery)

> Đánh giá thiết kế, ngưỡng lâm sàng và ý nghĩa của 7 bài test hiện tại, đối chiếu với
> consensus mới nhất (VOMS, King-Devick, EYE-SYNC, BrainEye, 2024–2025). Tinh thần: không
> mặc định thiết kế hiện tại đúng. Bổ sung cho `tickets/neurological_tests_summary.md`.

## TL;DR — 3 kết luận lớn

1. **Thiếu 2 test quan trọng nhất về mặt lâm sàng:** **Smooth Pursuit** (nền tảng của VOMS,
   biomarker concussion hàng đầu) và **Convergence / Near Point of Convergence (NPC)**
   (dấu hiệu concussion kinh điển — NPC giãn ra). Đây là lỗ hổng lớn nhất.
2. **3 test hiện có là đúng & validated:** Saccadic, Anti-Saccade, Fixation Stability —
   nhưng **metric chưa chuẩn** (vd anti-saccade thiếu *error rate*) và **ngưỡng là seed phỏng
   đoán**, chưa phải normative thật.
3. **2 test là cognitive, không phải oculomotor lõi:** Visual Search, Memory Cards — có giá
   trị sàng lọc nhận thức nhưng **không phải** biomarker vận nhãn concussion; nên định vị lại.

---

## Đối chiếu với chuẩn lâm sàng (VOMS)

VOMS = công cụ ít false-positive nhất, gồm: **Smooth Pursuit, Saccades (ngang/dọc),
Convergence (NPC), VOR (vestibulo-ocular reflex), Visual Motion Sensitivity**. BrainEye 2024
đạt **100% sensitivity / 85% specificity** khi kết hợp **smooth pursuit + pupillary light reflex**.

| Thành phần VOMS | Có trong hệ? | Ghi chú |
|---|---|---|
| Smooth Pursuit | ❌ **THIẾU** | Nền tảng VOMS; ưu tiên bổ sung số 1 |
| Saccades | ✅ Saccadic + Anti-Saccade | Tốt, cần chuẩn hóa metric |
| Convergence (NPC) | ❌ **THIẾU** | Dấu hiệu concussion kinh điển |
| VOR (gaze ổn định khi quay đầu) | ⚠️ Một phần | `head_orientation` đo *range* đầu, không đo *gaze stability khi quay đầu* |
| Visual Motion Sensitivity | ❌ Thiếu | Khó với webcam nhưng khả thi |
| Pupillary Light Reflex | ❌ Thiếu | Webcam RGB đo được phần nào; tăng sensitivity (BrainEye) |

---

## Review từng test

### 1. Saccadic Eye Movement — ✅ giữ, tinh chỉnh
- **Config:** `targetDurationMs 1000, totalCycles 18, AOI 80px`. Metric: latency.
- **Lâm sàng:** prosaccade latency healthy **220±43ms** (Antoniades 2013). Ngưỡng hiện tại
  `p10=150 / p90=600ms` — anchor "xuất sắc" 150ms nhanh hơn cả mean người khỏe (chấp nhận được),
  nhưng là **seed phỏng đoán**.
- **Nên bổ sung metric:** **peak velocity** (main sequence ~350°/s @10°), **accuracy/gain**
  (hypo/hypermetria), không chỉ latency. Các metric này validated cho concussion.
- **Rủi ro:** latency + AOI 80px phụ thuộc nặng vào độ chính xác tracking (xem Phase 05).

### 2. Anti-Saccade — ✅ giữ, sửa metric & thiết kế
- **Config:** `trialCount 12, movementSpeedPxPerSec 120`. Metric: angular error + accuracy.
- **⚠️ Vấn đề thiết kế:** anti-saccade kinh điển là **step** (target xuất hiện đột ngột ở
  ngoại vi → nhìn ngược lại), không phải stimulus **di chuyển** (`movementSpeedPxPerSec`).
  Stimulus di chuyển làm sai bản chất paradigm.
- **⚠️ Thiếu metric chính:** **error rate** (% trial nhìn nhầm về phía target trước rồi mới
  sửa) — đây mới là biomarker anti-saccade kinh điển (healthy ~20%, Munoz & Everling 2004).
  Cùng **anti-saccade latency** (343±76ms).
- **12 trial:** hơi ít để ước lượng error rate ổn định; cân nhắc 20–40 trial.

### 3. Fixation Stability — ✅ giữ, kéo dài & chuẩn hóa đơn vị
- **Config:** `durationSec 5`. Metric: BCEA 95%.
- **Lâm sàng:** BCEA 95% (MAIA) healthy **2.4±2.0 °²** (Morales 2016). Ngưỡng hiện tại
  `p10=6000 / p90=100000 px²` — cần **đổi đơn vị px²→°²** nhất quán để so normative.
- **5s hơi ngắn** — fixation lâm sàng thường 10–30s để bắt micro-saccade/drift. Cân nhắc tăng.
- BCEA=0 hiện bị coi là lỗi cảm biến (đúng — sinh lý không thể).

### 4. Visual Search — ⚠️ cognitive, định vị lại
- Đo quét + nhận diện giữa nhiễu. **Không phải** biomarker vận nhãn concussion lõi; gần với
  attention/processing speed. Nếu dùng **dãy số đọc nhanh** thì gần **King-Devick** (validated,
  sensitivity cao nhưng specificity thấp). Giữ lại như sàng lọc nhận thức, đừng coi là oculomotor.

### 5. Memory Cards — ⚠️ cognitive, không phải vận nhãn
- Trí nhớ + phối hợp. Giá trị sàng lọc nhận thức/working memory, **không** phải biomarker
  vận nhãn. Định vị lại nhóm "cognitive", tách khỏi nhóm oculomotor khi báo cáo.

### 6. Peripheral Vision — ⚠️ không chuẩn cho concussion
- `trialCount 16, stimulusDurationMs 300`. Gần thị trường/attention ngoại vi hơn là vận nhãn
  concussion. Không có trong VOMS. Giữ nếu muốn nhưng đừng trọng số cao trong điểm concussion.

### 7. Head Orientation — ⚠️ là quality-check, có thể nâng cấp thành VOR
- Hiện đo *range* tư thế đầu (`durationPerDirection 4s`) — thực chất là **kiểm soát chất lượng
  tư thế**, không phải biomarker. **Cơ hội:** biến thành **VOR test** — yêu cầu **fixation 1 điểm
  cố định trong khi quay đầu** → đo gaze stability (đúng thành phần VOR của VOMS). Đây là nâng cấp
  giá trị cao.

---

## Vấn đề xuyên suốt (tất cả test)

1. **AOI 80px quá khắt khe** → "điểm 0 giả" khi calibration lệch nhẹ. Đề xuất **Dynamic AOI**
   (mở rộng theo validation error) + **Confidence Score** đi kèm điểm (đã nêu trong summary doc).
2. **Ngưỡng p10/p90 là seed phỏng đoán** → thay bằng normative thật (Phase 05 #07).
3. **Lỗi tracking trộn tín hiệu** → mọi metric thời gian/không gian (latency, velocity, BCEA,
   AOI hit) chỉ đáng tin khi tracking đủ chính xác → phụ thuộc Phase 05.
4. **Nội suy tuyến tính p10–p90** đơn giản hóa mức độ bệnh (vốn phi tuyến).
5. **Chưa tách nhóm oculomotor vs cognitive** khi báo cáo → khó diễn giải lâm sàng.

---

## Khuyến nghị ưu tiên

| # | Hành động | Lý do |
|---|---|---|
| A | **Thêm Smooth Pursuit test** (target di chuyển mượt, đo gain/lag) | Biomarker concussion #1, nền VOMS |
| B | **Thêm Convergence/NPC test** | Dấu hiệu concussion kinh điển, đang thiếu |
| C | **Sửa Anti-Saccade**: step stimulus + đo **error rate** + latency | Đúng paradigm + metric validated |
| D | **Nâng Head Orientation → VOR** (fixation khi quay đầu) | Biến quality-check thành biomarker |
| E | **Bổ sung metric Saccadic**: peak velocity + accuracy/gain | Validated cho concussion |
| F | Thay ngưỡng seed → normative; Dynamic AOI + Confidence | Giảm "điểm 0 giả", đáng tin lâm sàng |
| G | (Nice-to-have) **Pupillary Light Reflex** | Kết hợp pursuit → sensitivity rất cao (BrainEye) |

> Tất cả metric thời gian/không gian phụ thuộc độ chính xác tracking → **Phase 05 là tiền đề**
> cho mọi cải tiến test ở đây có ý nghĩa lâm sàng.

## Tham chiếu (2024–2025)
- VOMS & screening predict recovery — systematic review (PMC10783467)
- Validity of King-Devick for acute concussion, NCAA D1 (PMC12237940, 2025)
- Evaluation of sport-related concussion using objective eye tracking (Tandfonline 2025)
- Sensitivity/specificity of eye-movement biomarker for concussion (PMC6114025)
- Clinical Utility of Ocular Assessments in SRC — scoping review (PMC11417888)
- BrainEye smartphone eye-tracking in concussion management (Springer 2025)
- Classification of mTBI using computerized eye tracking (Nature Sci Rep 2024)
