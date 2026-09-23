# Khử nhiễu gaze: hậu xử lý, tiền xử lý vùng mắt

Tài liệu này trả lời các gợi ý của thầy:
- **Hậu xử lý kết quả (median):** để các biểu đồ Horizontal, Vertical… trong admin không còn bước nhảy lớn.
- **Tiền xử lý vùng mắt:** giảm nhiễu do ánh sáng và lóa.
- **Khử nhiễu khi đo và khi calibration.**

Mọi quyết định bên dưới đều dựa trên số liệu đo thật. Những kỹ thuật đã thử nhưng dữ liệu không ủng hộ được ghi rõ là không đưa vào.

## 1. Bước nhảy trên biểu đồ đến từ đâu

Số liệu lấy từ 61 lượt Test mode đã lưu, tổng 81.536 điểm. Đơn vị là % màn hình.

- Biểu đồ vẽ **đầu ra thô của hồi quy**, không qua bộ lọc nào.
- 3.7% số mẫu là gai kéo dài 1 mẫu.
- 8.8% số bước vượt 10% màn hình.
- Có dự đoán lệch tới **1612%** màn hình. Đó là lúc mô hình ngoại suy ra ngoài vùng đã calibrate, không phải mắt đang nhìn.
- Gaze lệch khỏi target trung vị khoảng 30% màn hình. Đây là **sai số độ chính xác** của mô hình, không phải nhiễu. Không bộ lọc nào sửa được loại sai số này.

## 2. Hậu xử lý (đã triển khai)

**Biểu đồ:** outlier bị **loại hẳn**, không thay bằng giá trị khác (`lib/smoothing.ts`). Điểm bị loại để trống, nên trên biểu đồ là một khoảng hở. Không có giá trị nào bị bịa ra.
- Ba loại bị loại:
  1. **Ngoài màn hình:** nằm ngoài dải −25% đến 125%, là lúc mô hình ngoại suy.
  2. **Gai theo Hampel:** lệch quá 3σ khỏi median cục bộ (±3 mẫu).
  3. **Gai vọt đi rồi về:** lệch khỏi trung điểm của hai mẫu kề quá 2 lần khoảng cách giữa chính hai mẫu đó, và quá 3% màn hình. Quy tắc này bắt các gai mà Hampel bỏ sót lúc mắt đang di chuyển nhanh, khi độ lệch cục bộ lớn làm ngưỡng bị nới ra.
- **Bước nhảy thật được giữ nguyên.** Saccade là dãy đơn điệu, hai mẫu kề nằm xa nhau, nên không dính quy tắc 3.
- **Việc loại outlier chạy cho mọi lựa chọn, trừ NONE (raw).** Do đó không phụ thuộc vào cấu hình làm mượt đang lưu trong DB. Phần làm mượt, nếu bật, chỉ chạy trên các mẫu còn lại.
- Trang admin session áp dụng mặc định, kèm ô chọn "Show raw gaze". Dữ liệu lưu trong DB không bị sửa.

| Trên 366 đoạn Test mode | Mẫu bị loại | Gai 1 mẫu >5% | Gai vọt-đi-rồi-về | Bước >10% | Bước lớn nhất |
|---|---|---|---|---|---|
| Thô (NONE) | 0% | 3.72% | 197 | 8.77% | 1612% |
| **Loại outlier** | **17.1%** | **0.55%** | **0** | **4.10%** | **129%** |
| Loại outlier + trung bình trượt 6 | 17.1% | 0.01% | 0 | 0.58% | 28% |

Về 0.55% excursion còn lại: đã kiểm tra cả 339 trường hợp, **không cái nào** có hai mẫu kề gần nhau (dưới 3%); khoảng cách trung vị giữa hai mẫu kề là 16.8% màn hình. Nghĩa là chúng nằm giữa một chuyển động nhanh có thật. Siết thêm sẽ xóa mất saccade thật chứ không phải xóa nhiễu.

**Phân tích kết quả:** phần tính RMS sai lệch giữa gaze và target trong workbook (`scripts/lib/topRuns.ts`) bỏ qua các mẫu đã loại, và ghi kèm số mẫu bị loại của từng bài. Biểu đồ trong workbook vẽ các mẫu đó thành khoảng hở.

**Luồng đo live** (`lib/gazePostprocess.ts`): chỉ bỏ frame, **không làm trễ**. Điều này quan trọng vì các bài saccadic đo độ trễ phản ứng trong khoảng 150–600 ms.
- Bỏ dự đoán nằm ngoài màn hình quá 25%, giữ nguyên đầu ra trước đó.
- Bỏ frame chớp mắt không hoàn toàn: EAR nhỏ hơn 0.65 × median của 1 s gần nhất.

**Đã thử, không đưa vào:** lọc Hampel và median theo kiểu causal trên luồng live. Bộ lọc nhầm các mẫu đầu của saccade thật là gai, làm saccade trễ 2 mẫu (133 ms ở 15 Hz).

## 3. Khử nhiễu mức feature khi đo và khi calibration

- **Calibration** (`docs/CALIBRATION_SAMPLING.md`): chỉ thu khi mắt đã ổn định trên điểm. Đệm quanh chớp mắt, lọc chớp không hoàn toàn, lấy tâm bằng median và loại frame lệch quá 3·MAD, thu lại điểm xấu.
- **Chớp không hoàn toàn khi đo live:** dùng cùng ngưỡng như trên. Trên session thật, bộ lọc không bỏ nhầm frame nào.
- **Đã thử, không đưa vào:** loại frame khi hai mắt lệch nhau bất thường. Bộ lọc này bỏ 24% số frame của video mà không giảm độ rung trong fixation (SD 0.0130 → 0.0129).

## 4. Tiền xử lý ảnh vùng mắt (đã thử, không đưa vào)

**Cách làm:**
- Chạy lại MediaPipe FaceLandmarker trên video calibration thật của **4 session**. Biến thể có xử lý thì chỉ xử lý vùng quanh hai mắt.
- Căn các cửa sổ fixation của từng điểm với video bằng feature iris đã lưu.
- So cặp từng điểm với bản không xử lý.
- Ba chỉ số:
  - độ rung trong fixation;
  - sai số leave-one-out trên grid;
  - sai số validation.
  Hai chỉ số sai số dùng mô hình bậc 2 từ offset iris ra màn hình.

| So với không xử lý (trung vị theo cặp) | Độ rung | Sai số LOO grid | Sai số validation |
|---|---|---|---|
| CLAHE vùng mắt | **+21%** (tệ hơn ở 4/4 session) | +8% | −7% (dao động từ +64% đến −32% giữa các session) |
| Bilateral vùng mắt | −2.6% | −0.3% | +1.6% |
| CLAHE + bilateral | +20% | +10% | −7% |

Ngoài ra đã đo trên 1 session:
- **Khử lóa bằng inpaint:** độ rung −3%, độ chính xác không đổi.
- **Thiếu sáng giả lập** (45% độ sáng cộng nhiễu cảm biến): độ rung tăng 63%.
  - Bilateral bù lại được 14%.
  - CLAHE làm tệ thêm.

**Kết luận:**
- Model iris của MediaPipe đã tự chuẩn hóa vùng ảnh mắt nó cắt ra, nên xử lý ảnh trước đó không giúp ổn định.
- CLAHE tăng tương phản cả nhiễu, làm landmark rung hơn.
- Bilateral có lợi rất nhỏ, không đáng chi phí xử lý thêm mỗi frame trong trình duyệt.
- Với ánh sáng, cách hiệu quả là **đảm bảo đủ sáng lúc đo**. App đã có cảnh báo "Lighting is too low", và đây là chỗ nên siết thêm, thay vì xử lý ảnh.

**Giới hạn:** 4 session chỉ trong môi trường ánh sáng thường. Chưa có session nào thiếu sáng thật hoặc đeo kính bị lóa nặng. Nếu thu được những ca đó, nên chạy lại thí nghiệm.

## Kiểm chứng

- `npx tsx scripts/check-gaze-postprocess.ts`: chạy lại bộ lọc biểu đồ trên toàn bộ dữ liệu Test mode (chỉ đọc), và kiểm tra trên dữ liệu giả lập:
  - bước nhảy dạng saccade vẫn sắc;
  - gai bị loại;
  - điểm ngoài màn hình bị giữ lại;
  - chớp không hoàn toàn bị bỏ;
  - khi mí mắt hẹp kéo dài thì ngưỡng tự thích nghi.
- `npx tsx scripts/check-fixation-sampling.ts`: kiểm tra bộ thu mẫu calibration.
