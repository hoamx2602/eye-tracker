/**
 * Cập nhật đồng bộ trong `predictGaze` (App.tsx) mỗi khi regressor trả về điểm nhìn.
 * Các bài neurological lấy mẫu trong setInterval/rAF phải đọc ref này thay vì `useNeuroGaze` +
 * `gazeRef`, vì state React có thể chưa commit giữa các frame — dễ ghi nhầm cùng một (x,y) nhiều lần.
 */
export const neuroLiveGazeRef = { current: { x: 0, y: 0 } };
