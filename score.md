# Quy tắc tính điểm và Độ chính xác (Scoring & Accuracy Logic)

Hệ thống tính điểm của Eye Tracker được thiết kế để định lượng hiệu suất thần kinh vận nhãn (neurological eye movement) dựa trên dữ liệu gaze thu thập được. Dưới đây là chi tiết cách tính cho từng loại bài test:

## 1. Nguyên tắc chung (Baseline Scoring)
Hầu hết các bài test sử dụng phân phối xác suất (p10/p90) để chấm điểm từ 0 đến 100:
- **p10 (Poor):** Ngưỡng hiệu suất thấp (thường là 10/100).
- **p90 (Excellent):** Ngưỡng hiệu suất cao (thường đạt 90-100/100).
- Điểm số được nội suy tuyến tính giữa các ngưỡng này.

## 2. Chi tiết từng bài test

### 🟢 Saccadic Eye Movement (Chuyển động liếc nhanh)
- **Thông số chính:** Độ trễ (Latency) - thời gian từ lúc mục tiêu xuất hiện đến khi mắt nhìn vào.
- **Cách tính:** 
  - Hệ thống tính thời gian trung bình (ms) của các lần "fixation" (nhìn cố định) vào mục tiêu.
  - **Vùng nhận diện (AOI):** Mặc định là 80px xung quanh mục tiêu.
  - **Lưu ý:** Nếu gaze không bao giờ rơi vào vùng 80px này trong suốt thời gian hiển thị mục tiêu, hệ thống không thể xác định thời điểm mắt "bắt đầu" liếc tới -> **Điểm = 0**.
  - Độ trễ càng thấp (phản xạ càng nhanh) thì điểm đạt được càng cao.

### 🔴 Anti-Saccade (Phản xạ ngược)
- **Thông số chính:** Sai lệch góc (Angular Error) và Tỷ lệ chính xác hướng (Direction Accuracy).
- **Cách tính:**
  - **Quy trình:** Khi mục tiêu xuất hiện bên trái, bạn phải liếc sang bên phải (đối xứng).
  - **Cách chấm:** Tính số độ lệch (angular error) giữa hướng liếc thực tế và hướng mục tiêu ảo đối diện. Sai lệch càng nhỏ điểm càng cao.
  - **Dự phòng:** Nếu không tính được góc chi tiết, hệ thống dùng tỷ lệ % số lần bạn liếc đúng hướng (sang trái hay sang phải).
  - **Bằng 0 khi nào?** Khi không có bất kỳ mẫu gaze nào rơi vào vùng mục tiêu đối xứng (sang hướng ngược lại) trong thời gian quy định.

### 🔵 Fixation Stability (Độ ổn định nhìn chằm chằm)
- **Thông số chính:** Diện tích ellipse bao phủ 95% điểm gaze (BCEA 95%).
- **Cách tính:**
  - Hệ thống ghi lại toàn bộ các điểm gaze khi bạn nhìn vào một điểm đứng yên.
  - Sau đó tính toán diện tích ellipse chứa 95% các điểm này (đơn vị px²). Diện tích càng nhỏ (mắt càng đứng im) -> Điểm càng cao.
  - **Dự phòng:** Nếu mất BCEA, hệ thống dùng độ phân tán (Dispersion - độ lệch chuẩn trung bình).
  - **Lưu ý đặc biệt:** Nếu diện tích BCEA bằng đúng 0 (xảy ra khi model bị treo, hoặc mắt không động đậy - điều không thể với sinh lý học), hệ thống sẽ coi là dữ liệu lỗi và trả về **0/100**.

### 🟡 Visual Search (Tìm kiếm hình ảnh)
- **Thông số chính:** Hiệu suất (Efficiency).
- **Cách tính:** (Số mục tiêu tìm thấy / Tổng thời gian) so với dữ liệu chuẩn.

### 🟣 Peripheral Vision (Tầm nhìn ngoại vi)
- **Thông số chính:** Tỷ lệ đánh trúng (70%) + Tốc độ phản ứng (30%).
- **Cách tính:** Kế hợp khả năng nhận biết điểm sáng xuất hiện ở vùng biên và thời gian phản ứng bấm nút/nhìn vào đó.

### 🟠 Memory Cards (Trí nhớ hình ảnh)
- **Thông số chính:** Hiệu suất ghi nhớ (Efficiency).
- **Cách tính:** Tốc độ hoàn thành bộ thẻ dựa trên số lượt lật đúng.

---

## 3. Tại sao điểm hiển thị 0/100 dù "có loaded model"?

Dựa trên phân tích kỹ thuật, điểm 0/100 xảy ra khi có dữ liệu nhưng **DỮ LIỆU KHÔNG HỢP LỆ THEO TIÊU CHUẨN ĐO LƯỜNG**:

1. **Lỗi Gaze (0,0):** Nếu gaze model ghi nhận tọa độ (0,0) (góc trên bên trái màn hình) liên tục, diện tích BCEA sẽ là 0, và các bài Saccadic/Anti-Saccade sẽ không bao giờ "hit" được vào mục tiêu (vốn nằm ở vùng giữa/biên).
2. **Sai lệch Calibration quá lớn:** Nếu mắt bạn nhìn vào mục tiêu nhưng gaze model lại chỉ ra vị trí cách đó >100px (ngoài vùng AOI 80px), hệ thống sẽ tính là "Miss" (trượt).
   - *Ví dụ:* Trong bài Saccadic, nếu 100% các lần liếc đều trượt mục tiêu 80px, điểm sẽ là 0.
3. **Mất dấu trong khoảnh khắc liếc (Saccadic Suppression):** Đôi khi camera không bắt kịp chuyển động cực nhanh của mắt, dẫn đến mất dữ liệu đúng lúc cần tính Latency.

**Giải pháp:** 
- Đảm bảo ánh sáng tốt và không có vật cản trước camera.
- Thực hiện lại Calibration cho đến khi đạt độ chính xác cao (<1.0° sai số) trước khi thực hiện các bài test này.
