// Lien de dépôt d'une entreprise consultée : création, copie, envoi par e-mail,
// révocation. Le jeton clair n'existe qu'au moment de la création (la base n'en
// garde que le haché) : « renvoyer le lien » en crée donc un nouveau et révoque
// l'ancien, ce que l'écran dit AVANT de le faire.
import { useCallback, useEffect, useState } from 'react';
import { IconCheck, IconCopy, IconLink, IconLoader2, IconSend, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import MailComposeModal from '../MailComposeModal';
import { formaterDateHeure } from '../../lib/depotAffichage';

export interface EntrepriseAInviter {
  id: string;
  nom: string;
  email?: string;
  contact_id?: string;
  lots_ids: string[];
}

interface LienExistant {
  id: string; entreprise_id: string; expires_at: string; revoked_at: string | null; last_opened_at: string | null; created_at: string;
}

interface Props {
  projectId: string;
  projectName: string;
  entreprise: EntrepriseAInviter;
  lots: Array<{ id: string; lot_number: string; lot_title: string }>;
  deadlineAt: string | null;
  onOpenSettings: () => void;
  onClose: () => void;
}

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';

export default function InviterDepotDialog({ projectId, projectName, entreprise, lots, deadlineAt, onOpenSettings, onClose }: Props) {
  const [existant, setExistant] = useState<LienExistant | null | undefined>(undefined);
  const [lien, setLien] = useState<{ url: string; expires_at: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [mail, setMail] = useState(false);
  const { accounts, loading: comptesEnChargement } = useMailAccounts();
  useEscapeKey(!mail, onClose);

  const charger = useCallback(async () => {
    try {
      const liste = await apiFetch<LienExistant[]>(`/api/projects/${projectId}/depot/invites`);
      const maintenant = Date.now();
      setExistant(liste.find(l => l.entreprise_id === entreprise.id && !l.revoked_at && new Date(l.expires_at).getTime() > maintenant) ?? null);
    } catch {
      setExistant(null);
    }
  }, [projectId, entreprise.id]);
  useEffect(() => { void charger(); }, [charger]);

  const creer = async () => {
    setEnCours(true); setErreur(null);
    try {
      const r = await apiFetch<{ url: string; expires_at: string }>(`/api/projects/${projectId}/depot/invites`, {
        method: 'POST',
        body: JSON.stringify({
          entreprise_id: entreprise.id, entreprise_nom: entreprise.nom, email: entreprise.email || undefined,
          contact_id: entreprise.contact_id || undefined, lots_ids: entreprise.lots_ids,
        }),
      });
      setLien({ url: r.url, expires_at: r.expires_at });
      await charger();
    } catch (e: any) {
      setErreur(e?.message || 'Le lien n’a pas pu être créé.');
    } finally { setEnCours(false); }
  };

  const revoquer = async () => {
    if (!existant) return;
    setEnCours(true); setErreur(null);
    try {
      await apiFetch(`/api/projects/${projectId}/depot/invites/${existant.id}`, { method: 'DELETE' });
      setLien(null);
      await charger();
    } catch (e: any) {
      setErreur(e?.message || 'Le lien n’a pas pu être révoqué.');
    } finally { setEnCours(false); }
  };

  const copier = async () => {
    if (!lien) return;
    try { await navigator.clipboard.writeText(lien.url); setCopie(true); setTimeout(() => setCopie(false), 2000); }
    catch { setErreur('Copie impossible : sélectionnez le lien et copiez-le à la main.'); }
  };

  const lotsEntreprise = lots.filter(l => entreprise.lots_ids.includes(l.id));
  const corps = lien ? [
    'Bonjour,',
    '',
    `Dans le cadre de la consultation des entreprises pour l'opération « ${projectName} », vous pouvez remettre votre offre en ligne sur votre espace de dépôt personnel :`,
    lien.url,
    '',
    ...(lotsEntreprise.length ? ['Lots concernés :', ...lotsEntreprise.map(l => `- Lot ${l.lot_number} : ${l.lot_title}`), ''] : []),
    deadlineAt ? `Date limite de remise : ${formaterDateHeure(deadlineAt)}.` : '',
    'Vous pouvez y saisir votre offre ou y déposer vos documents (PDF, Word, Excel, ODS, ODT). Un accusé de réception vous est envoyé à chaque dépôt.',
    '',
    'Ce lien vous est personnel : merci de ne pas le transmettre.',
    '',
    'Cordialement,',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') : '';

  if (mail && lien && !comptesEnChargement) {
    return (
      <MailComposeModal
        accounts={accounts}
        initial={{ to: entreprise.email || '', subject: `Remise de votre offre : ${projectName}`, body: corps }}
        onSent={() => setMail(false)}
        onClose={() => setMail(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={`Lien de dépôt de ${entreprise.nom}`}
        className="rounded-xl shadow-xl w-full max-w-lg max-h-[88dvh] overflow-y-auto"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div>
            <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}><IconLink size={16} /> Espace de dépôt de {entreprise.nom || 'l’entreprise'}</h3>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
              Un lien personnel, sans compte à créer. L’entreprise y saisit son offre ou y dépose ses documents ; rien n’est intégré à vos offres sans votre validation.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="p-4 space-y-4 text-sm" style={{ color: 'var(--tblr-text)' }}>
          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
            {deadlineAt
              ? <>Date limite de remise : <strong>{formaterDateHeure(deadlineAt)}</strong>. Une remise plus tardive est acceptée mais signalée « hors délai ».</>
              : <>Aucune date limite n’est fixée : toute remise sera acceptée sans signalement.</>}
            {' '}
            <button type="button" className="underline" onClick={onOpenSettings}>Régler le dépôt</button>
          </p>

          {existant === undefined && <p className="flex items-center gap-2 text-xs"><IconLoader2 size={14} className="animate-spin" /> Lecture des liens…</p>}

          {existant && !lien && (
            <div className="rounded-lg border border-[var(--tblr-border)] p-3 text-xs space-y-1">
              <p className="font-bold">Un lien est déjà actif pour cette entreprise.</p>
              <p style={{ color: 'var(--tblr-muted)' }}>
                Créé le {formaterDateHeure(existant.created_at)} · {existant.last_opened_at ? `ouvert pour la dernière fois le ${formaterDateHeure(existant.last_opened_at)}` : 'jamais ouvert'} · valable jusqu’au {formaterDateHeure(existant.expires_at)}.
              </p>
              <p style={{ color: 'var(--tblr-muted)' }}>Par sécurité, le lien n’est pas conservé en clair. Pour le renvoyer, créez-en un nouveau : l’ancien cessera de fonctionner.</p>
            </div>
          )}

          {lien && (
            <div className="space-y-2">
              <label className="block text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }} htmlFor="lien-depot">Lien personnel à transmettre</label>
              <div className="flex gap-2">
                <input id="lien-depot" readOnly value={lien.url} onFocus={e => e.currentTarget.select()}
                  className="flex-1 min-w-0 text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 font-mono" />
                <button type="button" className={BOUTON} onClick={copier}>
                  {copie ? <IconCheck size={13} /> : <IconCopy size={13} />} {copie ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>Valable jusqu’au {formaterDateHeure(lien.expires_at)}. Ce lien ne sera plus affiché après la fermeture de cette fenêtre.</p>
            </div>
          )}

          {erreur && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur}</p>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!lien && existant !== undefined && (
              <button type="button" className={BOUTON_PRIMAIRE} disabled={enCours} onClick={creer}>
                {enCours ? <IconLoader2 size={13} className="animate-spin" /> : <IconLink size={13} />}
                {existant ? 'Créer un nouveau lien' : 'Créer le lien'}
              </button>
            )}
            {lien && (
              <button type="button" className={BOUTON_PRIMAIRE} onClick={() => setMail(true)} disabled={comptesEnChargement}>
                <IconSend size={13} /> Envoyer par e-mail
              </button>
            )}
            {existant && (
              <button type="button" className={BOUTON} disabled={enCours} onClick={revoquer}>Révoquer le lien</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
