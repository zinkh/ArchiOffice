// Espace public de dépôt du DOE : la page qu'ouvre une entreprise depuis son lien
// personnel (/doe/:token). Sans compte : le jeton du lien est la seule clé.
// Sobre à dessein et lisible sur téléphone (un artisan dépose souvent ses
// documents depuis son chantier). Elle montre les pièces attendues, ce que le
// maître d'œuvre a déjà reçu et son avis, et laisse déposer ou retirer un fichier.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IconAlertTriangle, IconCheck, IconFilePlus, IconLoader2, IconTrash, IconUpload } from '@tabler/icons-react';
import { formatOctets } from '../lib/consultationDepot';
import { controlerFichiersDoe, DOE_FORMATS_LIBELLE, type DoeAvisDocument, type DoeAvisVisa, type DoePieceKey } from '../lib/doeAtelier';
import { formaterDate, formaterDateHeure } from '../lib/depotAffichage';

interface Contexte {
  operation: string | null;
  entreprise: string;
  cabinet: { nom: string | null; logo: string | null; adresse: string | null; email: string | null; telephone: string | null };
  lots: Array<{ id: string; libelle: string }>;
  deadline_at: string | null;
  en_retard: boolean;
  instructions: string | null;
  statut: string;
  pieces: Array<{ key: DoePieceKey; label: string; description: string; requise: boolean; etat: 'manquante' | 'recue' | 'validee' | 'a_corriger' }>;
  documents: Array<{
    id: string; nom: string; piece: DoePieceKey | null; lot_id: string | null; avis: DoeAvisDocument;
    commentaire: string | null; recu_le: string; taille: number | null; peut_retirer: boolean;
  }>;
  visa: { numero: string; avis: DoeAvisVisa; observations: string | null; issued_at: string } | null;
  limites: { fichier_octets: number; depot_octets: number; fichiers_max: number; accept: string; formats: string };
}

interface Recu { recu_le: string; accuse_envoye: boolean; elements: string[] }

const CHAMP = 'w-full text-sm px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-zinc-500';
const CHAMP_STYLE = { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' } as const;
const BOUTON = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 min-h-11';

const ETAT_PIECE: Record<string, string> = {
  manquante: 'À remettre', recue: 'Reçue, en cours d’analyse', validee: 'Reçue et validée', a_corriger: 'À corriger ou à compléter',
};
const AVIS_DOCUMENT: Record<DoeAvisDocument, string> = {
  pending: 'En cours d’analyse', approved: 'Favorable', commented: 'Favorable avec observations', rejected: 'À corriger',
};
const AVIS_VISA: Record<DoeAvisVisa, string> = {
  favorable: 'Favorable', avec_observations: 'Favorable avec observations', defavorable: 'Défavorable',
};

const appelPublic = (url: string, init?: RequestInit) => ((window as any)._originalFetch || window.fetch)(url, init);

async function lireReponse(res: Response): Promise<any> {
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) { const e: any = new Error(corps?.error || 'Une erreur est survenue.'); e.status = res.status; throw e; }
  return corps;
}

export default function DepotDoe() {
  const { token = '' } = useParams<{ token: string }>();
  const base = `/api/public/doe/${encodeURIComponent(token)}`;
  const [ctx, setCtx] = useState<Contexte | null>(null);
  const [fermeture, setFermeture] = useState<string | null>(null);
  const [recu, setRecu] = useState<Recu | null>(null);
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setCtx(await lireReponse(await appelPublic(base)));
      setFermeture(null);
    } catch (e: any) {
      setFermeture(e?.message || 'Ce lien est indisponible.');
    }
  }, [base]);
  useEffect(() => { void charger(); }, [charger]);
  useEffect(() => { document.title = ctx?.operation ? `Dépôt du DOE : ${ctx.operation}` : 'Dépôt du DOE'; }, [ctx?.operation]);

  if (fermeture) {
    return (
      <main className="min-h-dvh flex items-center justify-center p-6" style={{ background: 'var(--tblr-bg, var(--tblr-surface))', color: 'var(--tblr-text)' }}>
        <div className="max-w-md text-center space-y-2">
          <IconAlertTriangle size={28} className="mx-auto" aria-hidden />
          <h1 className="text-lg font-bold">Espace de dépôt indisponible</h1>
          <p className="text-sm" role="alert" style={{ color: 'var(--tblr-muted)' }}>{fermeture}</p>
        </div>
      </main>
    );
  }
  if (!ctx) {
    return <main className="min-h-dvh flex items-center justify-center" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 className="animate-spin" aria-label="Chargement" /></main>;
  }

  const retirer = async (id: string) => {
    setErreurRetrait(null);
    try {
      await lireReponse(await appelPublic(`${base}/documents/${id}`, { method: 'DELETE' }));
      await charger();
    } catch (e: any) {
      setErreurRetrait(e?.message || 'Le retrait a échoué.');
    }
  };

  const pieceLabel = (k: DoePieceKey | null) => ctx.pieces.find(p => p.key === k)?.label ?? 'Non classé';
  const infosCabinet = [ctx.cabinet.nom, ctx.cabinet.adresse, ctx.cabinet.telephone, ctx.cabinet.email].filter(Boolean).join(' · ');

  return (
    <main className="min-h-dvh pb-16" style={{ background: 'var(--tblr-bg, var(--tblr-surface))', color: 'var(--tblr-text)' }}>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-center gap-4 pb-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          {ctx.cabinet.logo && <img src={ctx.cabinet.logo} alt="" className="h-12 w-auto max-w-[8rem] object-contain" />}
          <div className="min-w-0">
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{ctx.cabinet.nom || 'Maîtrise d’œuvre'}</p>
            <h1 className="text-xl font-bold break-words">{ctx.operation || 'Dossier des ouvrages exécutés'}</h1>
            <p className="text-sm">Dossier des ouvrages exécutés (DOE) de <strong>{ctx.entreprise}</strong></p>
          </div>
        </header>

        <section aria-label="Informations" className="space-y-2 text-sm">
          <p>{ctx.deadline_at ? <>Remise souhaitée au plus tard le <strong>{formaterDateHeure(ctx.deadline_at)}</strong>.</> : 'Aucune date limite n’est fixée.'}</p>
          {ctx.en_retard && (
            <p role="status" className="rounded-lg px-3 py-2 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              La date prévue est dépassée : vos documents seront tout de même enregistrés, merci de les remettre dès que possible.
            </p>
          )}
          {ctx.instructions && <p className="whitespace-pre-line rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2, var(--tblr-surface))', border: '1px solid var(--tblr-border)' }}>{ctx.instructions}</p>}
          {ctx.lots.length > 0 && <p style={{ color: 'var(--tblr-muted)' }}>Lots qui vous sont confiés : {ctx.lots.map(l => l.libelle).join(' ; ')}.</p>}
        </section>

        {ctx.visa && (
          <section aria-label="Visa du maître d’œuvre" className="rounded-lg p-4 space-y-1 text-sm" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
            <p className="font-bold">Visa n° {ctx.visa.numero} du {formaterDate(ctx.visa.issued_at)} : {AVIS_VISA[ctx.visa.avis]}</p>
            {ctx.visa.observations && <p className="whitespace-pre-line">{ctx.visa.observations}</p>}
          </section>
        )}

        {recu && (
          <section role="status" aria-live="polite" className="rounded-lg p-4 space-y-1 text-sm bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
            <p className="font-bold flex items-center gap-2"><IconCheck size={16} aria-hidden /> Documents enregistrés le {formaterDateHeure(recu.recu_le)}</p>
            <ul className="list-disc pl-5 text-xs">{recu.elements.map(e => <li key={e}>{e}</li>)}</ul>
            <p className="text-xs">{recu.accuse_envoye ? 'Un accusé de réception vous a été envoyé par e-mail.' : 'Conservez cette page comme preuve de votre dépôt : aucun accusé n’a pu être envoyé par e-mail.'}</p>
          </section>
        )}

        <section aria-label="Pièces attendues" className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider">Pièces attendues</h2>
          <ul className="rounded-lg divide-y" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
            {ctx.pieces.filter(p => p.requise || p.etat !== 'manquante').map(p => (
              <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="flex-1 basis-56 min-w-0">
                  <span className="font-semibold">{p.label}</span>{!p.requise && <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}> (facultative)</span>}
                  <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{p.description}</span>
                </span>
                <span className="text-xs font-bold">{ETAT_PIECE[p.etat]}</span>
              </li>
            ))}
          </ul>
        </section>

        <DepotFichiers base={base} ctx={ctx} onRecu={r => { setRecu(r); void charger(); }} />

        {ctx.documents.length > 0 && (
          <section aria-label="Vos documents" className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider">Vos documents</h2>
            {erreurRetrait && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreurRetrait}</p>}
            <ul className="rounded-lg divide-y" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
              {ctx.documents.map(d => (
                <li key={d.id} className="px-3 py-2.5 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex-1 basis-56 min-w-0 break-words font-medium">{d.nom}</span>
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{pieceLabel(d.piece)} · {formaterDate(d.recu_le)}{d.taille ? ` · ${formatOctets(d.taille)}` : ''}</span>
                    <span className="text-xs font-bold">{AVIS_DOCUMENT[d.avis]}</span>
                    {d.peut_retirer && (
                      <button type="button" onClick={() => retirer(d.id)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={`Retirer ${d.nom}`}>
                        <IconTrash size={15} aria-hidden />
                      </button>
                    )}
                  </div>
                  {d.commentaire && <p className="text-xs whitespace-pre-line rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2, var(--tblr-surface))' }}>Observation du maître d’œuvre : {d.commentaire}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="pt-4 text-xs space-y-1" style={{ borderTop: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          {infosCabinet && <p>{infosCabinet}</p>}
          <p>Ce lien est personnel : ne le transmettez pas. Vous pouvez compléter votre dépôt autant de fois que nécessaire.</p>
        </footer>
      </div>
    </main>
  );
}

// ── Dépôt de fichiers ────────────────────────────────────────────────────────

function DepotFichiers({ base, ctx, onRecu }: { base: string; ctx: Contexte; onRecu: (r: Recu) => void }) {
  const [piece, setPiece] = useState<DoePieceKey | ''>('');
  const [lotId, setLotId] = useState('');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [progression, setProgression] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const { limites } = ctx;

  const choisir = (liste: FileList | File[] | null) => {
    if (!liste) return;
    const suivant = [...fichiers, ...Array.from(liste)].slice(0, limites.fichiers_max);
    setFichiers(suivant);
    const c = controlerFichiersDoe(suivant.map(f => ({ name: f.name, size: f.size })));
    setErreur(c.ok ? null : c.raison);
  };

  const envoyer = () => {
    setErreur(null);
    const c = controlerFichiersDoe(fichiers.map(f => ({ name: f.name, size: f.size })));
    if (!c.ok) return setErreur(c.raison);

    const formulaire = new FormData();
    if (piece) formulaire.append('doe_piece', piece);
    if (lotId) formulaire.append('lot_id', lotId);
    fichiers.forEach(f => formulaire.append('files', f, f.name));

    // XMLHttpRequest plutôt que fetch : seule façon d'afficher la progression
    // d'un envoi de plusieurs dizaines de Mo depuis un chantier.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base}/fichiers`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgression(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => { setProgression(null); setErreur('Connexion interrompue. Vérifiez votre réseau et réessayez.'); };
    xhr.onload = () => {
      setProgression(null);
      let corps: any = {};
      try { corps = JSON.parse(xhr.responseText); } catch { /* réponse non JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        onRecu({
          recu_le: corps.recu_le, accuse_envoye: corps.accuse_envoye,
          elements: (corps.depots || []).map((d: any) => `${d.nom} (${formatOctets(d.taille)})`),
        });
        setFichiers([]);
      } else {
        setErreur(corps?.error || 'Le dépôt n’a pas pu être enregistré.');
      }
    };
    setProgression(0);
    xhr.send(formulaire);
  };

  const enCours = progression !== null;
  const total = fichiers.reduce((s, f) => s + f.size, 0);

  return (
    <section aria-label="Déposer des documents" className="rounded-lg p-4 space-y-3" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider">Déposer des documents</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        Formats acceptés : {DOE_FORMATS_LIBELLE}. {limites.fichiers_max} fichiers au plus par dépôt, {formatOctets(limites.fichier_octets)} par fichier, {formatOctets(limites.depot_octets)} au total. Les plans DWG et DXF ne sont pas acceptés : joignez-les en PDF.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Nature des documents (facultatif)</span>
          <select className={CHAMP} style={CHAMP_STYLE} value={piece} onChange={e => setPiece(e.target.value as DoePieceKey | '')}>
            <option value="">Je ne sais pas / plusieurs natures</option>
            {ctx.pieces.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {ctx.lots.length > 1 && (
          <label className="block text-sm">
            <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Lot concerné (facultatif)</span>
            <select className={CHAMP} style={CHAMP_STYLE} value={lotId} onChange={e => setLotId(e.target.value)}>
              <option value="">Tous mes lots</option>
              {ctx.lots.map(l => <option key={l.id} value={l.id}>{l.libelle}</option>)}
            </select>
          </label>
        )}
      </div>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); choisir(e.dataTransfer.files); }}
        className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer"
        style={{ borderColor: 'var(--tblr-border)' }}
        onClick={() => champ.current?.click()}
      >
        <IconFilePlus size={24} className="mx-auto mb-1" aria-hidden />
        <p className="text-sm">Glissez vos fichiers ici ou <span className="underline font-bold">parcourez</span></p>
        <input ref={champ} type="file" className="sr-only" aria-label="Choisir des fichiers" multiple accept={limites.accept}
          onChange={e => { choisir(e.target.files); e.target.value = ''; }} />
      </div>

      {fichiers.length > 0 && (
        <ul className="text-sm divide-y rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          {fichiers.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-0 break-words">{f.name}</span>
              <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{formatOctets(f.size)}</span>
              <button type="button" aria-label={`Retirer ${f.name}`} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setFichiers(prev => prev.filter((_, j) => j !== i))} disabled={enCours}><IconTrash size={14} aria-hidden /></button>
            </li>
          ))}
          <li className="px-3 py-1.5 text-xs" style={{ color: 'var(--tblr-muted)' }}>Total : {formatOctets(total)}</li>
        </ul>
      )}

      {enCours && (
        <div role="progressbar" aria-valuenow={progression ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Envoi en cours" className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--tblr-border)' }}>
          <div className="h-full bg-zinc-800 dark:bg-zinc-200 transition-[width]" style={{ width: `${progression}%` }} />
        </div>
      )}
      {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreur}</p>}

      <button type="button" disabled={enCours || fichiers.length === 0} onClick={envoyer} className={`${BOUTON} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`}>
        {enCours ? <IconLoader2 size={15} className="animate-spin" aria-hidden /> : <IconUpload size={15} aria-hidden />} Envoyer {fichiers.length > 1 ? `les ${fichiers.length} fichiers` : 'le fichier'}
      </button>
    </section>
  );
}
