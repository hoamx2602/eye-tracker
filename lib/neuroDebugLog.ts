/**
 * Log luồng neurological (lưu/tải kết quả, run id).
 * - `next dev`: bật mặc định (filter console: [Neuro])
 * - Tắt trong dev: NEXT_PUBLIC_NEURO_DEBUG=0
 * - Production: chỉ khi NEXT_PUBLIC_NEURO_DEBUG=1
 */
export function neuroDebugEnabled(): boolean {
  if (typeof process === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_NEURO_DEBUG === '0') return false;
  if (process.env.NEXT_PUBLIC_NEURO_DEBUG === '1') return true;
  return process.env.NODE_ENV === 'development';
}

export function neuroDebugLog(...args: unknown[]): void {
  if (!neuroDebugEnabled()) return;
  // eslint-disable-next-line no-console -- intentional debug channel
  console.log('[Neuro]', ...args);
}

/**
 * Luôn ghi (mọi môi trường): lỗi / cảnh báo thật sự — không phụ thuộc NEURO_DEBUG.
 * Dùng khi PATCH/GET thất bại hoặc thiếu run id lúc lưu.
 */
export function neuroPersistWarn(message: string, detail?: unknown): void {
  if (detail !== undefined) {
    // eslint-disable-next-line no-console -- persistent diagnostics
    console.warn('[Neuro]', message, detail);
  } else {
    // eslint-disable-next-line no-console -- persistent diagnostics
    console.warn('[Neuro]', message);
  }
}
