import { useTranslation } from 'react-i18next';

// Réponse en un clic quand l'agent pose une question fermée : « Oui » envoie
// la réponse comme si elle avait été tapée, « Non » de même.
export function QuickReplyButtons({ onReply }: { onReply: (text: string) => void }) {
  const { t } = useTranslation();
  const yes = t('agent_chat_quick_yes');
  const no = t('agent_chat_quick_no');
  return (
    <div className="flex gap-2 pl-10">
      <button
        type="button"
        onClick={() => onReply(yes)}
        className="px-4 py-1.5 rounded-lg text-[13px] font-medium"
        style={{ background: 'var(--tblr-primary)', color: 'white' }}
      >
        {yes}
      </button>
      <button
        type="button"
        onClick={() => onReply(no)}
        className="px-4 py-1.5 rounded-lg text-[13px] font-medium border"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-body-color)' }}
      >
        {no}
      </button>
    </div>
  );
}
