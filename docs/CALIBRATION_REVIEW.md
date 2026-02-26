# Đánh giá chuyên môn: Thiết lập Calibration cho Eye Tracking độ chính xác cao

Tài liệu này đánh giá các bước calibration hiện tại (grid, exercises, validation) từ góc nhìn **phân tích dữ liệu**, **AI/ML**, và **optics / eye-tracking**, đồng thời đưa ra hướng cải thiện cụ thể.

---

## 1. Tổng quan thiết lập hiện tại

| Bước | Nội dung | Phạm vi tọa độ (% viewport) |
|------|----------|-----------------------------|
| **Grid (INITIAL_MAPPING)** | Lưới đều, `EDGE_PAD=4` | x,y ∈ [4, 96] |
| **Wiggling** *(đã chỉnh)* | Lissajous 2 vòng | Trước: 40–60% × 43–57% → **Sau: 12–88% × 12–88%** |
| **Horizontal** | Quét ngang | x ∈ [12, 88], y = 50 |
| **Vertical** | Quét dọc | x = 50, y ∈ [12, 88] |
| **Diagonal** | 4 đoạn chéo góc | [12,12]↔[88,88] và các cặp góc |
| **H-pattern** | Trái xuống, ngang, phải lên | Full biên trái/phải, trên/dưới |
| **Forward/backward** | Scale (depth) tại center | (50, 50) chỉ đổi scale |
| **Validation** | 5 điểm cố định | Góc (25,25),(75,75),(25,75),(75,25) + center (50,50) |

---

## 2. Đánh giá từng bước (các step khác)

| Step | Phạm vi / Hành vi | Đánh giá | Ghi chú |
|------|-------------------|----------|---------|
| **Grid** | x,y ∈ [4, 96] (EDGE_PAD=4) | ✅ Hợp lý | Điểm sát biên (4%–96%) tốt cho TPS/convex hull. Phạm vi **rộng hơn** exercises (12–88%) → grid định nghĩa “biên” màn hình, exercises lấp bên trong. |
| **Horizontal** | x ∈ [12, 88], y = 50 | ✅ Tốt | Quét đủ chiều ngang, cùng pad=12 với mọi exercise. |
| **Vertical** | x = 50, y ∈ [12, 88] | ✅ Tốt | Quét đủ chiều dọc. |
| **Forward/backward** | (50, 50), chỉ đổi scale | ⚠️ Không thêm vùng (x,y) | Không sinh thêm tọa độ màn hình; chỉ thay đổi kích thước chấm (depth/accommodation). Có thể giúp robustness với pupil size / head slight move. Nếu cần tối đa độ phủ không gian có thể xem đây là bước “bổ sung”, không thay thế các bước quét góc/rìa. |
| **Wiggling** | [12, 88] × [12, 88] (sau chỉnh) | ✅ Đã chỉnh | Trước quá nhỏ; hiện đồng bộ với các exercise khác. |
| **Diagonal** | 4 đoạn: (12,12)↔(88,88), (88,12)↔(12,88), v.v. | ✅ Tốt | Phủ 4 góc và 2 đường chéo, min/max = 12/88 thống nhất. |
| **H-pattern** | Cạnh trái (12), phải (88), trên (12), dưới (88), giữa ngang (50) | ✅ Tốt | Full biên + đường ngang giữa, phù hợp chuẩn eye-tracking. |
| **Validation** | 5 điểm: 4 góc (25,75) + center (50,50) | ⚠️ Thiếu mid-edge | Đủ để có chỉ số lỗi tổng quát; không có điểm giữa cạnh (50,12), (50,88), (12,50), (88,50) nên có thể bỏ sót lỗi lớn ở giữa cạnh. |

**Tóm tắt các step khác:**  
Grid, horizontal, vertical, diagonal, h_pattern đều **hợp lý** và dùng chung vùng 12–88% (trừ grid cố ý 4–96%). Chỉ **forward_backward** không mở rộng vùng (x,y), và **validation** nên bổ sung mid-edge nếu muốn đánh giá lỗi theo từng vùng chi tiết.

---

## 3. Đánh giá theo chuyên môn

### 3.1 Góc nhìn Optics / Eye-tracking

- **Phi tuyến ở rìa màn hình**: Góc mắt ↔ vị trí màn hình không tuyến tính; vùng rìa và góc cần nhiều điểm calibration hơn để giảm lỗi.
- **Grid với EDGE_PAD=4**: Điểm gần sát biên (4%–96%) là **hợp lý** cho TPS/hybrid vì mô hình cần anchor ở biên để ngoại suy ổn định.
- **Vấn đề wiggling cũ**: Biên độ 10%×7% chỉ tập trung ở giữa màn hình → nhiều sample trùng vùng, ít thông tin cho rìa → **lãng phí dữ liệu** và dễ overfit vùng center. Đã sửa bằng cách dùng cùng vùng [12, 88]% như các exercise khác.
- **Thứ tự exercises**: Horizontal/Vertical quét full range → tốt. Diagonal và H-pattern bổ sung góc. Wiggling (sau khi chỉnh) bổ sung vùng giữa với quỹ đạo phức tạp, giúp mô hình học tốt hơn vùng trung tâm mà không bỏ rơi rìa.

**Kết luận (optics)**: Thiết lập sau khi chỉnh wiggling là **hợp lý** cho độ phủ không gian. Có thể cải thiện thêm bằng tăng mật độ điểm ở góc/rìa (xem mục 4).

---

### 3.2 Góc nhìn Phân tích dữ liệu / ML

- **Mật độ mẫu**: Grid 9 điểm → 9 sample; mỗi exercise ~30 sample (sau downsample) → tổng ~9 + 6×30 ≈ 189 sample. Mật độ **cao dọc các đường** (horizontal, vertical, diagonal, H) nhưng **thưa ở vùng giữa các đường** (ví dụ giữa góc trên-trái và center). Wiggling mở rộng giúp lấp phần nào vùng giữa.
- **Convex hull**: TPS ngoại suy kém bên ngoài convex hull của training points. Grid + exercises đảm bảo hull phủ gần hết viewport; cần **luôn có điểm tại/sát góc** (grid với EDGE_PAD=4 đáp ứng).
- **Bias center**: Trước khi sửa, wiggling tạo rất nhiều sample quanh (50,50) → model có thể fit center rất tốt nhưng lỗi lớn hơn ở rìa. Sau khi mở rộng wiggling, phân bố sample cân bằng hơn.
- **Outlier & trimming**: Trim 20% đầu/cuối khi click-hold và trim tails trước khi train là **hợp lý** để giảm nhiễu và anticipation.

**Kết luận (data/ML)**: Pipeline **hợp lý**; chỉnh wiggling tăng chất lượng phân bố. Có thể cải thiện thêm bằng tăng số điểm grid (16–20) cho “high precision” và thêm validation điểm ở mid-edge (xem mục 4).

---

### 3.3 Góc nhìn Chuyên gia AI / Hệ thống

- **Feature space**: MediaPipe + normalized pupil + head pose + cross-terms là phù hợp. Calibration không chỉ map “mắt nhìn đâu” mà còn bù head pose → cần **phủ đủ không gian màn hình** ở nhiều góc đầu (nếu có). Exercises quét full range giúp thu được đa dạng tổ hợp (gaze + head).
- **Regression method**: TPS phù hợp cho phi tuyến; Hybrid (Ridge + k-NN) tốt khi có đủ điểm. Với mục tiêu **độ chính xác cực cao**, nên ưu tiên TPS và đảm bảo số điểm calibration đủ (≥ 9, tốt hơn 16–20).
- **Validation**: 5 điểm (4 góc + center) đo lỗi đại diện; thiếu **mid-edge** (giữa cạnh) nên có thể bỏ sót lỗi lớn ở rìa dọc/cạnh.

**Kết luận (AI)**: Kiến trúc và cách dùng calibration **hợp lý**; cải thiện chính là **phủ không gian tốt hơn** (wiggling đã chỉnh) và **đo validation kỹ hơn** (thêm điểm giữa cạnh).

---

## 4. Hướng cải thiện cụ thể

### Đã thực hiện

- **Wiggling**: Tăng biên độ từ (10%, 7%) lên **(38%, 38%)** (cùng vùng [12, 88]% với các exercise khác). Đường wiggling giờ phủ gần toàn bộ vùng calibration, không còn tập trung nhỏ ở giữa.

### Đề xuất thêm (theo mức độ ưu tiên)

1. **Tăng số điểm grid khi “high precision”**  
   - Trong Settings, gợi ý dùng 16 hoặc 20 điểm cho người cần độ chính xác cao.  
   - Grid 4×4 hoặc 4×5 cải thiện TPS/hybrid ở rìa và góc.

2. **Thêm validation điểm mid-edge**  
   - Ví dụ: (50, 12), (50, 88), (12, 50), (88, 50) để đo lỗi dọc theo 4 cạnh, bổ sung cho 4 góc + center.  
   - Giúp phát hiện lỗi lớn ở rìa mà 5 điểm hiện tại có thể bỏ sót.

3. **Đồng nhất hằng số vùng calibration**  
   - Dùng một constant (ví dụ `CALIBRATION_VIEW_PAD = 12`) cho grid và cho mọi exercise (đã dùng `pad=12` trong exercises; grid đang dùng `EDGE_PAD=4`).  
   - Có thể cân nhắc tăng grid `EDGE_PAD` lên 8–12 để điểm grid không quá sát mép (dễ khó nhìn), miễn là vẫn có điểm gần góc.

4. **Tùy chọn “calibration chế độ chính xác cao”**  
   - Bật sẵn: 16 điểm, Click & Hold, bật exercises, TPS.  
   - Có thể thêm gợi ý trong UI: “Dùng chế độ nhiều điểm khi cần độ chính xác cao”.

5. **Đo và hiển thị validation chi tiết**  
   - Hiển thị lỗi theo từng điểm (góc vs center vs mid-edge nếu có).  
   - Cho phép người dùng biết lỗi lớn ở vùng nào (ví dụ “góc trên bên phải lỗi cao”) để quyết định calibrate lại hay điều chỉnh tư thế.

---

## 5. Tóm tắt

- **Wiggling**: Đã chỉnh từ vòng quá nhỏ (40–60% × 43–57%) sang full range (12–88% × 12–88%), phù hợp với mục tiêu eye-tracking độ chính xác cao.
- **Setup tổng thể**: Grid (EDGE_PAD=4), các exercise (horizontal, vertical, diagonal, H, forward_backward) và validation 5 điểm là **hợp lý**; sau chỉnh wiggling thì phân bố dữ liệu và phủ không gian **tốt hơn**.
- **Hướng cải thiện tiếp**: Tăng số điểm grid (16/20), thêm validation mid-edge, đồng nhất constant vùng calibration, và (tuỳ chọn) chế độ “high precision” + báo lỗi validation theo vùng.
