# Calibration sampling: gaze-contingent collection

Mỗi điểm calibration được lấy mẫu theo cách nào: chọn frame nào, loại nhiễu ra sao, khi nào thu lại. Tài liệu này mô tả quy trình mới. Giao diện calibration giữ nguyên, chỉ logic thay đổi. Quy trình tham chiếu [Tobii Pro calibration](https://developer.tobiipro.com/commonconcepts/calibration.html): chỉ thu khi mắt đã nhìn vào điểm, xem chất lượng từng điểm, và thu lại điểm xấu.

Code: `lib/fixationSampling.ts` (thuần, không React). App nối vào trong `App.tsx`. Backend offline đọc cờ `settled_windows`.

## Vì sao đổi

Trước đây mỗi điểm dùng cửa sổ cố định theo đồng hồ: chờ 800 ms, rồi lấy **trung bình** mọi frame trong 1200 ms kế tiếp. Cửa sổ này không biết mắt đã tới điểm chưa:

| Giai đoạn sau khi điểm xuất hiện | Thời gian (người khoẻ) |
|---|---|
| Độ trễ saccade | 150–250 ms (dài hơn sau chấn động não) |
| Saccade | ≈ 21 + 2.2·A ms |
| Saccade lớn hụt ~10% → saccade sửa | +100–150 ms |
| Fixation ổn định | từ ~400–600 ms |
| Lệch dần / đoán trước điểm kế | sau ~1–1.5 s |

Các lỗi đã tìm thấy và đã sửa:

- **Lọc outlier ở chế độ TIMER không có tác dụng.** Buffer đã lọc chỉ dùng để đếm frame. Mẫu lại được tính từ buffer thô chưa lọc. Nếu bộ lọc có chạy thì cũng chỉ sắp xếp theo đúng một feature là `lx`.
- **Mẫu grid giả khi chuyển sang phase EXERCISES.** Effect timer vẫn chạy trong phase này và ghi thêm một mẫu, gắn nhãn là điểm grid cuối cùng, trong lúc người tham gia đang nhìn chấm đếm ngược ở giữa màn hình. DB có 9/61 session bị ảnh hưởng.
- **Máy yếu bỏ 1/2 đến 2/3 số frame khi đang thu điểm tĩnh.** Việc bỏ frame chỉ có lý khi chấm đang di chuyển.
- **Không đệm quanh chớp mắt.** Không có bước kiểm tra từng điểm, và điểm thiếu dữ liệu được thử lại vô hạn.
- **Exercises gán nhãn bằng vị trí target *hiện tại*,** trong khi frame đã trễ (camera, inference, pursuit). Mỗi mẫu là trung bình của ~1.4 s quỹ đạo.
- **Validation chỉ có 5 điểm trong vùng 25–75%,** và không đo precision.

## Quy trình mới cho mỗi điểm (TIMER)

1. Điểm xuất hiện, `FixationCollector` bắt đầu nhận frame.
2. **Không dùng frame nào trong 300 ms đầu.** Khoảng này là độ trễ saccade cộng với chính saccade.
3. **Tìm run ổn định mới nhất** trong không gian feature: offset mống mắt trung bình hai mắt, cộng yaw/pitch của đầu lấy từ ma trận biến đổi.
   - Run dừng lại khi quá 20% số frame nằm ngoài bán kính quanh median của run. Vì vậy saccade cắt được run, còn một đốm lóa đơn lẻ thì không.
   - Bán kính = max(sàn, 3.5·σ). σ là nhiễu fixation *của chính người tham gia*, học dần từ các điểm đã nhận. Ở vài điểm đầu, σ được ước lượng từ chênh lệch giữa hai frame liên tiếp.
4. **Chớp mắt:**
   - bỏ frame trong khoảng 100 ms trước và 150 ms sau mỗi frame chớp;
   - coi là chớp không hoàn toàn khi EAR < 0.65 × median EAR của chính điểm đó. Ngưỡng tương đối nên không phụ thuộc hướng nhìn: mí trên tự hạ khi nhìn xuống.
5. **Hoàn tất khi run ≥ 700 ms và có ≥ 8 frame sạch.** Lúc run bắt đầu, chấm chuyển sang trạng thái "capturing" có sẵn trên UI.
6. **Timeout sau 3 s:** lấy run tốt nhất đã thấy và gắn cờ `fixation_fallback`.
7. **Tâm điểm:**
   - bỏ một "cao nguyên" ngắn ở đầu run: trung bình k frame đầu lệch khỏi phần còn lại hơn 3.5·σ/√k, với k = 1–4;
   - loại frame ngoài 3·MAD trên từng trục;
   - lấy **median** từng trường.
8. **Điểm không có run ổn định** được hiện lại ở cuối hàng đợi, tối đa 3 lần. Sau đó lần tốt nhất được giữ. Không bao giờ chặn người tham gia.
9. **Sau grid: review residual** (Tobii bước 8–9).
   - Dùng mô hình nhỏ từ offset mống mắt ra màn hình: affine khi dưới 12 điểm, bậc 2 khi từ 12 điểm trở lên.
   - Tính lỗi leave-one-out. Điểm tệ nhất được so với residual của các điểm còn lại *sau khi đã bỏ nó ra*, để một điểm xấu không che mất chính nó.
   - Điểm vượt max(median + 3σ, 2×median) được thu lại một lần, tối đa 1/4 số điểm.
10. **Thứ tự điểm ngẫu nhiên,** cả grid lẫn validation.

FAST và SLOW nhân thời gian thu và timeout với 0.5 và 1.5. Ngưỡng 300 ms giữ nguyên. Click & Hold dùng cùng bộ thu: độ dài giữ chuột là timeout, run cần ≥ min(700 ms, nửa thời gian giữ).

Cài đặt "Data Hygiene" vẫn có tác dụng:
- `NONE` tắt lọc MAD;
- `STD_DEV` dùng ngưỡng làm k;
- `TRIM_TAILS` dùng k = 3.

## Exercises

- **Các đoạn dừng ≥ 600 ms** (điểm đầu mút của horizontal, vertical, diagonal, H) được lấy mẫu như điểm grid. Đây là những điểm tĩnh sẵn có ở cạnh và góc.
- **Đoạn chuyển động:**
  - ước lượng độ trễ τ bằng cross-correlation giữa offset mống mắt và vị trí target;
  - gán nhãn frame bằng vị trí target tại thời điểm t − τ;
  - bỏ max(250 ms, τ + 100 ms) đầu mỗi lần chuyển động, vì đó là lúc pursuit khởi động và có saccade đuổi theo;
  - bỏ các frame nhảy;
  - gom bin ~200 ms, tối đa 8 mẫu mỗi bài.
- **`forward_backward` vẫn hiển thị nhưng không dùng để train.** Phóng to/thu nhỏ chấm trên màn hình phẳng không đổi hội tụ hay điều tiết của mắt, chỉ sinh thêm mẫu trùng ở trung tâm.

## Validation

- 9 điểm: 4 góc, 4 điểm giữa cạnh và tâm, trong vùng 12–88%. Thứ tự ngẫu nhiên.
- Mỗi điểm lưu thêm **precision** (RMS sample-to-sample và SD của các frame sau khi map, đơn vị px) trong `quality`.
- Vẫn chỉ báo cáo, không chặn người tham gia.

## Dữ liệu lưu

Mỗi mẫu trong `calibrationGazeSamples` có thêm trường `quality`, gồm:
- `method`, `nFrames`, `spanMs`;
- `settleMs`: thời gian từ lúc điểm xuất hiện tới frame đầu tiên được dùng, xấp xỉ độ trễ tới fixation ổn định;
- `dispersion`, `attempts`;
- `lagMs` (mẫu pursuit); `precisionRmsS2SPx`, `precisionSdPx` (mẫu validation).

`meta.json` offline chứa cửa sổ đúng của run được chọn, kèm `settled_windows: true`. Khi có cờ này, backend chỉ bỏ 10% đầu cửa sổ thay vì 40%.

## Kiểm chứng

- `npx tsx scripts/check-fixation-sampling.ts`: kịch bản tổng hợp gồm saccade hụt rồi saccade sửa, nhiễu, đốm lóa, chớp mắt có mí hạ trước, fixation không ổn định, quay đầu giữa cửa sổ, một điểm grid bị hỏng, và pursuit trễ 110 ms.
  - Sai số tâm điểm: 0.0071 (mới) so với 0.0486 (cửa sổ cố định cũ).
  - Độ trễ pursuit ước lượng: 110 ms.
- `npx tsx scripts/check-residual-review.ts`: chạy lại review residual trên grid đã lưu trong DB, chỉ đọc.
  - Trên 73 session thu theo cách cũ, trung bình 1.27 điểm mỗi session sẽ bị thu lại, khoảng 2 s.
  - Tỉ lệ gắn cờ theo loại điểm: góc 19.6%, điểm đầu hàng (ngay sau cú nhảy hết chiều ngang) 6.9%, cạnh và bên trong 4.1%.
- `backend/tests/test_settled_windows.py`.

Chưa kiểm chứng trên người thật. Các ngưỡng (sàn bán kính 0.02, k = 3.5, 700 ms, 3 s) suy ra từ sinh lý học và dữ liệu tổng hợp. Cần xem `quality.settleMs`, `quality.method` và precision của các session mới để chỉnh lại.
