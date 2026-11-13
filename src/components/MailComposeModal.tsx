// Compose/reply/forward window — sends via the connected account's own API (Gmail
// messages.send, Outlook sendMail/reply), or via /api/send-email for an IMAP
// account that has its own SMTP configured (Réglages → Mes boîtes mail).
// Kept deliberately simple — a plain <textarea>, no rich-text editor —
// consistent with "minimal but useful".
//
// Depuis le support multi-comptes, le sélecteur liste des ADRESSES (une par
// compte connecté), pas des fournisseurs : deux comptes Gmail se
// distinguent par leur adresse, chacun choisissable comme expéditeur.
//
// Trois usages d'un message reçu : répondre (fil conservé), répondre à tous
// (À + Cc) et transférer (nouveau message, pièces jointes d'origine
// seulement sur case cochée). Les destinataires se saisissent à la main ou se
// choisissent dans les contacts du cabinet.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconPaperclip, IconSend, IconBrandGoogle, IconBrandWindows, IconMailbox, IconFolderShare } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useSettings } from '../hooks/useSettings';
import { signatureEffective } from '../lib/mailSignatureCabinet';
import { ajouterAuCorps, retirerDuCorps, type ElementDossierPartage } from '../lib/dossierPartageMail';
import { getAccessToken } from '../lib/authToken';
import { applyTenantHeader } from '../lib/activeTenant';
import { fileToEmailAttachment, MAX_EMAIL_TOTAL_BYTES, type EmailAttachment } from '../lib/emailAttachments';
import { startBackgroundSend, type SendProgress } from '../lib/backgroundSend';
import type { MailAccount, MailProvider } from '../hooks/useMailAccounts';
import { useUser } from '../UserContext';

export interface MailReplyContext {
  accountId: string;
  provider: MailProvider;
  messageId: string; // Gmail/Outlook id — unused when replying from an infomaniak message (SMTP fallback has no native reply)
  threadId?: string | null; // Gmail only — keeps the reply in the same thread
  messageIdHeader?: string | null; // Gmail only — becomes In-Reply-To/References
  subject: string;
  fromAddress: string; // becomes the "to" field
  /** « Répondre à tous » : À et Cc modifiables, et chez Outlook un envoi normal (la réponse native ne vise que l'expéditeur). */
  replyAll?: boolean;
}

/** Valeurs de départ d'un nouveau message (ex. envoi du DCE depuis le module ACT). */
export interface MailComposeInitial {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  /** Texte cité ou transféré, posé SOUS la signature. */
  quote?: string;
}

/** Pièce jointe d'un message reçu, proposée au transfert (jamais jointe sans case cochée). */
export interface MailForwardAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

/**
 * Dossier partagé (zip, lien externe) d'un envoi de consultation : cité dans le corps du message
 * et accessible sur la page de dépôt de l'entreprise, hors limite de pièces jointes.
 */
export interface MailDossierPartage {
  elements: ElementDossierPartage[];
  /** En-tête du bloc dans le corps du message. */
  entete: string;
  /** Texte du corps avant lequel le bloc est inséré (à défaut, en fin de corps). */
  ancre?: string;
  /** Mise en garde quand l'espace de dépôt est indisponible : seuls les liens externes sont alors accessibles. */
  avertissement?: string;
  onOuvrir: () => void;
  onRetirer: (id: string) => void;
}

interface MailComposeModalProps {
  accounts: MailAccount[];
  dossierPartage?: MailDossierPartage;
  replyTo?: MailReplyContext | null;
  initial?: MailComposeInitial;
  forwardAttachments?: MailForwardAttachment[];
  /** Fichiers déjà prêts, joints d'office (ex. le PDF d'une proposition) ; la personne peut les retirer. */
  initialFiles?: File[];
  title?: string;
  onClose: () => void;
  onSent?: () => void;
}

interface ContactOption { id: string; label: string; email: string }

const PROVIDER_ICON: Record<MailProvider, typeof IconBrandGoogle> = {
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  infomaniak: IconMailbox,
};

function canSendNatively(a: MailAccount): boolean {
  return a.provider === 'google' || a.provider === 'microsoft' || a.hasSmtp;
}

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Échec de l'envoi (${res.status})`), { code: data.code });
  return data;
}

/** Télécharge une pièce jointe du message d'origine (même route que son ouverture) pour la ré-attacher. */
async function downloadAttachment(att: MailForwardAttachment): Promise<File> {
  const headers = new Headers();
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  applyTenantHeader(headers);
  const fetchFn = (window as any)._originalFetch || window.fetch;
  const res = await fetchFn(att.url, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  return new File([blob], att.filename, { type: att.mimeType || blob.type });
}

const splitAddresses = (list: string): string[] => list.split(/[,;]/).map(s => s.trim()).filter(Boolean);
const sameAddress = (a: string, b: string): boolean => {
  const bare = (s: string) => (s.match(/<([^>]+)>/)?.[1] || s).trim().toLowerCase();
  return bare(a) === bare(b);
};
/** Ajoute `address` à la liste Cc, sauf s'il y figure déjà ou s'il est déjà destinataire principal. */
function addCcAddress(cc: string, address: string | null | undefined, to: string): string {
  const addr = address?.trim();
  if (!addr) return cc;
  if (splitAddresses(cc).some(x => sameAddress(x, addr)) || splitAddresses(to).some(x => sameAddress(x, addr))) return cc;
  return cc.trim() ? `${cc.trim().replace(/[,;]\s*$/, '')}, ${addr}` : addr;
}
function removeCcAddress(cc: string, address: string | null | undefined): string {
  const addr = address?.trim();
  return addr ? splitAddresses(cc).filter(x => !sameAddress(x, addr)).join(', ') : cc;
}

const formatSize = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`);

function RecipientField({ label, value, onChange, disabled, required, contacts }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; required?: boolean; contacts: ContactOption[];
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState('');
  const listId = `mail-contacts-${label}`;
  const add = (raw: string) => {
    const match = contacts.find(c => c.label === raw);
    if (!match) { setPicked(raw); return; }
    const current = value.split(',').map(a => a.trim()).filter(Boolean);
    if (!current.some(a => a.toLowerCase() === match.email.toLowerCase())) onChange([...current, match.email].join(', '));
    setPicked('');
  };
  return (
    <div className="space-y-1.5">
      <input
        required={required}
        type="text"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
        style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
      />
      {!disabled && contacts.length > 0 && (
        <>
          <input
            list={listId}
            aria-label={`${label} : ${t('mail_compose_add_contact')}`}
            placeholder={t('mail_compose_add_contact') as string}
            value={picked}
            onChange={e => add(e.target.value)}
            className="w-full p-1.5 rounded-lg text-xs"
            style={{ background: 'var(--tblr-bg)', border: '1px dashed var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <datalist id={listId}>
            {contacts.map(c => <option key={c.id} value={c.label} />)}
          </datalist>
        </>
      )}
    </div>
  );
}

export default function MailComposeModal({ accounts, replyTo, initial, forwardAttachments, initialFiles, title, dossierPartage, onClose, onSent }: MailComposeModalProps) {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const { settings: reglagesCabinet } = useSettings();
  const sendable = accounts.filter(canSendNatively);
  const noSendableAccount = sendable.length === 0;

  const [accountId, setAccountId] = useState<string | null>(
    replyTo ? replyTo.accountId : sendable.find(a => a.isDefault)?.id || sendable[0]?.id || null
  );
  const account = sendable.find(a => a.id === accountId) || null;
  const [to, setTo] = useState(replyTo?.fromAddress || initial?.to || '');
  // Copie d'office à l'adresse du compte expéditeur (traçabilité dans sa propre
  // boîte). Le champ reste libre : la personne peut retirer cette adresse.
  const [cc, setCc] = useState(() => addCcAddress(initial?.cc || '', account?.email, replyTo?.fromAddress || initial?.to || ''));
  const [subject, setSubject] = useState(
    replyTo ? (/^re\s*:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : initial?.subject || ''
  );
  // La signature personnelle (Réglages → Mon profil) est posée d'office sous
  // le corps, modifiable ou supprimable avant l'envoi ; le texte cité ou
  // transféré vient après elle. Sans signature personnelle, on pose celle du
  // cabinet (nom, agence, adresse, contact tirés des réglages).
  const identiteSignature = useMemo(() => ({
    nom: (reglagesCabinet?.architectName as string | undefined) || currentUser?.name,
    agencyName: reglagesCabinet?.agencyName,
    address: reglagesCabinet?.address,
    phone: reglagesCabinet?.phone,
    email: reglagesCabinet?.email,
  }), [reglagesCabinet, currentUser?.name]);
  const signatureInitiale = signatureEffective(currentUser?.mailSignature, identiteSignature);
  const [body, setBody] = useState(`${initial?.body || ''}${signatureInitiale ? `\n\n${signatureInitiale}` : ''}${initial?.quote || ''}`);
  // Les réglages du cabinet peuvent n'arriver qu'après l'ouverture de la fenêtre : la signature
  // de repli est alors posée à leur arrivée, une seule fois, sans toucher à ce qui a été saisi.
  const [signaturePosee, setSignaturePosee] = useState(!!signatureInitiale);
  useEffect(() => {
    if (signaturePosee) return;
    const signature = signatureEffective(currentUser?.mailSignature, identiteSignature);
    if (!signature) return;
    setSignaturePosee(true);
    setBody(prev => {
      const citation = initial?.quote || '';
      if (citation && prev.endsWith(citation)) return `${prev.slice(0, prev.length - citation.length)}\n\n${signature}${citation}`;
      return `${prev.replace(/\s+$/, '')}\n\n${signature}`;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identiteSignature, signaturePosee]);

  // Le bloc « dossier partagé » du corps suit les éléments ajoutés ou retirés.
  const elementsPartages = dossierPartage?.elements;
  const partagesCites = useRef<Map<string, ElementDossierPartage>>(new Map());
  useEffect(() => {
    if (!dossierPartage) return;
    const actuels = new Map((elementsPartages ?? []).map(e => [e.id, e]));
    setBody(prev => {
      let suivant = prev;
      for (const [id, el] of partagesCites.current) if (!actuels.has(id)) suivant = retirerDuCorps(suivant, dossierPartage.entete, el);
      for (const [id, el] of actuels) if (!partagesCites.current.has(id)) suivant = ajouterAuCorps(suivant, dossierPartage.entete, el, dossierPartage.ancre);
      return suivant;
    });
    partagesCites.current = actuels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementsPartages]);
  const [files, setFiles] = useState<File[]>(() => initialFiles ?? []);
  const [forwardIds, setForwardIds] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<ContactOption[]>([]);

  useEffect(() => {
    apiFetch<any[]>('/api/contacts')
      .then(rows => setContacts((rows || []).flatMap((c): ContactOption[] => {
        const email = c.email || c.email_work;
        if (!email) return [];
        const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
        const name = c.company_name ? `${c.company_name}${person ? ` (${person})` : ''}` : person;
        return [{ id: c.id, email, label: `${name || email} <${email}>` }];
      }).slice(0, 500)))
      .catch(() => {});
  }, []);

  const isNativeReply = !!replyTo && replyTo.accountId === accountId;
  // Répondre (simple) fige À et l'objet ; répondre à tous et transférer les laissent libres.
  const lockFields = isNativeReply && !replyTo?.replyAll;
  const nativeOutlookReply = isNativeReply && account?.provider === 'microsoft' && !replyTo?.replyAll;
  const heading = title || (replyTo ? (replyTo.replyAll ? t('mail_compose_reply_all_title') : t('mail_compose_reply_title')) : t('mail_compose_new_title'));
  const contactList = useMemo(() => contacts, [contacts]);

  // Poids des pièces jointes, recalculé à chaque ajout ou retrait (fichiers
  // choisis + pièces d'origine cochées pour un transfert).
  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + f.size, 0)
      + (forwardAttachments || []).filter(a => forwardIds.has(a.id)).reduce((sum, a) => sum + (a.size || 0), 0),
    [files, forwardAttachments, forwardIds],
  );
  const overLimit = totalBytes > MAX_EMAIL_TOTAL_BYTES;

  const toggleForward = (id: string) => setForwardIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // L'envoi part en arrière-plan : la fenêtre se referme aussitôt et la progression
  // s'affiche dans BackgroundSendTray, pendant que la personne continue de travailler.
  // Le traitement ne lit que des valeurs capturées ici, jamais l'état du composant
  // (qui n'existe plus une fois la fenêtre fermée).
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || overLimit) return;
    const aTelecharger = (forwardAttachments || []).filter(a => forwardIds.has(a.id));
    const joint = [...files];
    // Seuls les chemins qui passent par /api/send-email encodent les pièces jointes en base64.
    const encode = !account || (account.provider !== 'google' && account.provider !== 'microsoft');
    const etapes = aTelecharger.length + (encode ? aTelecharger.length + joint.length : 0) + 1;

    const run = async (progress: SendProgress) => {
      let fait = 0;
      // Pièces jointes d'origine cochées : récupérées d'abord, l'envoi est refusé si l'une manque
      // (un transfert partirait sinon sans la pièce annoncée).
      const forwarded: File[] = [];
      for (const att of aTelecharger) {
        progress(t('mail_bg_step_fetch', { done: forwarded.length + 1, total: aTelecharger.length }) as string, fait, etapes);
        try { forwarded.push(await downloadAttachment(att)); }
        catch { throw new Error(t('mail_forward_attachment_error', { name: att.filename }) as string); }
        fait += 1;
      }
      const allFiles = [...forwarded, ...joint];
      const encoder = async (): Promise<EmailAttachment[] | undefined> => {
        if (allFiles.length === 0) return undefined;
        const out: EmailAttachment[] = [];
        for (const f of allFiles) {
          progress(t('mail_bg_step_prepare', { done: out.length + 1, total: allFiles.length }) as string, fait, etapes);
          out.push(await fileToEmailAttachment(f));
          fait += 1;
        }
        return out;
      };
      const envoi = () => progress(t('mail_bg_step_send') as string, etapes - 1, etapes);

      if (!account) {
        // Aucun compte ne peut envoyer nativement (IMAP sans SMTP propre,
        // ou aucun compte connecté du tout) : POST /api/send-email retombe
        // sur le SMTP du cabinet (server/routes/sendEmail.ts), exactement
        // comme avant le support multi-comptes. Les pièces jointes voyagent
        // en base64 dans le même appel (nodemailer les relaie telles
        // quelles) — jusqu'ici silencieusement perdues sur ce chemin.
        const attachments = await encoder();
        envoi();
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({ to, cc: cc.trim() || undefined, subject, text: body, html: `<p>${body.replace(/\n/g, '<br/>')}</p>`, attachments }),
        });
      } else if (account.provider === 'google') {
        const fd = new FormData();
        fd.set('to', to);
        if (cc.trim()) fd.set('cc', cc);
        fd.set('subject', subject);
        fd.set('text', body);
        fd.set('accountId', account.id);
        if (isNativeReply && replyTo?.threadId) fd.set('threadId', replyTo.threadId);
        if (isNativeReply && replyTo?.messageIdHeader) {
          fd.set('inReplyTo', replyTo.messageIdHeader);
          fd.set('references', replyTo.messageIdHeader);
        }
        allFiles.forEach(f => fd.append('attachments', f));
        envoi();
        await postForm('/api/gmail/send', fd);
      } else if (nativeOutlookReply) {
        const fd = new FormData();
        fd.set('comment', body);
        fd.set('accountId', account.id);
        allFiles.forEach(f => fd.append('attachments', f));
        envoi();
        await postForm(`/api/outlook/messages/${encodeURIComponent(replyTo!.messageId)}/reply`, fd);
      } else if (account.provider === 'microsoft') {
        const fd = new FormData();
        fd.set('to', to);
        if (cc.trim()) fd.set('cc', cc);
        fd.set('subject', subject);
        fd.set('text', body);
        fd.set('accountId', account.id);
        allFiles.forEach(f => fd.append('attachments', f));
        envoi();
        await postForm('/api/outlook/send', fd);
      } else {
        // Compte IMAP avec son propre SMTP configuré (Réglages → Mes boîtes
        // mail) : /api/send-email sait aiguiller vers ce compte précis.
        const attachments = await encoder();
        envoi();
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({ to, cc: cc.trim() || undefined, subject, text: body, html: `<p>${body.replace(/\n/g, '<br/>')}</p>`, accountId: account.id, attachments }),
        });
      }
    };

    startBackgroundSend({
      label: subject.trim(),
      step: t('mail_bg_step_prepare_start') as string,
      run,
      onSent,
      describeError: (err: any) => (err?.code === 'INSUFFICIENT_SCOPE' ? t('mail_reconnect_banner') as string : err?.message || t('mail_action_error') as string),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={send}
        className="rounded-xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{heading}</h3>
          <button type="button" onClick={onClose} aria-label={t('btn_close') as string} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          {sendable.length > 1 && !isNativeReply && (
            <div className="flex gap-2 flex-wrap">
              {sendable.map(a => {
                const Icon = PROVIDER_ICON[a.provider];
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      // Changer de compte remplace l'ancienne copie d'office par celle du nouveau.
                      setCc(prev => addCcAddress(removeCcAddress(prev, account?.email), a.email, to));
                      setAccountId(a.id);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                    style={a.id === accountId
                      ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                      : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                  >
                    <Icon size={13} /> {a.displayName || a.email}
                  </button>
                );
              })}
            </div>
          )}

          {noSendableAccount && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' }}>
              {t('mail_compose_imap_fallback')}
            </p>
          )}

          <RecipientField label={t('mail_to') as string} value={to} onChange={setTo} disabled={lockFields} required contacts={contactList} />
          {!lockFields && (
            <RecipientField label={t('mail_compose_cc') as string} value={cc} onChange={setCc} contacts={contactList} />
          )}
          <input
            required
            type="text"
            aria-label={t('mailbox_compose_subject') as string}
            placeholder={t('mailbox_compose_subject') as string}
            value={subject}
            onChange={e => setSubject(e.target.value)}
            disabled={lockFields}
            className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <textarea
            required
            rows={10}
            aria-label={t('mailbox_compose_body') as string}
            placeholder={t('mailbox_compose_body') as string}
            value={body}
            onChange={e => setBody(e.target.value)}
            className="w-full p-2 rounded-lg text-sm resize-none"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />

          {forwardAttachments && forwardAttachments.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('mail_forward_attachments')}</legend>
              {forwardAttachments.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg cursor-pointer" style={{ border: '1px solid var(--tblr-border)' }}>
                  <input type="checkbox" checked={forwardIds.has(a.id)} onChange={() => toggleForward(a.id)} />
                  <IconPaperclip size={14} className="shrink-0" />
                  <span className="truncate flex-1">{a.filename}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>{formatSize(a.size)}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
              <IconPaperclip size={13} /> {t('mailbox_compose_attach')}
              <input type="file" multiple hidden onChange={e => {
                // Les fichiers choisis s'AJOUTENT aux précédents (un second choix ne les remplace plus).
                const choisis = Array.from(e.target.files || []);
                setFiles(prev => [...prev, ...choisis.filter(n => !prev.some(p => p.name === n.name && p.size === n.size && p.lastModified === n.lastModified))]);
                e.target.value = '';
              }} />
            </label>
            {dossierPartage && (
              <button type="button" onClick={dossierPartage.onOuvrir}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                <IconFolderShare size={13} /> Ajouter un dossier (zip, lien)
              </button>
            )}
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-lg" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' }}>
                {f.name}
                <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                  className="px-1 rounded hover:text-red-500">×</button>
              </span>
            ))}
          </div>

          {dossierPartage && (dossierPartage.elements.length > 0 || dossierPartage.avertissement) && (
            <div className="space-y-1.5">
              {dossierPartage.elements.length > 0 && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {dossierPartage.elements.map(el => (
                      <span key={el.id} className="inline-flex items-center gap-1 text-xs pl-2 pr-1 py-1 rounded-lg" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-text)', border: '1px dashed var(--tblr-border)' }}>
                        <IconFolderShare size={12} aria-hidden /> {el.libelle}
                        <button type="button" aria-label={`Retirer le dossier ${el.libelle}`} onClick={() => dossierPartage.onRetirer(el.id)}
                          className="px-1 rounded hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                    Dossier partagé : cité dans le message et accessible depuis l'espace de dépôt de l'entreprise, hors limite de pièces jointes. « × » le retire du dossier de consultation.
                  </p>
                </>
              )}
              {dossierPartage.avertissement && (
                <p className="text-xs" role="status" style={{ color: 'var(--tblr-muted)' }}>{dossierPartage.avertissement}</p>
              )}
            </div>
          )}

          <p className="text-xs" style={{ color: overLimit ? 'var(--tblr-danger)' : 'var(--tblr-muted)', fontWeight: overLimit ? 600 : 400 }}
            role={overLimit ? 'alert' : undefined}>
            {t('mailbox_compose_size_counter', { size: formatSize(totalBytes), max: formatSize(MAX_EMAIL_TOTAL_BYTES) })}
            {overLimit && ` ${t('mailbox_compose_size_over')}`}
          </p>

        </div>

        <div className="p-4 flex justify-end" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button
            type="submit"
            disabled={overLimit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--tblr-primary)', color: 'white' }}
          >
            <IconSend size={14} /> {t('mailbox_compose_send')}
          </button>
        </div>
      </form>
    </div>
  );
}
