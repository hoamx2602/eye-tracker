# Eye Tracker Frontend Rules

Các quy tắc này áp dụng cho toàn bộ phần frontend (Next.js / React / TypeScript / Tailwind) của dự án eye tracker.  
Mục tiêu: **UI không đổi**, **hành vi/feature không đổi**, nhưng **code nhỏ gọn, dễ đọc, dễ mở rộng**.

---

## 1. Phân tầng kiến trúc

- **Page = orchestration**
  - **Page** (`app/.../page.tsx`) chỉ:
    - Gọi API / Prisma / server action cần thiết.
    - Chuẩn hóa dữ liệu và **truyền xuống component feature** qua props.
  - Không chứa:
    - JSX quá dài, nhiều section UI lặp lại.
    - Logic domain phức tạp (training, calibration, recording, analytics...).

- **Feature component**
  - Với mỗi luồng chính, tạo thư mục feature riêng (có thể dần dần refactor về cấu trúc này):
    - `features/calibration/*` (Head Positioning, grid, exercises, validation).
    - `features/tracking/*` (Tracking screen, toolbar, stop-save flow, overlays).
    - `features/admin/*` (dashboard, sessions list, session detail, sample detail, tests).
  - Mọi logic UI phức tạp thuộc **feature** thay vì để trong page.

- **Shared component / UI kit**
  - Những phần tử dùng nhiều nơi phải lên:
    - `components/layout/*` (shell, header, sidebar, breadcrumb...).
    - `components/ui/*` (Button, IconButton, Card, Modal, Table primitives, Tooltip...).
    - `components/admin/*` (icon admin, dialog chung, bảng chung...).
    - `components/tracking/*` (CalibrationLayer, HeatmapLayer, GazeCursor...).

- **Hooks & services**
  - **Logic thuần (không JSX)**:
    - `services/*` (eyeTrackingService, mathUtils, api client).
    - `hooks/*` hoặc `features/*/hooks/*` cho logic trạng thái phức tạp (useCalibrationEngine, useRecordingManager...).
  - **Không** để hàm xử lý phức tạp inline trong component khi có thể tách ra.

---

## 2. Quy tắc chia nhỏ component

- **Giới hạn kích thước**
  - Component React:
    - Ưu tiên **< 250 dòng**.
    - Nếu > 350 dòng phải **xem xét tách**:
      - Tách UI section lặp lại thành component con.
      - Tách logic state phức tạp thành custom hook.
  - Page:
    - Code React trong `app/.../page.tsx` nên chủ yếu là composition (gọi 1–3 component chính).

- **Tách theo trách nhiệm (Single Responsibility)**
  - Một component chỉ **làm một việc rõ ràng**:
    - Ví dụ:
      - `TrackingToolbar`: chỉ xử lý toolbar tracking (nút mode, heatmap, stop & save).
      - `HeadPositioningScreen`: chỉ hiển thị màn hình head positioning + debug message.
      - `DeleteConfirmDialog`: chỉ hiển thị dialog confirm xoá.
  - Nếu component vừa:
    - Quản lý lifecycle camera.
    - Điều khiển calibration.
    - Điều khiển recording.
    - Render nhiều layout khác nhau.
    - → phải tách.

- **Presentational vs container**
  - **Presentational component**:
    - Nhận props đơn giản, không gọi API, không side-effect.
    - Không dùng `useEffect` (trừ animation/UI-only).
  - **Container / logic component**:
    - Gọi API, useEffect, quản lý state phức tạp.
    - Không render nhiều HTML chi tiết, mà dùng các presentational component.

---

## 3. Tổ chức file & naming

- **Đường dẫn & prefix**
  - Component dùng chung cho nhiều phần:
    - `components/...`
  - Component riêng admin:
    - `components/admin/...`
  - Component riêng tracking:
    - `components/tracking/...`
  - Hooks:
    - `hooks/useSomething.ts` hoặc `features/<feature>/hooks/useSomething.ts`.
  - Service:
    - `services/<domain>Service.ts`, `services/api.ts`, `services/mathUtils.ts`.

- **Naming**
  - Component React: `PascalCase` (`TrackingToolbar`, `HeadPositioningScreen`, `SessionAnalytics`).
  - Hook: `useXxx` (`useCalibrationEngine`, `useRecordingManager`).
  - Props: tên rõ nghĩa (`onConfirm`, `onCancel`, `showHeatmap`, `trackingMode`...).
  - Không dùng từ viết tắt mơ hồ (vd. `cfg`, `res`, `dt`) cho biến dài hạn trừ context rõ ràng.

- **Import đường dẫn**
  - Trong cùng root: dùng alias nếu đã cấu hình (`@/components/...`, `@/services/...`).
  - Trong cùng thư mục: `./ComponentName`.

---

## 4. Reuse & tránh duplication

- **Icons**
  - Icon SVG dùng nhiều nơi phải đặt ở:
    - `components/admin/AdminIcons.tsx` (cho admin).
    - Hoặc `components/icons/*` nếu dùng cross-app.
  - Không khai báo lại cùng một icon (Eye, Trash...) trong nhiều file.

- **Dialog / Modal**
  - Hộp thoại confirm, modal overlay:
    - Sử dụng `Modal` / `DeleteConfirmDialog` từ `components/ui` hoặc `components/admin`.
    - Không copy-paste overlay (backdrop + card + 2 nút) từ file này sang file khác.

- **Bảng & list**
  - Các bảng admin có cấu trúc tương tự (header, body, footer load-more, trạng thái loading/empty):
    - Tách phần:
      - Header cells config (labels + width).
      - Row rendering theo type (`SessionRow`, `TestSessionRow`...).
    - Dùng cùng một component bảng base nếu có thể.

- **Analytics / charts**
  - Tooltip, card, stat box dùng trong nhiều chart:
    - Đặt ở `components/analytics/*`.
  - Mỗi chart phức tạp nên là component riêng, `AdminDashboardCharts`/`SessionAnalytics` chỉ đóng vai trò composition.

---

## 5. Luồng tracking & calibration

- **Không thay đổi UI và behaviour**
  - Khi refactor luồng calibration / tracking:
    - Không đổi text, không đổi vị trí chính của nút/toolbar.
    - Không đổi điều kiện chuyển state (ví dụ: điều kiện HEAD_POSITIONING hoàn thành, cách tính validation error).
  - Mọi thay đổi chỉ được:
    - Tách sang component con.
    - Chuyển logic thuần sang hook/service.

- **Quy tắc phân tách trong `App`**
  - `App` nên chỉ:
    - Giữ state chính của state machine (IDLE → HEAD_POSITIONING → CALIBRATION → TRACKING).
    - Kết nối `eyeTrackingService`, `HybridRegressor`, `GazeSmoother`.
    - Gắn các component:
      - `HeadPositioningScreen`.
      - `CalibrationLayer` / `EyeMovementLayer`.
      - `TrackingToolbar`, `HeatmapLayer`, `GazeCursor`, overlays.
      - `DiagnosticsPanel`, modals.
  - Tất cả phần UI cụ thể (layout vùng head positioning, toolbar, dialog...) phải là component riêng.

---

## 6. UX & UI consistency

- **Class Tailwind**
  - Khi tạo component chia sẻ:
    - Giữ nguyên class Tailwind hiện tại để UI không đổi.
    - Chỉ gom lại vào component để tránh lặp.

- **Accessibility**
  - Nút/toggle:
    - Dùng `role`, `aria-checked`, `aria-modal`, `aria-labelledby` như hiện trạng (hoặc tốt hơn, nhưng không được tệ đi).
  - Link điều hướng:
    - Dùng `next/link` cho navigation nội bộ.

---

## 7. Quy tắc khi thêm tính năng mới

- **Không làm `god component` mới**
  - Mỗi lần thêm feature:
    - Tìm đúng **feature folder** (calibration/tracking/admin/...).
    - Nếu file > ~250 dòng, chủ động chia nhỏ ngay từ đầu.

- **Tuân thủ flow hiện tại**
  - Không được:
    - Bỏ qua consent/demographics trước calibration.
    - Bỏ qua head positioning trước calibration.
    - Thay đổi cách lưu session, validation, hoặc cách gọi API mà không cập nhật tài liệu.

- **Document**
  - Nếu thêm rule mới hoặc pattern mới:
    - Cập nhật thêm vào `Rules.MD` (mục phù hợp) với mô tả ngắn, rõ ràng.

---

## 8. Nguyên tắc refactor an toàn

- **Refactor nhỏ, có bước**
  - Bước 1: Tách UI sang component con, **giữ nguyên props và logic**.
  - Bước 2: Tách logic reuse sang hook/service khi đã ổn định.
  - Bước 3: Nếu cần đổi cấu trúc folder, thực hiện sau khi test behaviour đã ổn.

- **Không đổi public API**
  - Khi tách component/hook, props mới phải:
    - Được ánh xạ 1–1 với state/handler hiện tại.
    - Không thay đổi meaning (ví dụ: `onStopSave` vẫn phải dừng recording + reset + mở download như cũ).

