/**
 * Sau mỗi bài neurological: chuyển thẳng tới /neuro/done?verify=1&focus=<testId> để xem kết quả thật,
 * rồi bấm "Tiếp tục" để sang bài kế / post-test.
 *
 * Bật một trong:
 * - NEXT_PUBLIC_NEURO_VERIFY_AFTER_EACH=1 (.env.local)
 * - sessionStorage.setItem('neuro_verify_after_each', '1') (DevTools, cùng origin)
 */

export function neuroVerifyAfterEachEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_NEURO_VERIFY_AFTER_EACH === '1') return true;
  try {
    return sessionStorage.getItem('neuro_verify_after_each') === '1';
  } catch {
    return false;
  }
}

export const NEURO_VERIFY_SNAPSHOT_KEY = 'neuro_verify_snapshot';
export const NEURO_VERIFY_META_KEY = 'neuro_verify_meta';
