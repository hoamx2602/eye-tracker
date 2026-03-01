# Ticket 10 — Calibration: Lưu trữ dữ liệu theo từng sample (tọa độ + head + ảnh)

## Mục tiêu
Lưu mỗi “điểm” calibration là một bản ghi đầy đủ: **tọa độ màn hình**, **thông số head positioning** tại thời điểm thu thập, và **ảnh face** tương ứng, với quan hệ 1:1 (một sample = một ảnh). Dữ liệu này dùng cho re-training, lọc chất lượng, research và debug.

## Bối cảnh hiện tại
- **Grid**: Mỗi điểm lưới → average feature buffer → 1 `TrainingSample` (screenX, screenY, features, timestamp); chụp 1 ảnh face → `calibrationImagesRef`. Lưu session: `calibrationGazeSamples` (mảng phẳng), `calibrationImageUrls` (mảng URL). **Chưa** lưu head positioning; liên kết sample ↔ ảnh chỉ ngầm định theo index (và chỉ đúng cho grid).
- **Exercises**: Thu thập (screenX, screenY, features) mỗi frame, downsample ~30 samples/exercise; **không** chụp ảnh theo từng sample.
- **Ticket 09**: Trang session detail hiển thị metadata, video, và grid ảnh từ `calibrationImageUrls` (không gắn với từng sample).

## Phạm vi triển khai

### 1. Định nghĩa cấu trúc “Calibration sample” (types + API)
- Mỗi phần tử trong `calibrationGazeSamples` có dạng:
  - `screenX`, `screenY` — tọa độ mục tiêu (px hoặc % tùy convention hiện tại).
  - `features` — vector feature (giữ để tương thích).
  - `timestamp` — thời điểm thu thập.
  - `head` — snapshot head positioning tại thời điểm đó (optional để backward compat):
    - `valid`, `message`
    - `faceWidth`, `minFaceWidth`, `maxFaceWidth`, `targetDistanceCm` (từ `HeadValidationResult.debug`).
  - `imageUrl` — URL ảnh face tương ứng (hoặc null nếu không có ảnh cho sample đó).
- Cập nhật type trong `types.ts` (hoặc `services/api.ts`) và schema Prisma: `calibrationGazeSamples` vẫn là `Json`, nhưng JSON structure là mảng các object trên.

### 2. App.tsx — Thu thập và gắn head + ảnh theo từng sample
- **Grid (INITIAL_MAPPING)**:
  - Khi `processCalibBuffer` tạo 1 sample: tại thời điểm đó (hoặc frame đại diện cuối cửa sổ capture) lấy `headValidation` hiện tại → lưu vào sample dưới dạng `head`.
  - Ảnh: giữ cách hiện tại (1 ảnh per point); khi build payload lưu session, gắn URL ảnh tương ứng vào từng sample (sample[i] ↔ calibrationImageUrls[i] cho grid). Chuyển sang format mới: mỗi sample có `imageUrl` riêng (upload từng ảnh, gán URL vào sample tương ứng).
- **Exercises**:
  - Khi downsample và push từng sample vào `trainingSamplesRef`, tại mỗi frame được chọn: (1) chụp ảnh face (`captureCurrentFrameAsBlob`), (2) lấy `headValidation` tại frame đó (cần truyền/ref head validation vào nơi xử lý exercise hoặc lưu snapshot khi collect). Push sample kèm `head` và sau khi upload ảnh thì gán `imageUrl` cho sample đó.
  - Lưu ý: cần có cách lấy `headValidation` trong pipeline xử lý video (ví dụ lưu last head validation ref và dùng tại thời điểm tạo sample, hoặc lưu snapshot head khi push vào exerciseDataRef).
- Kết quả: `trainingSamplesRef` (và payload gửi API) là mảng các object đủ: screenX, screenY, features, timestamp, head, imageUrl (điền sau khi upload).

### 3. Upload và payload session
- Khi save session: với từng sample có ảnh (Blob), upload lên S3 (hoặc storage hiện tại), lấy URL, gán vào `sample.imageUrl`. Payload `calibrationGazeSamples` gửi `POST /api/sessions` là mảng object mới (có `head`, `imageUrl`).
- Có thể **không** gửi thêm `calibrationImageUrls` riêng nữa (vì đã nhúng trong từng sample); hoặc giữ để backward compat với admin đang đọc `calibrationImageUrls`. Ticket có thể chọn: (A) chỉ lưu trong từng sample; (B) vừa lưu trong sample vừa giữ `calibrationImageUrls` cho session cũ/đơn giản. Đề xuất: (B) — build `calibrationImageUrls` từ danh sách `sample.imageUrl` (theo thứ tự) để admin cũ vẫn hoạt động.

### 4. Backward compatibility
- **Đọc (API / admin)**: Session cũ có `calibrationGazeSamples` dạng cũ (chỉ screenX, screenY, features, timestamp) và `calibrationImageUrls` riêng → vẫn hiển thị bình thường (grid ảnh như 09). Session mới có sample với `head` và `imageUrl` → dùng để hiển thị per-sample (xem mục 5).
- **Ghi**: Chỉ session mới (sau khi deploy) dùng format mới.

### 5. Admin session detail (cập nhật sau 09)
- Nếu session có `calibrationGazeSamples` dạng mới (phần tử có `imageUrl` và/hoặc `head`):
  - Hiển thị danh sách/grid “theo sample”: mỗi thẻ/card gồm ảnh (imageUrl), tọa độ (screenX, screenY), và thông tin head (valid, faceWidth, message…) nếu có.
  - Giúp debug và audit: xem đúng ảnh + head tại từng điểm calibration.
- Nếu session cũ (chỉ có calibrationImageUrls, samples không có imageUrl): giữ UI hiện tại (grid ảnh đơn thuần).

## Yêu cầu kỹ thuật
- TypeScript: type rõ ràng cho “calibration sample” (có head, imageUrl optional).
- Không break session cũ: đọc cả hai format; ghi format mới.
- Head snapshot: chỉ lưu dữ liệu cần thiết (valid, message, debug fields); không lưu toàn bộ landmark.

## Acceptance criteria
- [ ] Type/interface cho calibration sample có đủ: screenX, screenY, features?, timestamp?, head?, imageUrl?.
- [ ] Grid: mỗi sample sau khi processCalibBuffer có `head` (từ headValidation tại thời điểm đó) và `imageUrl` (sau khi upload ảnh tương ứng).
- [ ] Exercises: mỗi sample downsample có ảnh face (chụp tại frame được chọn) và head snapshot; upload và gán imageUrl.
- [ ] POST /api/sessions nhận và lưu calibrationGazeSamples dạng mới (JSON); session cũ vẫn đọc được.
- [ ] Admin session detail: với session có format mới, hiển thị per-sample (ảnh + tọa độ + head); session cũ vẫn hiển thị grid ảnh như hiện tại.
- [ ] Không phá chức năng calibration/training hiện tại (regressor vẫn dùng features như cũ).

## Ticket liên quan
- **09** (admin session detail): cần cập nhật để hỗ trợ hiển thị per-sample khi có dữ liệu mới.
- Schema Session: không đổi tên cột, chỉ thay đổi cấu trúc JSON trong `calibrationGazeSamples`.
