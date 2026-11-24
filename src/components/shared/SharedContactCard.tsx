// Coordonnées d'une entreprise pour un confrère : la fiche RÉDUITE envoyée par le serveur (nom, identifiants, coordonnées de
// travail), jamais la fiche complète du cabinet. Les liens `mailto:` et `tel:` ne sont posés que sur des valeurs simples.
import { useTranslation } from 'react-i18next';

export interface SharedContact {
  contact_id: string; nom: string; personne: string | null; fonction: string | null; email: string | null;
  telephones: string[]; adresse: string | null; siret: string | null; tva: string | null;
}

const safeEmail = (v: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
const safePhone = (v: string) => v.replace(/[^\d+]/g, '');

export default function SharedContactCard({ contact }: { contact: SharedContact }) {
  const { t } = useTranslation();
  const who = [contact.personne, contact.fonction].filter(Boolean).join(', ');
  return (
    <div className="rounded-lg px-3 py-2 text-xs space-y-0.5" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
      <p className="font-semibold text-[var(--tblr-text)]">{contact.nom}</p>
      {who && <p className="text-[var(--tblr-muted)]">{who}</p>}
      {contact.email && (
        <p className="text-[var(--tblr-muted)]">
          {safeEmail(contact.email) ? <a href={`mailto:${contact.email}`} className="underline">{contact.email}</a> : contact.email}
        </p>
      )}
      {contact.telephones.length > 0 && (
        <p className="text-[var(--tblr-muted)]">
          {contact.telephones.map((tel, i) => (
            <span key={tel}>{i > 0 && ' · '}{safePhone(tel) ? <a href={`tel:${safePhone(tel)}`} className="underline">{tel}</a> : tel}</span>
          ))}
        </p>
      )}
      {contact.adresse && <p className="text-[var(--tblr-muted)]">{contact.adresse}</p>}
      {(contact.siret || contact.tva) && (
        <p className="text-[var(--tblr-muted)]">
          {[contact.siret && `${t('shared_contact_siret')} ${contact.siret}`, contact.tva && `${t('shared_contact_vat')} ${contact.tva}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
