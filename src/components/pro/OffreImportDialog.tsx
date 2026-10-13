// Anciennement BPUImportDialog : sert désormais aussi bien un DPGF qu'un
// BPU/DQE — les deux partagent le même arbre lots > chapitres > articles
// (lib/bpuImport.ts, généralisé pour ne plus dépendre du seul type BPU), donc
// la même mécanique de rapprochement s'applique aux deux sans duplication.
import React, { useState, useMemo, useCallback } from 'react';
import {
  IconX, IconUpload, IconAlertTriangle, IconCheck, IconArrowRight, IconLoader2,
} from '@tabler/icons-react';
import type { OffreDocument, OffreAnomalie, Lot } from '../../types/dpgf';
import { postesDepuisLignes, totalPostesAjoutes } from '../../lib/postesAjoutes';
import { parseOffreFile, type DocumentAvecArticles, type ResultatImport, type Rapprochement, type LigneImportee } from '../../lib/bpuImport';
import { formatCurrency } from '../../lib/utils';

interface Entreprise { id: string; nom: string }

interface Props {
  doc: DocumentAvecArticles;
  /** « bordereau » (BPU/DQE) ou « DPGF », pour les deux messages qui le nomment. */
  docLabel?: string;
  /** Entreprises déjà consultées (act_data.consultation.entreprises). */
  entreprises?: Entreprise[];
  /**
   * « offre » : le fichier est le bordereau chiffré d'une entreprise.
   * « document » : le fichier remplit un DPGF, un CCTP, un DQE ou un BPU encore
   * vierge ; pas d'entreprise, et les lignes sans article deviennent des articles.
   */
  mode?: 'offre' | 'document';
  onClose: () => void;
  onConfirm?: (offre: Omit<OffreDocument, 'id' | 'importedAt'>) => Promise<void> | void;
  /** Mode « document » : reçoit les lignes du fichier à créer comme articles. */
  onCreerPostes?: (sources: LigneImportee[]) => Promise<void> | void;
  /** Fichier déjà en main (bordereau remis sur le portail de dépôt) : évite de le re-sélectionner. */
  fichierInitial?: File;
  /** Entreprise connue d'avance (celle du lien de dépôt) et date de réception réelle. */
  entrepriseInitiale?: { id?: string; nom: string };
  dateReceptionInitiale?: string;
}

type Etape = 'fichier' | 'rapprochement';

/** Valeur du menu « Rattacher à… » qui crée un poste au lieu de rattacher la ligne. */
const CREER = '__creer__';

const EXTENSIONS_ACCEPTEES = ['.xlsx', '.ods', '.xls', '.csv'];

const CONFIANCE_STYLE: Record<string, string> = {
  exacte: 'bg-green-100 text-green-800',
  haute: 'bg-sky-100 text-sky-800',
  basse: 'bg-amber-100 text-amber-800',
};
const CONFIANCE_LABEL: Record<string, string> = {
  exacte: 'Référence', haute: 'Sûr', basse: 'À confirmer',
};

export const OffreImportDialog: React.FC<Props> = ({
  doc, docLabel = 'bordereau', entreprises = [], mode = 'offre', onClose, onConfirm, onCreerPostes,
  fichierInitial, entrepriseInitiale, dateReceptionInitiale,
}) => {
  const [etape, setEtape] = useState<Etape>('fichier');
  const [fichier, setFichier] = useState<File | null>(fichierInitial ?? null);
  const [entrepriseNom, setEntrepriseNom] = useState(entrepriseInitiale?.nom ?? '');
  const [entrepriseId, setEntrepriseId] = useState<string | undefined>(entrepriseInitiale?.id);
  const [dateReception, setDateReception] = useState(dateReceptionInitiale ?? new Date().toISOString().slice(0, 10));
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const modeDocument = mode === 'document';
  // Glisser-déposer d'un fichier sur la zone : sans gestionnaire, le navigateur ouvre le
  // fichier à la place de la page.
  const [survol, setSurvol] = useState(false);
  const choisirFichier = (f: File | null | undefined) => {
    if (!f) return;
    if (!EXTENSIONS_ACCEPTEES.some(ext => f.name.toLowerCase().endsWith(ext))) {
      setErreur(`Format non pris en charge (${f.name}). Déposez un fichier ${EXTENSIONS_ACCEPTEES.join(', ')}.`);
      return;
    }
    setFichier(f); setErreur(null);
  };

  // Un rapprochement approximatif ne compte que si l'architecte l'a coché.
  const [approxValides, setApproxValides] = useState<Set<number>>(new Set());
  // Rattachements faits à la main depuis les lignes non appariées.
  const [manuels, setManuels] = useState<Map<number, string>>(new Map());
  const [ignorees, setIgnorees] = useState<Set<number>>(new Set());

  /** Tous les articles chiffrables, pour les listes de rattachement manuel. */
  const articles = useMemo(() => {
    const out: { id: string; numero: string; designation: string }[] = [];
    const walk = (lignes: any[]) => lignes.forEach(l => {
      if (l.children?.length) { walk(l.children); return; }
      out.push({ id: l.id, numero: l.numero, designation: l.designation });
    });
    doc.lots.forEach(lot => lot.chapitres.forEach(c => walk(c.lignes)));
    return out;
  }, [doc]);

  const lancerAnalyse = useCallback(async () => {
    if (!fichier) return;
    setAnalyse(true); setErreur(null);
    try {
      const r = await parseOffreFile(fichier, doc, { prixOptionnel: modeDocument });
      if (r.rapprochements.length === 0 && r.nonAppariees.length === 0) {
        setErreur(modeDocument
          ? "Aucune ligne n'a pu être lue dans ce fichier. Vérifiez qu'il contient bien une colonne de désignation."
          : "Aucune ligne de prix n'a pu être lue dans ce fichier. Vérifiez qu'il contient bien "
            + "une colonne de désignation et une colonne de prix unitaire.",
        );
      } else {
        setResultat(r);
        // Les rapprochements sûrs sont retenus d'office ; les approximatifs
        // attendent une confirmation explicite.
        setApproxValides(new Set());
        // Dans un document vierge, tout ce qui n'existe pas encore est à créer.
        setManuels(modeDocument ? new Map(r.nonAppariees.map((_, i) => [i, CREER] as [number, string])) : new Map());
        setIgnorees(new Set());
        setEtape('rapprochement');
      }
    } catch (e: any) {
      setErreur(e?.message || 'Fichier illisible.');
    } finally {
      setAnalyse(false);
    }
  }, [fichier, doc, modeDocument]);

  // ── Décompte et total, tels qu'ils seront enregistrés ──────────────────────
  const retenus = useMemo(() => {
    if (!resultat) return [] as Rapprochement[];
    return resultat.rapprochements.filter((r, i) => r.confiance !== 'basse' || approxValides.has(i));
  }, [resultat, approxValides]);

  const quantiteParArticle = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (lignes: any[]) => lignes.forEach(l => {
      if (l.children?.length) { walk(l.children); return; }
      m.set(l.id, l.quantite || 0);
    });
    doc.lots.forEach(lot => lot.chapitres.forEach(c => walk(c.lignes)));
    return m;
  }, [doc]);

  const prixFinal = useMemo(() => {
    const prix: Record<string, number | null> = {};
    for (const r of retenus) prix[r.articleId] = r.prixUnitaire;
    if (resultat) {
      for (const [idx, articleId] of manuels) {
        if (articleId === CREER) continue;
        const src = resultat.nonAppariees[idx];
        if (src && !ignorees.has(idx)) prix[articleId] = src.prixUnitaire;
      }
    }
    return prix;
  }, [retenus, manuels, ignorees, resultat]);

  // Lignes du fichier à créer comme postes (offre) ou comme articles (document).
  const aCreer = useMemo(
    () => (resultat?.nonAppariees ?? []).filter((_, i) => manuels.get(i) === CREER && !ignorees.has(i)),
    [resultat, manuels, ignorees],
  );
  const postesCrees = useMemo(
    () => (modeDocument ? [] : postesDepuisLignes(aCreer, doc.lots as Lot[])),
    [aCreer, doc.lots, modeDocument],
  );
  const totalPostes = totalPostesAjoutes(postesCrees);

  const toutCreer = () => setManuels(prev => {
    const m = new Map(prev);
    resultat?.nonAppariees.forEach((_, i) => { if (!m.has(i) && !ignorees.has(i)) m.set(i, CREER); });
    return m;
  });
  const defaireCreations = () => setManuels(prev => {
    const m = new Map(prev);
    for (const [i, v] of prev) if (v === CREER) m.delete(i);
    return m;
  });

  const totalOffre = useMemo(
    () => Object.entries(prixFinal).reduce(
      (s, [id, pu]) => s + (pu != null ? pu * (quantiteParArticle.get(id) ?? 0) : 0), 0,
    ),
    [prixFinal, quantiteParArticle],
  );

  const ecartEstimation = doc.totalHT > 0 ? (totalOffre - doc.totalHT) / doc.totalHT * 100 : null;
  const nbNonChiffres = articles.length - Object.values(prixFinal).filter(p => p != null).length;
  const nbAConfirmer = resultat
    ? resultat.rapprochements.filter((r, i) => r.confiance === 'basse' && !approxValides.has(i)).length : 0;
  const nbNonRattachees = resultat
    ? resultat.nonAppariees.filter((_, i) => !manuels.has(i) && !ignorees.has(i)).length : 0;

  const valider = async () => {
    if (!resultat || !fichier) return;
    setEnregistrement(true);
    try {
      if (modeDocument) {
        await onCreerPostes?.(aCreer);
        onClose();
        return;
      }
      const anomalies: OffreAnomalie[] = [];
      for (const r of retenus) {
        for (const a of r.alertes) {
          anomalies.push({
            articleId: r.articleId,
            code: a.startsWith('Unité') ? 'unite_differente'
              : a.startsWith('Désignation') ? 'designation_modifiee'
              : a.startsWith('Quantité') ? 'quantite_modifiee'
              : a === 'Poste non chiffré' ? 'pu_manquant'
              : a === 'Prix unitaire à zéro' ? 'pu_zero'
              : 'pu_aberrant',
            message: `${r.articleNumero} — ${a}`,
          });
        }
      }
      // Un poste créé garde sa trace dans les anomalies de l'offre.
      for (const p of postesCrees) {
        anomalies.push({
          articleId: p.id, code: 'ligne_ajoutee',
          message: `Poste ajouté par l'entreprise : ${p.numero} ${p.designation}`,
        });
      }
      for (const [idx] of resultat.nonAppariees.entries()) {
        if (!manuels.has(idx) && !ignorees.has(idx)) {
          const l = resultat.nonAppariees[idx];
          anomalies.push({
            rowIndex: l.rowIndex, code: 'ligne_ajoutee',
            message: `Ligne du fichier non rattachée : ${l.numero} ${l.designation}`,
          });
        }
      }

      await onConfirm?.({
        entrepriseId, entrepriseNom: entrepriseNom.trim(),
        dateReception, fichierNom: fichier.name,
        documentVersion: doc.version,
        prix: prixFinal, anomalies,
        ...(postesCrees.length ? { postesAjoutes: postesCrees } : {}),
        totalOffreHT: totalOffre + totalPostes,
        statut: 'validee',
      });
      onClose();
    } catch (e: any) {
      setErreur(e?.message || "L'enregistrement de l'offre a échoué.");
      setEnregistrement(false);
    }
  };

  const champ = 'px-2 py-1.5 text-sm border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none w-full';
  const label = 'block text-[0.6875rem] font-semibold text-zinc-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}
         onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[90dvh] flex flex-col"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold">
            {modeDocument ? `Importer un fichier dans le ${docLabel}` : 'Importer une offre'}
            {etape === 'rapprochement' && ' — rapprochement'}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><IconX size={18} /></button>
        </div>

        {erreur && (
          <div className="mx-5 mt-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{erreur}</span>
          </div>
        )}

        {/* ── Étape 1 : le fichier et son émetteur ────────────────────────── */}
        {etape === 'fichier' && (
          <div className="p-5 space-y-4">
            <div>
              <label className={label}>
                {modeDocument
                  ? `Fichier à importer dans le ${docLabel} (lots, chapitres et articles)`
                  : `${docLabel[0].toUpperCase() + docLabel.slice(1)} chiffré renvoyé par l'entreprise`}
              </label>
              <label
                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${survol ? 'border-blue-500 bg-blue-50' : 'border-zinc-300 hover:border-blue-400'}`}
                onDragEnter={e => { e.preventDefault(); setSurvol(true); }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setSurvol(true); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSurvol(false); }}
                onDrop={e => { e.preventDefault(); setSurvol(false); choisirFichier(e.dataTransfer.files?.[0]); }}>
                <IconUpload size={22} className="text-zinc-400" />
                <span className="text-sm text-zinc-600">{fichier ? fichier.name : 'Glisser un fichier ici ou cliquer pour le choisir (.xlsx, .ods, .xls, .csv)'}</span>
                <input type="file" accept={EXTENSIONS_ACCEPTEES.join(',')} className="hidden"
                       onChange={e => { choisirFichier(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <p className="mt-2 text-[0.6875rem] text-zinc-400">
                {modeDocument
                  ? 'Les lignes qui ne sont pas déjà dans le document pourront être créées comme articles, rangées sous leur lot.'
                  : "Une offre reçue en PDF se saisit à la main sur l'écran suivant, dans la même structure."}
              </p>
            </div>

            {!modeDocument && <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Entreprise</label>
                {entreprises.length > 0 ? (
                  <select className={champ} value={entrepriseId ?? '__saisie__'}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === '__saisie__') { setEntrepriseId(undefined); setEntrepriseNom(''); }
                            else { setEntrepriseId(v); setEntrepriseNom(entreprises.find(x => x.id === v)?.nom ?? ''); }
                          }}>
                    <option value="__saisie__">Saisir un nom…</option>
                    {entreprises.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
                  </select>
                ) : null}
                {!entrepriseId && (
                  <input className={`${champ} ${entreprises.length ? 'mt-2' : ''}`} placeholder="Nom de l'entreprise"
                         value={entrepriseNom} onChange={e => setEntrepriseNom(e.target.value)} />
                )}
              </div>
              <div>
                <label className={label}>Date de réception</label>
                <input type="date" className={champ} value={dateReception} onChange={e => setDateReception(e.target.value)} />
              </div>
            </div>}
          </div>
        )}

        {/* ── Étape 2 : le rapprochement, avant toute écriture ─────────────── */}
        {etape === 'rapprochement' && resultat && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Décompte et écart : le seul chiffre qui dit d'un coup d'œil si
                l'import est cohérent. */}
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="text-green-700 font-semibold">
                {retenus.length} {modeDocument ? 'déjà dans le document' : 'rattaché(s)'}
              </span>
              {aCreer.length > 0 && (
                <span className="text-violet-700 font-semibold">
                  {aCreer.length} {modeDocument ? 'à créer' : 'poste(s) créé(s)'}
                </span>
              )}
              {nbAConfirmer > 0 && <span className="text-amber-700 font-semibold">{nbAConfirmer} à confirmer</span>}
              {nbNonRattachees > 0 && <span className="text-red-600 font-semibold">{nbNonRattachees} non rattaché(s)</span>}
              {nbNonChiffres > 0 && <span className="text-zinc-500">{nbNonChiffres} article(s) non chiffré(s)</span>}
              {!modeDocument && <span className="ml-auto font-mono">
                Total de l'offre : <strong>{formatCurrency(totalOffre + totalPostes)}</strong>
                {totalPostes > 0 && (
                  <span className="text-violet-700 ml-2">dont {formatCurrency(totalPostes)} de postes ajoutés</span>
                )}
                {ecartEstimation != null && (
                  <span className={ecartEstimation > 0 ? 'text-red-600 ml-2' : 'text-green-700 ml-2'}>
                    {ecartEstimation > 0 ? '+' : ''}{ecartEstimation.toFixed(1)} % / estimation
                  </span>
                )}
              </span>}
            </div>

            {!resultat.meta.correspond && !modeDocument && (
              <div className="mx-5 mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Ce fichier ne semble pas issu de la version courante de ce {docLabel}
                  {resultat.meta.version && ` (version ${resultat.meta.version})`}. Vérifiez les
                  rattachements avant de valider.
                </span>
              </div>
            )}

            <div className="flex-1 overflow-auto px-5 py-3">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-left text-zinc-500 border-b border-zinc-200">
                    <th className="py-1.5 pr-2 w-8"></th>
                    <th className="py-1.5 pr-2 w-20">N°</th>
                    <th className="py-1.5 pr-2">Désignation</th>
                    <th className="py-1.5 pr-2 w-14">Unité</th>
                    <th className="py-1.5 pr-2 w-24 text-right">Estim. P.U.</th>
                    <th className="py-1.5 pr-2 w-24 text-right">P.U. remis</th>
                    <th className="py-1.5 pr-2 w-20 text-right">Écart</th>
                    <th className="py-1.5 pr-2 w-24">Rattachement</th>
                  </tr>
                </thead>
                <tbody>
                  {resultat.rapprochements.map((r, i) => {
                    const doitConfirmer = r.confiance === 'basse';
                    const retenu = !doitConfirmer || approxValides.has(i);
                    const ecart = r.prixUnitaire != null && r.estimation > 0
                      ? (r.prixUnitaire - r.estimation) / r.estimation * 100 : null;
                    return (
                      <tr key={i} className={`border-b border-zinc-100 ${retenu ? '' : 'opacity-50'}`}>
                        <td className="py-1 pr-2">
                          {doitConfirmer ? (
                            <input type="checkbox" checked={approxValides.has(i)}
                                   onChange={() => setApproxValides(prev => {
                                     const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s;
                                   })} />
                          ) : <IconCheck size={13} className="text-green-600" />}
                        </td>
                        <td className="py-1 pr-2 text-zinc-400">{r.articleNumero}</td>
                        <td className="py-1 pr-2">
                          <div className="truncate max-w-[280px]">{r.articleDesignation}</div>
                          {r.alertes.length > 0 && (
                            <div className="text-[0.6875rem] text-amber-700 flex items-center gap-1">
                              <IconAlertTriangle size={10} /> {r.alertes.join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-zinc-500">{r.articleUnite}</td>
                        <td className="py-1 pr-2 text-right font-mono text-zinc-400">
                          {r.estimation > 0 ? formatCurrency(r.estimation) : ''}
                        </td>
                        <td className="py-1 pr-2 text-right font-mono font-medium">
                          {r.prixUnitaire == null
                            ? <span className="text-zinc-300" title="Non chiffré">—</span>
                            : formatCurrency(r.prixUnitaire)}
                        </td>
                        <td className={`py-1 pr-2 text-right font-mono ${ecart == null ? '' : ecart > 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {ecart == null ? '' : `${ecart > 0 ? '+' : ''}${ecart.toFixed(0)} %`}
                        </td>
                        <td className="py-1 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold ${CONFIANCE_STYLE[r.confiance] ?? ''}`}>
                            {CONFIANCE_LABEL[r.confiance] ?? r.confiance}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Lignes du fichier sans article : rattachement à la main. */}
              {resultat.nonAppariees.length > 0 && (
                <div className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">
                      {modeDocument ? 'Lignes du fichier absentes du document' : 'Lignes du fichier non rattachées'} ({resultat.nonAppariees.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={toutCreer}
                              className="px-2 py-1 text-[0.6875rem] rounded border border-violet-300 text-violet-800 hover:bg-violet-50">
                        {modeDocument ? 'Tout créer' : 'Créer un poste pour toutes les lignes non rattachées'}
                      </button>
                      {aCreer.length > 0 && (
                        <button type="button" onClick={defaireCreations}
                                className="px-2 py-1 text-[0.6875rem] rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50">
                          Défaire les créations
                        </button>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {resultat.nonAppariees.map((l, i) => (
                        <tr key={i} className={`border-b border-zinc-100 ${ignorees.has(i) ? 'opacity-40' : manuels.get(i) === CREER ? 'bg-violet-50' : ''}`}>
                          <td className="py-1 pr-2 text-zinc-400 w-20">{l.numero || l.ref}</td>
                          <td className="py-1 pr-2"><div className="truncate max-w-[240px]">{l.designation}</div></td>
                          <td className="py-1 pr-2 w-14 text-zinc-500">{l.unite}</td>
                          <td className="py-1 pr-2 w-24 text-right font-mono">
                            {l.prixUnitaire == null ? '—' : formatCurrency(l.prixUnitaire)}
                          </td>
                          <td className="py-1 pr-2 w-64">
                            <select
                              className="w-full px-1 py-0.5 text-[0.6875rem] border border-zinc-300 rounded"
                              value={manuels.get(i) ?? ''}
                              disabled={ignorees.has(i)}
                              onChange={e => setManuels(prev => {
                                const m = new Map(prev);
                                e.target.value ? m.set(i, e.target.value) : m.delete(i);
                                return m;
                              })}
                            >
                              <option value="">Rattacher à…</option>
                              <option value={CREER}>
                                {modeDocument ? '+ Créer un article' : '+ Créer un poste (non prévu au marché)'}
                              </option>
                              {articles.map(a => (
                                <option key={a.id} value={a.id}>{a.numero} — {a.designation}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 w-16 text-right">
                            <button
                              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline"
                              onClick={() => setIgnorees(prev => {
                                const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s;
                              })}
                            >
                              {ignorees.has(i) ? 'Rétablir' : 'Ignorer'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Pied de modale ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <span className="text-[0.6875rem] text-zinc-400">
            {etape === 'rapprochement' && (modeDocument
              ? 'Rien n’est ajouté au document tant que vous n’avez pas validé.'
              : 'Rien n’est enregistré tant que vous n’avez pas validé.')}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50">
              Annuler
            </button>
            {etape === 'fichier' ? (
              <button
                onClick={lancerAnalyse}
                disabled={!fichier || (!modeDocument && !entrepriseNom.trim()) || analyse}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {analyse ? <IconLoader2 size={13} className="animate-spin" /> : <IconArrowRight size={13} />}
                Analyser le fichier
              </button>
            ) : (
              <button
                onClick={valider}
                disabled={enregistrement || (modeDocument ? aCreer.length === 0 : retenus.length === 0 && aCreer.length === 0)}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {enregistrement ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} />}
                {modeDocument ? `Ajouter ${aCreer.length} article(s) au ${docLabel}` : "Enregistrer l'offre"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
