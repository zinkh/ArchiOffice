// Espace public de dépôt des offres : la page qu'ouvre une entreprise consultée
// depuis son lien personnel. Sans compte : le jeton du lien (/depot/:token) est
// la seule clé. Sobre à dessein, et lisible sur téléphone (un artisan dépose
// souvent son devis depuis son chantier).
//
// Deux manières de remettre une offre, cumulables : la saisir en ligne ou
// déposer des documents (PDF, Word, Excel, ODS, ODT). Rien n'est intégré aux
// offres du cabinet sans validation de l'architecte.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IconAlertTriangle, IconCheck, IconDownload, IconFilePlus, IconLoader2, IconPlus, IconTrash, IconUpload,
} from '@tabler/icons-react';
import {
  DEPOT_ACCEPT, DEPOT_KIND_LABELS, DEPOT_TABLEURS, MAX_DEPOT_OCTETS, MAX_FICHIER_OCTETS, MAX_FICHIERS_PAR_DEPOT,
  MAX_LIGNES_SAISIE, controlerLot, extensionDe, formatOctets, validerSaisie, type DepotKind,
} from '../lib/consultationDepot';
import { euros, formaterDate, formaterDateHeure } from '../lib/depotAffichage';

interface Contexte {
  operation: string | null;
  entreprise: string;
  cabinet: { nom: string | null; logo: string | null; adresse: string | null; email: string | null; telephone: string | null };
  lots: Array<{ id: string; lot_number: string; lot_title: string }>;
  deadline_at: string | null;
  en_retard: boolean;
  instructions: string | null;
  pieces: Array<{ id: string; nom: string; taille: number | null }>;
  depots: Array<{ id: string; lot_id: string | null; kind: DepotKind; version: number; nom: string | null; taille: number | null; hors_delai: boolean; recu_le: string }>;
}

interface Recu { recu_le: string; hors_delai: boolean; accuse_envoye: boolean; elements: string[]; empreintes: string[] }

const CHAMP = 'w-full text-sm px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-zinc-500';
const CHAMP_STYLE = { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' } as const;
const BOUTON = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 min-h-11';

const appelPublic = (url: string, init?: RequestInit) => ((window as any)._originalFetch || window.fetch)(url, init);

async function lireReponse(res: Response): Promise<any> {
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) { const e: any = new Error(corps?.error || 'Une erreur est survenue.'); e.status = res.status; e.corps = corps; throw e; }
  return corps;
}

export default function DepotOffres() {
  const { token = '' } = useParams<{ token: string }>();
  const base = `/api/public/depot/${encodeURIComponent(token)}`;
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

  useEffect(() => { document.title = ctx?.operation ? `Remise d'offre : ${ctx.operation}` : "Remise d'offre"; }, [ctx?.operation]);

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

  const lotLibelle = (id: string | null) => {
    const l = ctx.lots.find(x => x.id === id);
    return l ? `Lot ${l.lot_number} : ${l.lot_title}` : 'Tous lots';
  };

  const retirer = async (id: string) => {
    setErreurRetrait(null);
    try {
      await lireReponse(await appelPublic(`${base}/depots/${id}`, { method: 'DELETE' }));
      await charger();
    } catch (e: any) {
      setErreurRetrait(e?.message || 'Le retrait a échoué.');
    }
  };

  return (
    <main className="min-h-dvh pb-16" style={{ background: 'var(--tblr-bg, var(--tblr-surface))', color: 'var(--tblr-text)' }}>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-center gap-4 pb-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          {ctx.cabinet.logo && <img src={ctx.cabinet.logo} alt="" className="h-12 w-auto max-w-[8rem] object-contain" />}
          <div className="min-w-0">
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{ctx.cabinet.nom || 'Maîtrise d’œuvre'}</p>
            <h1 className="text-xl font-bold break-words">{ctx.operation || 'Consultation des entreprises'}</h1>
            <p className="text-sm">Remise de l’offre de <strong>{ctx.entreprise}</strong></p>
          </div>
        </header>

        <section aria-label="Informations" className="space-y-2 text-sm">
          <p>
            {ctx.deadline_at ? <>Date limite de remise : <strong>{formaterDateHeure(ctx.deadline_at)}</strong>.</> : 'Aucune date limite n’est fixée.'}
          </p>
          {ctx.en_retard && (
            <p role="status" className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200">
              La date limite est passée. Votre remise sera enregistrée mais signalée « hors délai » au maître d’œuvre.
            </p>
          )}
          {ctx.instructions && <p className="whitespace-pre-line rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2, var(--tblr-surface))', border: '1px solid var(--tblr-border)' }}>{ctx.instructions}</p>}
          {ctx.lots.length > 0 && (
            <p style={{ color: 'var(--tblr-muted)' }}>Lots qui vous sont confiés : {ctx.lots.map(l => `Lot ${l.lot_number} ${l.lot_title}`).join(' ; ')}.</p>
          )}
        </section>

        {ctx.pieces.length > 0 && (
          <section aria-label="Documents de la consultation" className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider">Documents de la consultation</h2>
            <ul className="rounded-lg divide-y" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
              {ctx.pieces.map(p => (
                <li key={p.id}>
                  <a href={`${base}/pieces/${encodeURIComponent(p.id)}`} className="flex items-center gap-2 px-3 py-2.5 text-sm hover:underline min-h-11" target="_blank" rel="noopener noreferrer">
                    <IconDownload size={15} aria-hidden /> <span className="flex-1 min-w-0 break-words">{p.nom}</span>
                    {p.taille ? <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{formatOctets(p.taille)}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {recu && (
          <section role="status" aria-live="polite" className="rounded-lg p-4 space-y-1 text-sm bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
            <p className="font-bold flex items-center gap-2"><IconCheck size={16} aria-hidden /> Remise enregistrée le {formaterDateHeure(recu.recu_le)}</p>
            {recu.hors_delai && <p>Elle est parvenue après la date limite et a été signalée « hors délai ».</p>}
            <ul className="list-disc pl-5 text-xs">{recu.elements.map(e => <li key={e}>{e}</li>)}</ul>
            <p className="text-xs">{recu.accuse_envoye ? 'Un accusé de réception vous a été envoyé par e-mail.' : 'Conservez cette page comme preuve de votre remise : aucun accusé n’a pu être envoyé par e-mail.'}</p>
          </section>
        )}

        <SaisieEnLigne base={base} ctx={ctx} onRecu={r => { setRecu(r); void charger(); }} />
        <DepotFichiers base={base} ctx={ctx} onRecu={r => { setRecu(r); void charger(); }} />

        {ctx.depots.length > 0 && (
          <section aria-label="Vos remises" className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider">Vos remises</h2>
            {erreurRetrait && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreurRetrait}</p>}
            <ul className="rounded-lg divide-y" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
              {ctx.depots.map(d => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <span className="font-semibold">{DEPOT_KIND_LABELS[d.kind]}</span>
                  <span className="basis-full sm:basis-0 sm:flex-1 min-w-0 break-words">{d.nom || 'Offre saisie en ligne'}</span>
                  <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{lotLibelle(d.lot_id)} · v{d.version} · {formaterDate(d.recu_le)}</span>
                  {d.hors_delai && <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">Hors délai</span>}
                  {!ctx.en_retard && (
                    <button type="button" onClick={() => retirer(d.id)} className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={`Retirer cette remise : ${d.nom || 'offre saisie en ligne'}`}>
                      <IconTrash size={15} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="pt-4 text-xs space-y-1" style={{ borderTop: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
          {[ctx.cabinet.nom, ctx.cabinet.adresse, ctx.cabinet.telephone, ctx.cabinet.email].filter(Boolean).join(' · ') && (
            <p>{[ctx.cabinet.nom, ctx.cabinet.adresse, ctx.cabinet.telephone, ctx.cabinet.email].filter(Boolean).join(' · ')}</p>
          )}
          <p>Ce lien est personnel : ne le transmettez pas. Les documents sont conservés sur l’espace de stockage du maître d’œuvre.</p>
        </footer>
      </div>
    </main>
  );
}

// ── Saisie de l'offre en ligne ───────────────────────────────────────────────

function SaisieEnLigne({ base, ctx, onRecu }: { base: string; ctx: Contexte; onRecu: (r: Recu) => void }) {
  const [lotId, setLotId] = useState(ctx.lots.length === 1 ? ctx.lots[0].id : '');
  const [montant, setMontant] = useState('');
  const [delai, setDelai] = useState('');
  const [observations, setObservations] = useState('');
  const [lignes, setLignes] = useState<Array<{ kind: 'option' | 'variante'; libelle: string; montant: string }>>([]);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreur(null);
    if (!lotId) return setErreur('Choisissez le lot concerné par cette offre.');
    const corps = { lot_id: lotId, montant_base: montant, delai_semaines: delai, observations, lignes };
    const controle = validerSaisie(corps);
    if (!controle.ok) return setErreur(controle.raison);
    setEnCours(true);
    try {
      const r = await lireReponse(await appelPublic(`${base}/saisie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }));
      onRecu({
        recu_le: r.recu_le, hors_delai: r.hors_delai, accuse_envoye: r.accuse_envoye,
        elements: [`Offre saisie en ligne : ${euros(controle.saisie.montant_base)} HT (${lotLibelleDe(ctx, lotId)})`], empreintes: [],
      });
      setMontant(''); setDelai(''); setObservations(''); setLignes([]);
    } catch (err: any) {
      setErreur(err?.message || 'La saisie n’a pas pu être enregistrée.');
    } finally { setEnCours(false); }
  };

  return (
    <section aria-label="Saisir mon offre" className="rounded-lg p-4 space-y-3" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider">Saisir mon offre en ligne</h2>
      {ctx.lots.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>Aucun lot ne vous est rattaché : déposez vos documents ci-dessous.</p>
      ) : (
        <form onSubmit={envoyer} className="space-y-3">
          <label className="block text-sm">
            <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Lot</span>
            <select className={CHAMP} style={CHAMP_STYLE} value={lotId} onChange={e => setLotId(e.target.value)} required>
              <option value="">Choisir un lot…</option>
              {ctx.lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} : {l.lot_title}</option>)}
            </select>
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Montant de base HT (€)</span>
              <input className={CHAMP} style={CHAMP_STYLE} inputMode="decimal" value={montant} onChange={e => setMontant(e.target.value)} placeholder="ex. 12 345,50" required />
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Délai d’exécution (semaines, facultatif)</span>
              <input className={CHAMP} style={CHAMP_STYLE} inputMode="numeric" value={delai} onChange={e => setDelai(e.target.value)} />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>Options et variantes (facultatif)</legend>
            {lignes.map((l, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_8rem_auto] gap-2 items-center">
                <select aria-label="Nature" className={CHAMP} style={CHAMP_STYLE} value={l.kind}
                  onChange={e => setLignes(prev => prev.map((x, j) => j === i ? { ...x, kind: e.target.value as 'option' | 'variante' } : x))}>
                  <option value="option">Option</option><option value="variante">Variante</option>
                </select>
                <input aria-label="Intitulé" className={CHAMP} style={CHAMP_STYLE} placeholder="Intitulé" value={l.libelle}
                  onChange={e => setLignes(prev => prev.map((x, j) => j === i ? { ...x, libelle: e.target.value } : x))} />
                <input aria-label="Montant HT" className={CHAMP} style={CHAMP_STYLE} inputMode="decimal" placeholder="€ HT" value={l.montant}
                  onChange={e => setLignes(prev => prev.map((x, j) => j === i ? { ...x, montant: e.target.value } : x))} />
                <button type="button" aria-label="Retirer cette ligne" className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => setLignes(prev => prev.filter((_, j) => j !== i))}><IconTrash size={15} aria-hidden /></button>
              </div>
            ))}
            {lignes.length < MAX_LIGNES_SAISIE && (
              <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold underline min-h-11"
                onClick={() => setLignes(prev => [...prev, { kind: 'option', libelle: '', montant: '' }])}><IconPlus size={13} aria-hidden /> Ajouter une option ou une variante</button>
            )}
          </fieldset>

          <label className="block text-sm">
            <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Observations (facultatif)</span>
            <textarea className={CHAMP} style={CHAMP_STYLE} rows={3} maxLength={2000} value={observations} onChange={e => setObservations(e.target.value)} />
          </label>

          {erreur && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{erreur}</p>}
          <button type="submit" disabled={enCours} className={`${BOUTON} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`}>
            {enCours ? <IconLoader2 size={15} className="animate-spin" aria-hidden /> : <IconCheck size={15} aria-hidden />} Envoyer mon offre
          </button>
        </form>
      )}
    </section>
  );
}

const lotLibelleDe = (ctx: Contexte, id: string) => {
  const l = ctx.lots.find(x => x.id === id);
  return l ? `Lot ${l.lot_number} ${l.lot_title}` : 'Tous lots';
};

// ── Dépôt de documents ───────────────────────────────────────────────────────

function DepotFichiers({ base, ctx, onRecu }: { base: string; ctx: Contexte; onRecu: (r: Recu) => void }) {
  const [kind, setKind] = useState<Exclude<DepotKind, 'saisie'>>('fichier');
  const [lotId, setLotId] = useState(ctx.lots.length === 1 ? ctx.lots[0].id : '');
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [progression, setProgression] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  const choisir = (liste: FileList | File[] | null) => {
    if (!liste) return;
    const suivant = [...fichiers, ...Array.from(liste)].slice(0, MAX_FICHIERS_PAR_DEPOT);
    setFichiers(suivant);
    const c = controlerLot(suivant.map(f => ({ name: f.name, size: f.size })));
    setErreur(c.ok ? null : c.raison);
  };

  const exigeUnSeul = kind === 'bordereau' || kind === 'acte';
  const accept = kind === 'acte' ? '.pdf' : kind === 'bordereau' ? DEPOT_TABLEURS.map(e => `.${e}`).join(',') : DEPOT_ACCEPT;

  const envoyer = () => {
    setErreur(null);
    const c = controlerLot(fichiers.map(f => ({ name: f.name, size: f.size })));
    if (!c.ok) return setErreur(c.raison);
    if (exigeUnSeul && fichiers.length !== 1) return setErreur(kind === 'acte' ? 'L’acte d’engagement se remet en un seul PDF.' : 'Le bordereau chiffré se remet en un seul fichier Excel ou ODS.');
    if (kind === 'acte' && extensionDe(fichiers[0].name) !== 'pdf') return setErreur('L’acte d’engagement se remet en PDF.');
    if (kind === 'bordereau' && !(DEPOT_TABLEURS as string[]).includes(extensionDe(fichiers[0].name))) return setErreur('Le bordereau chiffré se remet en Excel (.xlsx) ou ODS.');
    if (kind === 'bordereau' && !lotId) return setErreur('Choisissez le lot concerné par ce bordereau.');

    const formulaire = new FormData();
    formulaire.append('kind', kind);
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
          recu_le: corps.recu_le, hors_delai: corps.hors_delai, accuse_envoye: corps.accuse_envoye,
          elements: (corps.depots || []).map((d: any) => `${d.nom} (${formatOctets(d.taille)})`),
          empreintes: (corps.depots || []).map((d: any) => d.sha256),
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
        Formats acceptés : PDF, Word (.docx), Excel (.xlsx), ODS et ODT. {MAX_FICHIERS_PAR_DEPOT} fichiers au plus par dépôt, {formatOctets(MAX_FICHIER_OCTETS)} par fichier, {formatOctets(MAX_DEPOT_OCTETS)} au total. Les plans DWG et DXF ne sont pas acceptés : joignez-les en PDF.
      </p>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">Nature du dépôt</legend>
        {([['fichier', 'Pièces jointes (devis, mémoire…)'], ['bordereau', 'Bordereau chiffré'], ['acte', 'Acte d’engagement signé']] as const).map(([k, l]) => (
          <label key={k} className="inline-flex items-center gap-2 min-h-11">
            <input type="radio" name="nature" checked={kind === k} onChange={() => { setKind(k); setFichiers([]); setErreur(null); }} /> {l}
          </label>
        ))}
      </fieldset>

      <label className="block text-sm">
        <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Lot concerné {kind === 'bordereau' ? '' : '(facultatif : laissez vide pour tous vos lots)'}</span>
        <select className={CHAMP} style={CHAMP_STYLE} value={lotId} onChange={e => setLotId(e.target.value)}>
          <option value="">Tous lots</option>
          {ctx.lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} : {l.lot_title}</option>)}
        </select>
      </label>

      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); choisir(e.dataTransfer.files); }}
        className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer"
        style={{ borderColor: 'var(--tblr-border)' }}
        onClick={() => champ.current?.click()}
      >
        <IconFilePlus size={24} className="mx-auto mb-1" aria-hidden />
        <p className="text-sm">Glissez vos fichiers ici ou <span className="underline font-bold">parcourez</span></p>
        <input ref={champ} type="file" className="sr-only" aria-label="Choisir des fichiers" multiple={!exigeUnSeul} accept={accept}
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
