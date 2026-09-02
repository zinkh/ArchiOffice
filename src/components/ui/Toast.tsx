import { motion, AnimatePresence } from 'motion/react';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { ToastState } from '../../hooks/useToastWithUndo';

export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className="fixed top-4 right-4 z-[200] px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
          style={{
            background: toast.type === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-success)',
            color: '#fff'
          }}
        >
          {toast.type === 'error' ? <IconAlertTriangle size={16} /> : null}
          {toast.message}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="ml-1 underline underline-offset-2 font-semibold shrink-0"
            >
              {toast.action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
