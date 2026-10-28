import { useTranslation } from 'react-i18next';
import MailComposeModal from '../MailComposeModal';
import { useMailAccounts } from '../../hooks/useMailAccounts';

interface SendProposalMailProps {
  /** PDF de la proposition, joint d'office. */
  file: File;
  /** Adresse du client, quand elle est connue (modifiable dans la fenêtre). */
  to: string;
  reference: string;
  title: string;
  onSent: () => void;
  onClose: () => void;
}

/** Fenêtre d'envoi de la proposition au client : message prérempli, PDF en pièce jointe. */
export function SendProposalMail({ file, to, reference, title, onSent, onClose }: SendProposalMailProps) {
  const { t } = useTranslation();
  const { accounts, loading } = useMailAccounts();
  if (loading) return null;

  return (
    <MailComposeModal
      accounts={accounts}
      title={t('proposals_send_to_client') as string}
      initial={{
        to,
        subject: t('proposals_send_mail_subject', { reference, title }) as string,
        body: t('proposals_send_mail_body', { reference, title }) as string,
      }}
      initialFiles={[file]}
      onSent={onSent}
      onClose={onClose}
    />
  );
}
