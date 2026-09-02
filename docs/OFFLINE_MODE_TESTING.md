# Offline Mode Testing Guide

Tài liệu này dùng để test **offline gaze handling**: frontend vẫn dùng realtime
tracking cho UX, nhưng sau calibration + validation sẽ gửi video + metadata sang
backend GPU để xử lý offline và lưu report chính thức vào session.

> Phạm vi hiện tại: offline backend xử lý **calibration + validation video** để
> tạo calibrated gaze trace, validation accuracy, head compensation report và
> biomarkers tổng quát cho đoạn video đó. Nó chưa thay thế toàn bộ metrics của 7
> neurological tests, vì các bài test đó chưa được record kèm trial/event windows
> cho offline reprocessing.

---

## 1. Checklist nhanh

- Docker backend chạy ở `http://localhost:8000`.
- `/health` trả `cuda: true`.
- Frontend `.env.local` bật `NEXT_PUBLIC_OFFLINE_HANDLING=1`.
- Restart `npm run dev` sau khi sửa `.env.local`.
- Chạy assessment từ đầu.
- Sau validation, màn hình phải hiện trạng thái kiểu:
  `Processing gaze offline on http://localhost:8000…`
- Console có log:
  `[offline] sending calibration video + metadata to gaze backend`
  và `[offline] gaze backend report`.
- Session được lưu với `config.offlineGaze.status = "completed"`.
- Với forensic QA, tạo `offline-replay.html` và xem video/gaze đồng bộ.

---

## 2. Chuẩn bị backend Docker

Từ PowerShell:

```powershell
cd D:\eye-tracker\backend
docker compose up -d --build
curl.exe -s http://localhost:8000/health
```

Kỳ vọng:

```json
{"status":"ok","cuda":true,"weights_dir":"/models/openface"}
```

Nếu `cuda` là `false`, offline mode vẫn có thể chạy CPU nhưng rất chậm. Với máy
có NVIDIA GPU, cần kiểm tra driver/NVIDIA Container Toolkit:

```powershell
nvidia-smi
docker info --format "{{.Runtimes}}"
```

Backend code được mount live qua `backend/app:/app/app`, nhưng sau khi sửa
schema/CORS/backend app, nên restart container:

```powershell
cd D:\eye-tracker\backend
docker compose restart
```

Smoke test model:

```powershell
docker compose exec gaze-backend python3 -m app.smoke /data/face-test.jpg
```

Kỳ vọng: log `Face detected` + yaw/pitch + `glare_quality`.

---

## 3. Bật offline handling bằng `.env.local`

Tạo hoặc sửa file:

```text
D:\eye-tracker\.env.local
```

Thêm:

```env
NEXT_PUBLIC_OFFLINE_HANDLING=1
NEXT_PUBLIC_OFFLINE_GAZE_BACKEND_URL=http://localhost:8000
```

Optional để smoke test nhanh hơn:

```env
NEXT_PUBLIC_NEURO_QUICK_MODE=1
```

Sau khi sửa env, **phải restart Next dev server** vì `NEXT_PUBLIC_*` được bundle
vào frontend:

```powershell
cd D:\eye-tracker
npm.cmd run dev
```

Không cần `?exportMeta=1` cho auto offline mode. Query này chỉ dùng khi muốn
download thủ công video + meta để forensic/manual test.

---

## 4. Test auto offline flow trong browser

1. Mở app:

   ```text
   http://localhost:3000/
   ```

2. Mở DevTools Console.

3. Chạy assessment bình thường:

   - consent;
   - demographics;
   - setup/head positioning;
   - calibration;
   - validation.

4. Ngay sau validation, frontend sẽ stop recorder và nếu env bật sẽ gọi backend.
   Màn hình loading phải hiện:

   ```text
   Processing gaze offline on http://localhost:8000…
   ```

5. Console phải có:

   ```text
   [offline] sending calibration video + metadata to gaze backend
   [offline] gaze backend report
   ```

6. Khi backend xong, loading message sẽ đổi thành một trong hai dạng:

   ```text
   Offline processing complete: 1.23° validation error
   ```

   hoặc nếu không có validation report:

   ```text
   Offline processing complete: 42px LOOCV
   ```

7. Session được save như flow cũ, nhưng `config` có thêm:

   ```json
   {
     "offlineGaze": {
       "status": "completed",
       "processedAt": "...",
       "backendUrl": "http://localhost:8000",
       "report": { "...": "..." }
     }
   }
   ```

---

## 5. Kiểm tra report đã lưu

### Cách A: xem trong Admin UI

Vào Admin → Sessions → chọn session vừa tạo → xem config/session payload. Tìm:

```text
config.offlineGaze.report
```

Các field quan trọng:

- `validation.overall_deg`: accuracy thật trên held-out validation dots.
- `validation.overall_deg_raw`: lỗi nếu không bù head compensation.
- `head.motion.lateral_p95_cm`: đầu đã trôi bao nhiêu trong phiên.
- `calibration.loocv_px` hoặc `calibration_loocv_px`: lỗi cross-validation của mapping.
- `biomarkers.valid_ratio`: tỷ lệ frame gaze hợp lệ sau quality gate.

### Cách B: xem trong Console

Console log `[offline] gaze backend report` chứa toàn bộ object report. Mở object
đó và đọc các field trên.

---

## 6. Manual export + forensic replay viewer

Dùng đường này khi muốn tự kiểm tra trực quan backend có xử lý video đúng không.

### 6.1 Capture video + metadata thủ công

Mở app với:

```text
http://localhost:3000/?exportMeta=1
```

Sau calibration + validation, browser sẽ download:

```text
session-<timestamp>.webm
session-<timestamp>.meta.json
```

Copy vào:

```text
D:\eye-tracker\backend\data\
```

### 6.2 Reprocess có debug trace

```powershell
cd D:\eye-tracker\backend

docker compose exec gaze-backend python3 -m app.reprocess `
  --video /data/session-xxx.webm `
  --meta /data/session-xxx.meta.json `
  --out /data/report.json `
  --include-trace
```

### 6.3 Generate replay HTML

```powershell
docker compose exec gaze-backend python3 -m app.replay `
  --video /data/session-xxx.webm `
  --meta /data/session-xxx.meta.json `
  --report /data/report.json `
  --out /data/offline-replay.html
```

Mở:

```text
D:\eye-tracker\backend\data\offline-replay.html
```

Replay viewer hiển thị:

- bên trái: webcam video gốc;
- bên phải: màn hình mô phỏng gaze backend theo timestamp;
- active calibration/validation dot;
- gaze trail;
- missing/glare-gated frames;
- yaw/pitch;
- quality;
- head proxy;
- bảng validation target/pred/error.

---

## 7. Cách đọc replay viewer

### Dấu hiệu tốt

- Khi active target/dot xuất hiện, người trong video thật sự nhìn vào dot đó.
- Sau phase settle, gaze dot nằm gần target.
- Gaze trail mượt tương đối, không nhảy loạn khi mắt đứng yên.
- Frame glare/missing bị đánh dấu missing/gated thay vì sinh fake saccade.
- `validation error` nhỏ hơn hoặc xấp xỉ `raw no-comp`.
- `head motion p95` có ý nghĩa nếu người có trôi đầu; nếu p95 lớn và bù đầu
  làm error giảm, compensation đang có ích.

### Dấu hiệu lỗi cần điều tra

- Gaze bị mirror trái/phải hoặc trên/dưới: sai convention yaw/pitch hoặc mapping.
- Gaze luôn lệch cùng một hướng: calibration window sai, screen geometry sai,
  hoặc người không nhìn dot lúc capture.
- Gaze tốt ở center nhưng tệ ở corner: calibration grid chưa đủ/độ cong mapping
  chưa fit tốt/đầu di chuyển nhiều.
- `raw no-comp` tốt hơn `validation error`: head compensation overcorrect hoặc
  camera FOV/gain sai; thử giảm `head_comp_gain`.
- Quality thấp liên tục: ánh sáng/kính/reflection làm model thiếu dữ liệu sạch.

---

## 8. Tiêu chí pass/fail gợi ý

Với webcam thường, không kỳ vọng eye tracker chuyên dụng. Mục tiêu test ban đầu:

| Metric | Pass ban đầu | Cần xem lại |
|---|---:|---:|
| `validation.overall_deg` | `< 2–3°` | `> 4–5°` |
| `validation.overall_px` | tùy màn hình, thường `< 150px` | `> 250–300px` |
| `calibration.loocv_px` | `< 100–150px` | `> 250px` |
| `biomarkers.valid_ratio` | `> 0.7` | `< 0.5` |
| `head.motion.lateral_p95_cm` | không phải pass/fail | dùng để giải thích error |

Nếu `NEXT_PUBLIC_NEURO_QUICK_MODE=1`, accuracy chỉ dùng smoke test kỹ thuật,
không dùng kết luận lâm sàng.

---

## 9. A/B tests nên chạy

### 9.1 Ngồi yên

Chạy một phiên bình thường, cố giữ đầu ổn định. Đây là baseline.

Kỳ vọng:

- validation error thấp nhất;
- head motion thấp;
- compensation không làm tệ đi.

### 9.2 Cố tình dịch đầu sau calibration

Sau calibration, trong validation cố dịch đầu ngang khoảng 3–5 cm.

Kỳ vọng:

- `overall_deg_raw` tăng rõ;
- `overall_deg` sau compensation thấp hơn raw;
- replay thấy gaze sau bù gần target hơn.

Nếu ngược lại, thử chỉnh trong meta:

```json
{
  "head_comp_gain": 0.5
}
```

rồi chạy lại manual `app.reprocess`.

### 9.3 Có kính / không kính

Chạy hai session cùng điều kiện ánh sáng.

So sánh:

- `validation.overall_deg`;
- `validation.by_quality`;
- `biomarkers.valid_ratio`;
- replay quality/missing frames.

---

## 10. Troubleshooting

### Không thấy offline loading

Kiểm tra:

```powershell
Get-Content D:\eye-tracker\.env.local
```

Phải có:

```env
NEXT_PUBLIC_OFFLINE_HANDLING=1
```

Sau đó restart:

```powershell
cd D:\eye-tracker
npm.cmd run dev
```

### Browser báo CORS / Failed to fetch

Restart backend:

```powershell
cd D:\eye-tracker\backend
docker compose restart
curl.exe -s http://localhost:8000/health
```

Nếu frontend không chạy ở `localhost:3000`, set CORS origins cho backend compose:

```yaml
environment:
  OPENFACE_WEIGHTS: /models/openface
  OFFLINE_BACKEND_CORS_ORIGINS: http://localhost:3000,http://127.0.0.1:3000
```

### Backend chậm

Offline inference chạy model deep learning nên mất thời gian. Có thể theo dõi:

```powershell
cd D:\eye-tracker\backend
docker compose logs -f gaze-backend
```

Nếu VRAM thiếu:

```yaml
environment:
  OPENFACE_WEIGHTS: /models/openface
  GAZE_BATCH_SIZE: "8"
```

### `report.json has no debug_trace`

Bạn quên `--include-trace`. Chạy lại:

```powershell
docker compose exec gaze-backend python3 -m app.reprocess `
  --video /data/session-xxx.webm `
  --meta /data/session-xxx.meta.json `
  --out /data/report.json `
  --include-trace
```

### `Only N usable calibration dots`

Nguyên nhân thường gặp:

- video không cover đúng calibration phase;
- metadata không đúng video;
- user không nhìn dot;
- face không detected nhiều frame;
- quá tối/glare quá nặng.

Xem lại bằng `offline-replay.html` để biết mismatch nằm ở timing, detection hay
người dùng không fixate.

---

## 11. Ghi chú về kết quả “đúng”

Không có một replay nào tự chứng minh model “đúng tuyệt đối”. Cần kết hợp:

1. validation dots held-out để có số accuracy khách quan;
2. replay viewer để kiểm tra frame/timing/gaze có hợp lý không;
3. A/B head movement để chứng minh compensation có giúp;
4. glasses/no-glasses test để định lượng ảnh hưởng của kính;
5. nhiều subject/session để biết lỗi ổn định hay chỉ may mắn một phiên.

Nếu một session có số đẹp nhưng replay cho thấy người không nhìn đúng dot, session
đó không đáng tin. Nếu replay hợp lý nhưng số xấu ở corner, đó là lỗi mapping/vùng
màn hình cần tối ưu tiếp.
