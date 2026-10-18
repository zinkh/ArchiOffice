import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/src/lib/api';
import { useConfirmDialog } from '@/src/components/ui/ConfirmDialog';

/** Both chat surfaces keep their history until the server confirms deletion. */
export function useConversationReset(agentId: string | null | undefined, blocked: boolean,
  onCleared: () => void, onError: (message: string) => void) {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirmDialog();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const currentAgent = useRef(agentId);
  currentAgent.current = agentId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const resetConversation = async () => {
    if (!agentId || blocked || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const accepted = await confirm({ title: t('agent_chat_clear_title'),
        message: t('agent_chat_clear_description'), confirmLabel: t('agent_chat_clear'),
        cancelLabel: t('projectdetail_dialog_cancel'), tone: 'danger' });
      if (!accepted || !mounted.current || currentAgent.current !== agentId) return;
      setClearing(true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/conversation`, { method: 'DELETE', signal: controller.signal });
      } finally { clearTimeout(timer); }
      if (mounted.current && currentAgent.current === agentId) onCleared();
    } catch {
      if (mounted.current && currentAgent.current === agentId) onError(t('agent_chat_clear_failed'));
    } finally {
      lock.current = false;
      if (mounted.current) { setBusy(false); setClearing(false); }
    }
  };
  return { resetConversation, resetBusy: busy, clearing, resetDialog: dialog };
}
