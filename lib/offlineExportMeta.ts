const OFFLINE_META_EXPORT_SESSION_KEY = 'eyeTracker.exportMeta';

export function isOfflineMetaExportEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('exportMeta') === '1') {
      window.sessionStorage.setItem(OFFLINE_META_EXPORT_SESSION_KEY, '1');
      return true;
    }
    return window.sessionStorage.getItem(OFFLINE_META_EXPORT_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function withOfflineMetaExportFlag(path: string): string {
  return isOfflineMetaExportEnabled() ? `${path}?exportMeta=1` : path;
}
