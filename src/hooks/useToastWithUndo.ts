import { useRef, useState } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastState {
  message: string;
  type: 'success' | 'error';
  action?: ToastAction;
}

/**
 * Toast with an optional action button (e.g. "Undo") and a configurable
 * auto-dismiss delay. A new toast always clears any pending auto-dismiss
 * timer from the previous one, so a slow first toast can't wipe out a toast
 * shown right after it.
 */
export function useToastWithUndo() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (
    message: string,
    type: ToastState['type'] = 'success',
    opts?: { duration?: number; action?: ToastAction }
  ) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, type, action: opts?.action });
    timeoutRef.current = setTimeout(() => setToast(null), opts?.duration ?? 3500);
  };

  const clearToast = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast(null);
  };

  return { toast, showToast, clearToast };
}
