import React, { useState, useMemo, useCallback } from 'react';
import {
  IconX, IconUpload, IconAlertTriangle, IconCheck, IconArrowRight, IconLoader2,
} from '@tabler/icons-react';
import type { BPU, OffreBPU, OffreAnomalie } from '../../types/bpu';
import { parseOffreFile, type ResultatImport, type Rapprochement } from '../../lib/bpuImport';
import { formatCurrency } from '../../lib/utils';

interface Entreprise { id: string; nom: string }

interface Props {
  bpu: BPU;
  /** Entreprises déjà consultées (act_data.consultation.entreprises). */
  entreprises?: Entreprise[];
  onClose: () => void;
  onConfirm: (offre: Omit<OffreBPU, 'id' | 'importedAt'>) => Promise<void> | void;
}

type Etape = 'fichier' | 'rapprochement';

const CONFIANCE_STYLE: Record<string, string> = {
  exacte: 'bg-green-100 text-green-800',
  haute: 'bg-sky-100 text-sky-800',
  basse: 'bg-amber-100 text-amber-800',
};
const CONFIANCE_LABEL: Record<string, string> = {
  exacte: 'Référence', haute: 'Sûr', basse: 'À confirmer',
};

export const BPUImportDialog: React.FC<Props> = ({ bpu, entreprises = [], onClose, onConfirm }) => {
  const [etape, setEtape] = useState<Etape>('fichier');
  const [fichier, setFichier] = useState<File | null>(null);
  const [entrepriseNom, setEntrepriseNom] = useState('');
  const [entrepriseId, setEntrepriseId] = useState<string | undefined>();
  const [dateReception, setDateReception] = useState(new Date().toISOString().slice(0, 10));
  const [resultat, setResultat] = useState<ResultatImport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);

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
    bpu.lots.forEach(lot => lot.chapitres.forEach(c => walk(c.lignes)));
    return out;
  }, [bpu]);

  const lancerAnalyse = useCallback(async () => {
    if (!fichier) return;
    setAnalyse(true); setErreur(null);
    try {
      const r = await parseOffreFile(fichier, bpu);
      if (r.rapprochements.length === 0 && r.nonAppariees.length === 0) {
        setErreur(
          "Aucune ligne de prix n'a pu être lue dans ce fichier. Vérifiez qu'il contient bien "
          + "une colonne de désignation et une colonne de prix unitaire.",
        );
      } else {
        setResultat(r);
        // Les rapprochements sûrs sont retenus d'office ; les approximatifs
        // attendent une confirmation explicite.
        setApproxValides(new Set());
        setEtape('rapprochement');
      }
    } catch (e: any) {
      setErreur(e?.message || 'Fichier illisible.');
    } finally {
      setAnalyse(false);
    }
  }, [fichier, bpu]);

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
    bpu.lots.forEach(lot => lot.chapitres.forEach(c => walk(c.lignes)));
    return m;
  }, [bpu]);

  const prixFinal = useMemo(() => {
    const prix: Record<string, number | null> = {};
    for (const r of retenus) prix[r.articleId] = r.prixUnitaire;
    if (resultat) {
      for (const [idx, articleId] of manuels) {
        const src = resultat.nonAppariees[idx];
        if (src && !ignorees.has(idx)) prix[articleId] = src.prixUnitaire;
      }
    }
    return prix;
  }, [retenus, manuels, ignorees, resultat]);

  const totalOffre = useMemo(
    () => Object.entries(prixFinal).reduce(
      (s, [id, pu]) => s + (pu != null ? pu * (quantiteParArticle.get(id) ?? 0) : 0), 0,
    ),
    [prixFinal, quantiteParArticle],
  );

  const ecartEstimation = bpu.totalHT > 0 ? (totalOffre - bpu.totalHT) / bpu.totalHT * 100 : null;
  const nbNonChiffres = articles.length - Object.values(prixFinal).filter(p => p != null).length;
  const nbAConfirmer = resultat
    ? resultat.rapprochements.filter((r, i) => r.confiance === 'basse' && !approxValides.has(i)).length : 0;
  const nbNonRattachees = resultat
    ? resultat.nonAppariees.filter((_, i) => !manuels.has(i) && !ignorees.has(i)).length : 0;

  const valider = async () => {
    if (!resultat || !fichier) return;
    setEnregistrement(true);
    try {
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
      for (const [idx] of resultat.nonAppariees.entries()) {
        if (!manuels.has(idx) && !ignorees.has(idx)) {
          const l = resultat.nonAppariees[idx];
          anomalies.push({
            rowIndex: l.rowIndex, code: 'ligne_ajoutee',
            message: `Ligne du fichier non rattachée : ${l.numero} ${l.designation}`,
          });
        }
      }

      await onConfirm({
        entrepriseId, entrepriseNom: entrepriseNom.trim(),
        dateReception, fichierNom: fichier.name,
        bpuVersion: bpu.version,
        prix: prixFinal, anomalies,
        totalOffreHT: totalOffre,
        statut: 'validee',
      });
      onClose();
    } catch (e: any) {
      setErreur(e?.message || "L'enregistrement de l'offre a échoué.");
      setEnregistrement(false);
    }
  };

  const champ = 'px-2 py-1.5 text-sm border border-zinc-300 rounded focus:ring-1 focus:ring-blue-400 outline-none w-full';
  const label = 'block text-[11px] font-semibold text-zinc-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold">
            Importer une offre {etape === 'rapprochement' && '— rapprochement'}
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
              <label className={label}>Bordereau chiffré renvoyé par l'entreprise</label>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-zinc-300 rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors">
                <IconUpload size={22} className="text-zinc-400" />
                <span className="text-sm text-zinc-600">{fichier ? fichier.name : 'Choisir un fichier .xlsx, .xls ou .csv'}</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                       onChange={e => { setFichier(e.target.files?.[0] ?? null); setErreur(null); }} />
              </label>
              <p className="mt-2 text-[11px] text-zinc-400">
                Une offre reçue en PDF se saisit à la main sur l'écran suivant, dans la même structure.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
            </div>
          </div>
        )}

        {/* ── Étape 2 : le rapprochement, avant toute écriture ─────────────── */}
        {etape === 'rapprochement' && resultat && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Décompte et écart : le seul chiffre qui dit d'un coup d'œil si
                l'import est cohérent. */}
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="text-green-700 font-semibold">{retenus.length} rattaché(s)</span>
              {nbAConfirmer > 0 && <span className="text-amber-700 font-semibold">{nbAConfirmer} à confirmer</span>}
              {nbNonRattachees > 0 && <span className="text-red-600 font-semibold">{nbNonRattachees} non rattaché(s)</span>}
              {nbNonChiffres > 0 && <span className="text-zinc-500">{nbNonChiffres} article(s) non chiffré(s)</span>}
              <span className="ml-auto font-mono">
                Total de l'offre : <strong>{formatCurrency(totalOffre)}</strong>
                {ecartEstimation != null && (
                  <span className={ecartEstimation > 0 ? 'text-red-600 ml-2' : 'text-green-700 ml-2'}>
                    {ecartEstimation > 0 ? '+' : ''}{ecartEstimation.toFixed(1)} % / estimation
                  </span>
                )}
              </span>
            </div>

            {!resultat.meta.correspond && (
              <div className="mx-5 mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                <IconAlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Ce fichier ne semble pas issu de la version courante de ce bordereau
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
                            <div className="text-[10px] text-amber-700 flex items-center gap-1">
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
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${CONFIANCE_STYLE[r.confiance] ?? ''}`}>
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
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                    Lignes du fichier non rattachées ({resultat.nonAppariees.length})
                  </h3>
                  <table className="w-full text-xs border-collapse">
                    <tbody>
                      {resultat.nonAppariees.map((l, i) => (
                        <tr key={i} className={`border-b border-zinc-100 ${ignorees.has(i) ? 'opacity-40' : ''}`}>
                          <td className="py-1 pr-2 text-zinc-400 w-20">{l.numero || l.ref}</td>
                          <td className="py-1 pr-2"><div className="truncate max-w-[240px]">{l.designation}</div></td>
                          <td className="py-1 pr-2 w-14 text-zinc-500">{l.unite}</td>
                          <td className="py-1 pr-2 w-24 text-right font-mono">
                            {l.prixUnitaire == null ? '—' : formatCurrency(l.prixUnitaire)}
                          </td>
                          <td className="py-1 pr-2 w-64">
                            <select
                              className="w-full px-1 py-0.5 text-[11px] border border-zinc-300 rounded"
                              value={manuels.get(i) ?? ''}
                              disabled={ignorees.has(i)}
                              onChange={e => setManuels(prev => {
                                const m = new Map(prev);
                                e.target.value ? m.set(i, e.target.value) : m.delete(i);
                                return m;
                              })}
                            >
                              <option value="">Rattacher à…</option>
                              {articles.map(a => (
                                <option key={a.id} value={a.id}>{a.numero} — {a.designation}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 w-16 text-right">
                            <button
                              className="text-[10px] text-zinc-400 hover:text-zinc-700 underline"
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
          <span className="text-[11px] text-zinc-400">
            {etape === 'rapprochement' && 'Rien n’est enregistré tant que vous n’avez pas validé.'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50">
              Annuler
            </button>
            {etape === 'fichier' ? (
              <button
                onClick={lancerAnalyse}
                disabled={!fichier || !entrepriseNom.trim() || analyse}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {analyse ? <IconLoader2 size={13} className="animate-spin" /> : <IconArrowRight size={13} />}
                Analyser le fichier
              </button>
            ) : (
              <button
                onClick={valider}
                disabled={enregistrement || retenus.length === 0}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {enregistrement ? <IconLoader2 size={13} className="animate-spin" /> : <IconCheck size={13} />}
                Enregistrer l'offre
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
