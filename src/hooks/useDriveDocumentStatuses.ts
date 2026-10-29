import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopBridge } from '../lib/desktopBridge';
import type { DriveDocumentStatus } from '../../shared/driveDocumentStatus';

/** One polling loop for the visible list, in bounded batches. No file hashing,
 * concurrent polls, hidden-window traffic or state retained from another scope. */
export function useDriveDocumentStatuses(nodeIds: string[], scope: string | null) {
  const key = JSON.stringify([scope, [...new Set(nodeIds)].sort()]);
  const [snapshot, setSnapshot] = useState<{ key: string; statuses: Record<string, DriveDocumentStatus>; unavailable: boolean } | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const request = desktopBridge()?.getDriveDocumentStatuses;
    const [activeScope, ids]: [string | null, string[]] = JSON.parse(key);
    if (!activeScope || !request || !ids.length) { refreshRef.current = () => {}; return; }
    let live = true; let running = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!live || running || document.visibilityState === 'hidden') return;
      clearTimeout(timer); running = true;
      try {
        const statuses: Record<string, DriveDocumentStatus> = {};
        for (let offset = 0; offset < ids.length && live; offset += 100) {
          const result = await request(ids.slice(offset, offset + 100));
          for (const item of result) statuses[item.nodeId] = item;
        }
        if (live) setSnapshot({ key, statuses, unavailable: false });
      } catch { if (live) setSnapshot({ key, statuses: {}, unavailable: true }); }
      finally {
        running = false;
        if (live && document.visibilityState !== 'hidden') timer = setTimeout(() => void poll(), 10000);
      }
    };
    const refresh = () => { void poll(); };
    const visibility = () => { clearTimeout(timer); if (document.visibilityState !== 'hidden') refresh(); };
    refreshRef.current = refresh;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', refresh);
    refresh();
    return () => {
      live = false; clearTimeout(timer); refreshRef.current = () => {};
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', refresh);
    };
  }, [key]);
  return {
    statuses: snapshot?.key === key ? snapshot.statuses : {},
    unavailable: snapshot?.key === key ? snapshot.unavailable : false,
    refresh: useCallback(() => refreshRef.current(), []),
  };
}
