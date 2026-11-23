// Envoi du DCE à plusieurs entreprises d'un coup. Un message UNIQUE (objet et corps communs,
// jetons remplacés entreprise par entreprise) mais un mail INDIVIDUEL par entreprise : aucune ne
// voit les autres. Chaque envoi est confirmé avant départ ; la date de transmission n'est posée
// que pour les envois réussis, et les échecs se relancent sans renvoyer aux autres.
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconLoader2, IconSend, IconX } from '@tabler/icons-react';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import { useSettings } from '../../hooks/useSettings';
import { useUser } from '../../UserContext';
import { signatureEffective } from '../../lib/mailSignatureCabinet';
import { MAX_EMAIL_TOTAL_BYTES } from '../../lib/emailAttachments';
import { apiFetch } from '../../lib/api';
import { envoyerMessageDirect, peutEnvoyer } from '../../lib/mailEnvoiDirect';
import type { EntrepriseSuivi } from '../../lib/actEntreprises';
import type { PieceMarcheGeneree } from '../../lib/marchePieces';
import { LIBELLE_MOTIF, lignesCochees, planEnvoiGroupe, type ModeEnvoi } from '../../lib/dceEnvoiGroupe';
import {
  JETONS_MODELE, MODELE_CORPS, MODELE_CORPS_ADDITIF, MODELE_SUJET_ADDITIF, MODELE_CORPS_QUANTITES, MODELE_CORPS_REPONSE, MODELE_CORPS_VISITE, MODELE_SUJET, MODELE_SUJET_QUANTITES, MODELE_SUJET_REPONSE, MODELE_SUJET_VISITE, blocsMessageDce, jetonsInconnus, remplirModele,
} from '../../lib/dceEnvoiMessage';
import { donneesSansReseau, preparerEnvoiEntreprise, type ContexteEnvoiDce } from '../../lib/dceEnvoiPreparation';

type Etat = 'attente' | 'encours' | 'envoye' | 'echec';
interface Statut { etat: Etat; message?: string }

/** Ce qui change d'un usage à l'autre : modèles de message et libellés. */
const TEXTES: Record<ModeEnvoi, { sujet: string; corps: string; objet: string; verbe: string; description: string; pied: string }> = {
  dce: {
    sujet: MODELE_SUJET, corps: MODELE_CORPS, objet: 'le DCE', verbe: 'Envoyer le DCE à',
    description: 'Chaque entreprise reçoit son propre message, avec ses lots, ses pièces et son lien de dépôt personnel. Les entreprises sans adresse, sans lot ou marquées « ne répond pas » ne peuvent pas être cochées.',
    pied: 'Les fichiers du DCE, le tableau d\'indices et les pièces du marché sont joints à chaque message, et un lien de dépôt personnel est créé à l\'envoi.',
  },
  visite: {
    sujet: MODELE_SUJET_VISITE, corps: MODELE_CORPS_VISITE, objet: 'la convocation à la visite', verbe: 'Convoquer',
    description: 'Chaque entreprise reçoit son propre message, avec le créneau qui lui est affecté. Les entreprises sans créneau affecté, sans adresse ou marquées « ne répond pas » ne peuvent pas être cochées.',
    pied: 'Aucune pièce n\'est jointe à la convocation.',
  },
  additif: {
    sujet: MODELE_SUJET_ADDITIF, corps: MODELE_CORPS_ADDITIF, objet: 'l\'additif', verbe: 'Envoyer l\'additif à',
    description: 'Seules les entreprises qui ont déjà reçu le DCE et que les pièces modifiées concernent sont proposées. Chacune reçoit son propre message, avec un lien « j\'ai bien reçu » qui lui est personnel.',
    pied: 'Les fichiers des pièces modifiées et le tableau des indices sont joints à chaque message. Aucun nouveau lien de dépôt n\'est créé : celui de l\'entreprise reste valable.',
  },
  quantites: {
    sujet: MODELE_SUJET_QUANTITES, corps: MODELE_CORPS_QUANTITES, objet: 'la demande de confirmation des quantités', verbe: 'Demander confirmation à',
    description: 'Seules les entreprises dont la quantité diffère du dossier sont proposées. Chacune reçoit ses propres postes et répond depuis sa page de dépôt. Sa réponse ne modifie jamais son offre : vous l\'appliquez vous-même depuis le comparatif.',
    pied: 'Aucune pièce n\'est jointe. Un nouveau lien de dépôt personnel est créé à l\'envoi : il remplace le précédent de l\'entreprise.',
  },
  reponse: {
    sujet: MODELE_SUJET_REPONSE, corps: MODELE_CORPS_REPONSE, objet: 'la réponse', verbe: 'Envoyer la réponse à',
    description: 'La réponse part à chaque entreprise concernée, sans citer l\'auteur de la question. Les entreprises sans adresse ou marquées « ne répond pas » ne peuvent pas être cochées.',
    pied: 'Aucune pièce n\'est jointe. Relisez la question : elle est envoyée telle quelle à toutes les entreprises.',
  },
};

const CHAMP = 'w-full text-sm border border-[var(--tblr-border)] rounded-lg px-2.5 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const LIEN_ACCUSE_APERCU = '[lien de confirmation de réception propre à l\'entreprise]';
const LIEN_APERCU = '[lien de dépôt personnel de l\'entreprise]';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');
const mo = (octets: number) => (octets / (1024 * 1024)).toFixed(1).replace('.', ',');

export default function DceEnvoiGroupeDialog({ titre, mode, dejaDiffusee, entreprises, contexte, onEnvoye, onClose }: {
  titre: string;
  /** `dce` : envoi du dossier ; `visite` : convocation à la visite ; `reponse` : diffusion d'une réponse publique (ni pièces ni lien de dépôt). */
  mode: ModeEnvoi;
  /** Mode `reponse` : entreprises qui ont déjà reçu cette réponse (décochées d'office). */
  dejaDiffusee?: ReadonlySet<string>;
  entreprises: EntrepriseSuivi[];
  contexte: ContexteEnvoiDce;
  /** Appelé pour chaque envoi réussi ; `creneauCite` : le message citait le créneau de visite de l'entreprise. */
  onEnvoye: (entrepriseId: string, creneauCite: boolean) => void;
  onClose: () => void;
}) {
  const { accounts, loading } = useMailAccounts();
  const { currentUser } = useUser();
  const { settings: reglagesCabinet } = useSettings();
  const comptes = useMemo(() => accounts.filter(peutEnvoyer), [accounts]);
  const [compteId, setCompteId] = useState<string | null>(null);
  useEffect(() => {
    if (compteId === null && comptes.length) setCompteId((comptes.find(a => a.isDefault) ?? comptes[0]).id);
  }, [comptes, compteId]);
  const compte = comptes.find(a => a.id === compteId) ?? null;

  const plan = useMemo(() => planEnvoiGroupe(entreprises, mode, dejaDiffusee), [entreprises, mode, dejaDiffusee]);
  const [coches, setCoches] = useState<Set<string>>(() => lignesCochees(plan));
  const [sujet, setSujet] = useState(TEXTES[mode].sujet);
  const [corps, setCorps] = useState(TEXTES[mode].corps);
  const [apercuId, setApercuId] = useState<string>(() => plan.find(l => !l.motif)?.entreprise.id ?? plan[0]?.entreprise.id ?? '');
  const [statuts, setStatuts] = useState<Record<string, Statut>>({});
  const [phase, setPhase] = useState<'composition' | 'envoi' | 'termine'>('composition');

  const onEnvoyeRef = useRef(onEnvoye);
  onEnvoyeRef.current = onEnvoye;

  const signature = signatureEffective(currentUser?.mailSignature, {
    nom: (reglagesCabinet?.architectName as string | undefined) || currentUser?.name,
    agencyName: reglagesCabinet?.agencyName, address: reglagesCabinet?.address,
    phone: reglagesCabinet?.phone, email: reglagesCabinet?.email,
  });

  const inconnus = useMemo(() => [...new Set([...jetonsInconnus(sujet), ...jetonsInconnus(corps)])], [sujet, corps]);
  const apercu = useMemo(() => {
    const ligne = plan.find(l => l.entreprise.id === apercuId);
    if (!ligne) return null;
    const base = donneesSansReseau(contexte, ligne.entreprise);
    const donnees = {
      ...base, lienDepot: (mode === 'dce' || mode === 'quantites') && contexte.depotActif ? LIEN_APERCU : undefined,
      additif: base.additif ? { ...base.additif, lienAccuse: LIEN_ACCUSE_APERCU } : undefined,
    };
    const blocs = blocsMessageDce(donnees);
    return { sujet: remplirModele(sujet, blocs), corps: remplirModele(corps, blocs) };
  }, [plan, apercuId, contexte, sujet, corps, mode]);

  const aEnvoyer = plan.filter(l => !l.motif && coches.has(l.entreprise.id));
  const dejaCoches = aEnvoyer.filter(l => l.dejaEnvoye).length;
  const enCours = phase === 'envoi';
  const nbEnvoyes = Object.values(statuts).filter(s => s.etat === 'envoye').length;
  const nbEchecs = Object.values(statuts).filter(s => s.etat === 'echec').length;

  const maj = (id: string, s: Statut) => setStatuts(prev => ({ ...prev, [id]: s }));

  const lancer = async (cibles: typeof plan) => {
    setPhase('envoi');
    // Les pièces du marché ne dépendent pas de l'entreprise : générées une seule fois.
    let piecesMarche: Promise<PieceMarcheGeneree[]> | null = null;
    const generer = contexte.genererPiecesMarche;
    const ctx: ContexteEnvoiDce = { ...contexte, genererPiecesMarche: generer ? () => (piecesMarche ??= generer()) : undefined };
    cibles.forEach(l => maj(l.entreprise.id, { etat: 'attente' }));
    // Additif : un lien « j'ai bien reçu » signé par entreprise, demandé en une fois avant les envois.
    let liensAccuse: Record<string, string> = {};
    if (mode === 'additif' && contexte.additif) {
      try {
        const r = await apiFetch<{ liens: Record<string, string> }>(
          `/api/projects/${encodeURIComponent(contexte.projectId || '')}/depot/additifs/${encodeURIComponent(contexte.additif.revision.id)}/liens`,
          { method: 'POST', body: JSON.stringify({ entreprises: cibles.map(l => ({ id: l.entreprise.id, nom: l.entreprise.nom })) }) },
        );
        liensAccuse = r.liens || {};
      } catch (err) {
        const message = `Les liens de confirmation n'ont pas pu être créés : ${(err as Error)?.message || 'erreur inconnue'}. Rien n'a été envoyé.`;
        cibles.forEach(l => maj(l.entreprise.id, { etat: 'echec', message }));
        setPhase('termine');
        return;
      }
    }
    for (const ligne of cibles) {
      const id = ligne.entreprise.id;
      maj(id, { etat: 'encours' });
      try {
        // Une convocation ne joint rien et ne crée aucun lien de dépôt : pas de préparation réseau.
        const prepBrute = mode === 'dce' || mode === 'additif' || mode === 'quantites'
          ? await preparerEnvoiEntreprise(ctx, ligne.entreprise)
          : { fichiers: [] as File[], donnees: donneesSansReseau(contexte, ligne.entreprise) };
        const prep = mode === 'additif' && prepBrute.donnees.additif
          ? { ...prepBrute, donnees: { ...prepBrute.donnees, additif: { ...prepBrute.donnees.additif, lienAccuse: liensAccuse[id] } } }
          : prepBrute;
        const total = prep.fichiers.reduce((s, f) => s + f.size, 0);
        if (total > MAX_EMAIL_TOTAL_BYTES) {
          throw new Error(`Pièces jointes trop volumineuses (${mo(total)} Mo pour ${mo(MAX_EMAIL_TOTAL_BYTES)} Mo au plus) : envoyez cette entreprise depuis sa ligne.`);
        }
        const blocs = blocsMessageDce(prep.donnees);
        const corpsFinal = remplirModele(corps, blocs);
        const texte = corpsFinal + (signature ? `\n\n${signature}` : '');
        // Le créneau n'est tenu pour notifié que si le message le dit vraiment (jeton conservé dans le texte).
        const creneauCite = !!blocs.visite && !!prep.donnees.visite?.assigne && corpsFinal.includes(blocs.visite);
        const copie = compte?.email && !ligne.destinataires.some(a => a.toLowerCase() === compte.email!.toLowerCase()) ? compte.email : undefined;
        await envoyerMessageDirect({
          account: compte, to: ligne.destinataires.join(', '), cc: copie,
          subject: remplirModele(sujet, blocs), body: texte, files: prep.fichiers,
        });
        maj(id, { etat: 'envoye' });
        onEnvoyeRef.current(id, creneauCite);
      } catch (err) {
        const message = (err as { code?: string })?.code === 'INSUFFICIENT_SCOPE'
          ? 'Compte mail à reconnecter (autorisation d\'envoi manquante).'
          : (err as Error)?.message || 'Échec de l\'envoi.';
        maj(id, { etat: 'echec', message });
      }
    }
    setPhase('termine');
  };

  const envoyer = () => {
    if (aEnvoyer.length === 0 || enCours) return;
    const objet = TEXTES[mode].objet;
    const message = `Envoyer ${objet} à ${aEnvoyer.length} entreprise${aEnvoyer.length > 1 ? 's' : ''}, un message individuel chacune ?`
      + (dejaCoches ? `\n\n${dejaCoches} d'entre elles l'ont déjà reçu${mode === 'dce' || mode === 'quantites' ? ' : leur lien de dépôt précédent sera révoqué' : ''}.` : '');
    if (!window.confirm(message)) return;
    void lancer(aEnvoyer);
  };
  const relancerEchecs = () => {
    const cibles = plan.filter(l => statuts[l.entreprise.id]?.etat === 'echec');
    if (cibles.length) void lancer(cibles);
  };

  const basculer = (id: string) => setCoches(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const lecture = phase !== 'composition';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={() => { if (!enCours) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="dce-groupe-titre"
        className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-xl bg-[var(--tblr-surface)] shadow-xl"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape' && !enCours) onClose(); }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-[var(--tblr-border)] sticky top-0 bg-[var(--tblr-surface)] z-10">
          <h3 id="dce-groupe-titre" className="font-semibold">{titre}</h3>
          <button type="button" onClick={onClose} disabled={enCours} aria-label="Fermer" className="p-1 disabled:opacity-40"><IconX size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <section aria-label="Entreprises destinataires">
            <p className="text-xs text-[var(--tblr-muted)] mb-2">
              {TEXTES[mode].description}
            </p>
            <ul className="divide-y divide-[var(--tblr-border)] border border-[var(--tblr-border)] rounded-lg">
              {plan.map(l => {
                const id = l.entreprise.id; const st = statuts[id];
                return (
                  <li key={id} className="flex items-start gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" className="mt-1 w-4 h-4 accent-blue-600" disabled={!!l.motif || lecture}
                      checked={!l.motif && coches.has(id)} onChange={() => basculer(id)}
                      aria-label={`${TEXTES[mode].verbe} ${l.entreprise.nom || 'cette entreprise'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{l.entreprise.nom || 'Entreprise sans nom'}</p>
                      <p className="text-xs text-[var(--tblr-muted)] truncate">
                        {l.destinataires.join(', ') || 'Aucune adresse'} · {contexte.lots.filter(x => l.entreprise.lots_ids.includes(x.id)).map(x => `Lot ${x.lot_number}`).join(', ') || 'aucun lot'}
                      </p>
                    </div>
                    <div className="text-xs text-right shrink-0 max-w-[16rem]">
                      {l.motif && <span className="text-amber-700 dark:text-amber-300">{LIBELLE_MOTIF[l.motif]}</span>}
                      {!l.motif && l.dejaEnvoye && !st && <span className="text-[var(--tblr-muted)]">{mode === 'dce' ? 'DCE transmis' : mode === 'quantites' ? 'Déjà demandé' : 'Déjà convoquée'}{l.dejaLe ? ` le ${fmtDate(l.dejaLe)}` : ''}</span>}
                      {st?.etat === 'attente' && <span className="text-[var(--tblr-muted)]">En attente</span>}
                      {st?.etat === 'encours' && <span className="inline-flex items-center gap-1 text-blue-700"><IconLoader2 size={13} className="animate-spin" /> Envoi…</span>}
                      {st?.etat === 'envoye' && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><IconCheck size={13} /> Envoyé</span>}
                      {st?.etat === 'echec' && <span className="inline-flex items-start gap-1 text-red-700 dark:text-red-300 text-left"><IconAlertTriangle size={13} className="shrink-0 mt-0.5" /> {st.message}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Message" className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-xs font-semibold">Expéditeur
                {loading ? <p className="font-normal text-[var(--tblr-muted)] mt-1">Lecture des comptes…</p> : (
                  <select className={CHAMP} value={compteId ?? ''} disabled={lecture || comptes.length === 0}
                    onChange={e => setCompteId(e.target.value || null)}>
                    {comptes.length === 0 && <option value="">Messagerie du cabinet</option>}
                    {comptes.map(a => <option key={a.id} value={a.id}>{a.email || a.displayName || a.provider}</option>)}
                  </select>
                )}
              </label>
              <label className="block text-xs font-semibold">Objet
                <input className={CHAMP} value={sujet} disabled={lecture} onChange={e => setSujet(e.target.value)} />
              </label>
            </div>
            <label className="block text-xs font-semibold">Message (commun à toutes les entreprises)
              <textarea className={`${CHAMP} font-mono text-xs`} rows={14} value={corps} disabled={lecture} onChange={e => setCorps(e.target.value)} />
            </label>
            <details className="text-xs text-[var(--tblr-muted)]">
              <summary className="cursor-pointer font-semibold">Jetons disponibles</summary>
              <ul className="mt-1 grid sm:grid-cols-2 gap-x-4">
                {JETONS_MODELE.map(j => <li key={j.jeton}><code>{`{{${j.jeton}}}`}</code> : {j.aide}</li>)}
              </ul>
            </details>
            {inconnus.length > 0 && (
              <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">
                <IconAlertTriangle size={13} className="inline mr-1" />
                Jeton non reconnu, il restera tel quel dans le message : {inconnus.join(', ')}
              </p>
            )}
            {signature && <p className="text-xs text-[var(--tblr-muted)]">Votre signature est ajoutée sous le message.</p>}
          </section>

          <section aria-label="Aperçu du message">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Aperçu</h4>
              <select aria-label="Entreprise de l'aperçu" className="text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1 bg-white dark:bg-zinc-900"
                value={apercuId} onChange={e => setApercuId(e.target.value)}>
                {plan.map(l => <option key={l.entreprise.id} value={l.entreprise.id}>{l.entreprise.nom || 'Entreprise sans nom'}</option>)}
              </select>
            </div>
            {apercu && (
              <div className="rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] p-3 text-sm">
                <p className="font-semibold mb-2">{apercu.sujet}</p>
                <pre className="whitespace-pre-wrap font-sans text-xs">{apercu.corps}</pre>
              </div>
            )}
            <p className="text-xs text-[var(--tblr-muted)] mt-1">{TEXTES[mode].pied}</p>
          </section>
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-[var(--tblr-border)] sticky bottom-0 bg-[var(--tblr-surface)]">
          {phase === 'termine' && (
            <p role="status" className="text-xs font-semibold">
              {nbEnvoyes} envoyé{nbEnvoyes > 1 ? 's' : ''}{nbEchecs > 0 ? `, ${nbEchecs} en échec` : ''}
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            {phase === 'termine' && nbEchecs > 0 && (
              <button type="button" onClick={relancerEchecs} className="px-3 py-2 rounded-lg text-sm font-semibold border border-[var(--tblr-border)] hover:bg-zinc-50 dark:hover:bg-zinc-800">
                Relancer les échecs
              </button>
            )}
            {phase === 'composition' ? (
              <button type="button" onClick={envoyer} disabled={aEnvoyer.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                <IconSend size={15} /> Envoyer à {aEnvoyer.length} entreprise{aEnvoyer.length > 1 ? 's' : ''}
              </button>
            ) : (
              <button type="button" onClick={onClose} disabled={enCours}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                {enCours ? 'Envoi en cours…' : 'Fermer'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
