// ── Bibliothèque d'ouvrages ──────────────────────────────────────────────────
// Cette page était un éditeur de documents « cahier des charges », doublon de
// l'onglet CCTP/DPGF des projets. Elle est devenue le fonds d'articles du
// cabinet : la base dans laquelle les CCTP, DPGF et DQE viendront puiser.
//
// Un article se classe sur trois nomenclatures publiques, servies ensemble par
// GET /api/referentiels : le corps d'état (FFB), le NF DTU qui régit son
// exécution, et le code NAF de l'activité qui le réalise ; l'élément d'ouvrage
// SfB s'y ajoute pour situer l'article dans le bâtiment.
//
// Son prix courant est celui qu'on injectera dans un DPGF ; l'historique
// d'observations garde à côté chaque prix constaté, sans l'écraser — c'est là
// que viendront se déverser les réponses des entreprises aux appels d'offres.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  IconPlus, IconSearch, IconTrash, IconDeviceFloppy, IconX, IconChevronRight,
  IconChevronDown, IconBooks, IconCurrencyEuro, IconHistory, IconStar,
  IconStarFilled, IconFileText, IconLoader2, IconAlertTriangle,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { fetchJson, apiFetch } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';
import type {
  Referentiels, ArticleBibliotheque, PrixObservation, PrixStats,
  RepartitionBibliotheque, OrigineArticle,
} from '../types/library';

const REFERENTIELS_VIDES: Referentiels = {
  sfb: [], corpsEtat: [], dtu: [], naf: [], dtuParCorpsEtat: {}, corpsEtatParDtu: {},
};

const ARTICLE_VIDE = {
  designation: '', unite: 'U', prix_unitaire: 0, code: '', description: '', notes: '',
  corps_etat_code: '', dtu_code: '', sfb_code: '', naf_code: '',
};

/** Un article venu du cabinet se distingue à l'œil du fonds de référence. */
function BadgeOrigine({ origine }: { origine: OrigineArticle }) {
  const { t } = useTranslation();
  const cabinet = origine !== 'reference';
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap"
      style={cabinet
        ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
        : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)', border: '1px solid var(--tblr-border)' }}
      title={t(cabinet ? 'library_origin_cabinet_hint' : 'library_origin_reference_hint')}
    >
      {t(`library_origin_${origine}`)}
    </span>
  );
}

export default function Specifications() {
  const { t } = useTranslation();
  const { specId } = useParams<{ specId: string }>();
  const navigate = useNavigate();

  const [referentiels, setReferentiels] = useState<Referentiels>(REFERENTIELS_VIDES);
  const [repartition, setRepartition] = useState<RepartitionBibliotheque | null>(null);
  const [articles, setArticles] = useState<ArticleBibliotheque[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [recherche, setRecherche] = useState('');
  const [corpsEtatActif, setCorpsEtatActif] = useState<string | null>(null);
  const [dtuActif, setDtuActif] = useState<string>('');
  const [origineActive, setOrigineActive] = useState<string>('');
  const [famillesOuvertes, setFamillesOuvertes] = useState<Record<string, boolean>>({});

  const [selection, setSelection] = useState<ArticleBibliotheque | null>(null);
  const [brouillon, setBrouillon] = useState<Record<string, any> | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);

  const [observations, setObservations] = useState<PrixObservation[]>([]);
  const [stats, setStats] = useState<PrixStats | null>(null);
  const [nouveauPrix, setNouveauPrix] = useState('');
  const [nouvelleEntreprise, setNouvelleEntreprise] = useState('');
  const [nouvelleOrigine, setNouvelleOrigine] = useState<PrixObservation['origine']>('offre');
  const [definirCourant, setDefinirCourant] = useState(false);

  // ── Chargement ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchJson<Referentiels>('/api/referentiels')
      .then(setReferentiels)
      .catch(() => setErreur(t('library_error_referentiels')));
  }, []);

  const chargerArticles = useCallback(async () => {
    setChargement(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (recherche.trim()) params.set('q', recherche.trim());
      if (corpsEtatActif) params.set('corps_etat_code', corpsEtatActif);
      if (dtuActif) params.set('dtu_code', dtuActif);
      if (origineActive) params.set('origine', origineActive);
      const data = await fetchJson<ArticleBibliotheque[]>(`/api/price-library?${params}`);
      setArticles(data);
      setErreur(null);
    } catch {
      setArticles([]);
      setErreur(t('library_error_load'));
    } finally {
      setChargement(false);
    }
  }, [recherche, corpsEtatActif, dtuActif, origineActive]);

  // La recherche est débouncée : la requête part côté serveur, une frappe par
  // caractère la lancerait autant de fois.
  useEffect(() => {
    const timer = setTimeout(chargerArticles, 250);
    return () => clearTimeout(timer);
  }, [chargerArticles]);

  const chargerRepartition = useCallback(() => {
    fetchJson<RepartitionBibliotheque>('/api/price-library/repartition')
      .then(setRepartition)
      .catch(() => setRepartition(null));
  }, []);
  useEffect(chargerRepartition, [chargerRepartition]);

  // Ouverture directe sur un article par son URL (/specifications/:id).
  useEffect(() => {
    if (!specId || selection?.id === specId) return;
    const trouve = articles.find(a => a.id === specId);
    if (trouve) selectionner(trouve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specId, articles]);

  const chargerPrix = useCallback(async (articleId: string) => {
    try {
      const data = await fetchJson<{ observations: PrixObservation[]; stats: PrixStats }>(
        `/api/price-library/${articleId}/prix`);
      setObservations(data.observations);
      setStats(data.stats);
    } catch {
      setObservations([]);
      setStats(null);
    }
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const selectionner = (article: ArticleBibliotheque) => {
    setSelection(article);
    setBrouillon({ ...ARTICLE_VIDE, ...article });
    chargerPrix(article.id);
    navigate(`/specifications/${article.id}`, { replace: true });
  };

  const nouvelArticle = () => {
    setSelection(null);
    setObservations([]);
    setStats(null);
    setBrouillon({ ...ARTICLE_VIDE, corps_etat_code: corpsEtatActif ?? '', dtu_code: dtuActif });
    navigate('/specifications', { replace: true });
  };

  const enregistrer = async () => {
    if (!brouillon?.designation?.trim()) return;
    setEnregistrement(true);
    try {
      const corps = { ...brouillon, prix_unitaire: Number(brouillon.prix_unitaire) || 0 };
      const article = selection
        ? await apiFetch<ArticleBibliotheque>(`/api/price-library/${selection.id}`,
          { method: 'PUT', body: JSON.stringify(corps) })
        : await apiFetch<ArticleBibliotheque>('/api/price-library',
          { method: 'POST', body: JSON.stringify(corps) });
      setSelection(article);
      setBrouillon({ ...ARTICLE_VIDE, ...article });
      chargerArticles();
      chargerRepartition();
      chargerPrix(article.id);
      navigate(`/specifications/${article.id}`, { replace: true });
    } catch {
      setErreur(t('library_error_save'));
    } finally {
      setEnregistrement(false);
    }
  };

  const supprimer = async () => {
    if (!selection || !confirm(t('library_delete_confirm', { name: selection.designation }))) return;
    await apiFetch(`/api/price-library/${selection.id}`, { method: 'DELETE' });
    setSelection(null);
    setBrouillon(null);
    chargerArticles();
    chargerRepartition();
    navigate('/specifications', { replace: true });
  };

  const basculerFavori = async (article: ArticleBibliotheque) => {
    const maj = await apiFetch<ArticleBibliotheque>(`/api/price-library/${article.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...article, favori: !article.favori }),
    });
    setArticles(prev => prev.map(a => (a.id === maj.id ? maj : a)));
    if (selection?.id === maj.id) setSelection(maj);
  };

  const ajouterObservation = async () => {
    if (!selection) return;
    const prix = Number(String(nouveauPrix).replace(',', '.'));
    if (!Number.isFinite(prix)) return;
    await apiFetch(`/api/price-library/${selection.id}/prix`, {
      method: 'POST',
      body: JSON.stringify({
        prix_ht: prix,
        entreprise: nouvelleEntreprise,
        origine: nouvelleOrigine,
        definir_comme_courant: definirCourant,
      }),
    });
    setNouveauPrix('');
    setNouvelleEntreprise('');
    setDefinirCourant(false);
    chargerPrix(selection.id);
    if (definirCourant) chargerArticles();
  };

  const supprimerObservation = async (id: string) => {
    await apiFetch(`/api/price-library/prix/${id}`, { method: 'DELETE' });
    if (selection) chargerPrix(selection.id);
  };

  // ── Données dérivées ───────────────────────────────────────────────────────

  const familles = useMemo(() => {
    const out: { famille: string; metiers: typeof referentiels.corpsEtat }[] = [];
    for (const ce of referentiels.corpsEtat) {
      const groupe = out.find(g => g.famille === ce.famille);
      if (groupe) groupe.metiers.push(ce);
      else out.push({ famille: ce.famille, metiers: [ce] });
    }
    return out;
  }, [referentiels.corpsEtat]);

  // Les DTU proposés suivent le corps d'état choisi : sur « Couverture », les
  // 115 normes se réduisent aux 19 qui concernent le métier.
  const dtuDisponibles = useMemo(() => {
    const codes = corpsEtatActif ? referentiels.dtuParCorpsEtat[corpsEtatActif] : null;
    if (!codes) return referentiels.dtu;
    const permis = new Set(codes);
    return referentiels.dtu.filter(d => permis.has(d.code));
  }, [corpsEtatActif, referentiels]);

  const dtuBrouillonDisponibles = useMemo(() => {
    const codes = brouillon?.corps_etat_code
      ? referentiels.dtuParCorpsEtat[brouillon.corps_etat_code] : null;
    if (!codes) return referentiels.dtu;
    const permis = new Set(codes);
    return referentiels.dtu.filter(d => permis.has(d.code));
  }, [brouillon?.corps_etat_code, referentiels]);

  const libelle = (liste: { code: string; libelle?: string; titre?: string }[], code: string | null) =>
    liste.find(x => x.code === code)?.libelle ?? liste.find(x => x.code === code)?.titre ?? null;

  const majBrouillon = (champ: string, valeur: any) =>
    setBrouillon(prev => (prev ? { ...prev, [champ]: valeur } : prev));

  // ── Rendu ──────────────────────────────────────────────────────────────────

  const styleChamp = {
    background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)',
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      {/* ── Colonne 1 : nomenclature des corps d'état ── */}
      <aside
        className="lg:w-72 flex-shrink-0 rounded-lg overflow-hidden flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
            <IconBooks size={20} />
            {t('specifications')}
          </h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
            {repartition
              ? t('library_subtitle', { count: repartition.total })
              : t('library_subtitle_empty')}
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <button
            onClick={() => { setCorpsEtatActif(null); setDtuActif(''); }}
            className="w-full text-left px-4 py-2 text-[13px] font-medium transition-colors"
            style={corpsEtatActif === null
              ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
              : { color: 'var(--tblr-muted)' }}
          >
            {t('library_all_trades')}
          </button>

          {familles.map(({ famille, metiers }) => {
            const ouverte = famillesOuvertes[famille] ?? true;
            return (
              <div key={famille}>
                <button
                  onClick={() => setFamillesOuvertes(p => ({ ...p, [famille]: !ouverte }))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  {ouverte ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  {famille}
                </button>
                {ouverte && metiers.map(metier => {
                  const actif = corpsEtatActif === metier.code;
                  const nombre = repartition?.parCorpsEtat[metier.code] ?? 0;
                  return (
                    <button
                      key={metier.code}
                      onClick={() => { setCorpsEtatActif(metier.code); setDtuActif(''); }}
                      className="w-full flex items-center justify-between gap-2 pl-8 pr-4 py-1.5 text-[13px] text-left transition-colors"
                      style={actif
                        ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                        : { color: 'var(--tblr-muted)' }}
                    >
                      <span className="truncate">{metier.libelle}</span>
                      <span className="text-[11px] flex-shrink-0 tabular-nums">{nombre || ''}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Colonne 2 : liste des articles ── */}
      <section
        className="lg:w-96 flex-shrink-0 rounded-lg overflow-hidden flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
              <input
                type="text"
                placeholder={t('library_search')}
                value={recherche}
                onChange={e => setRecherche(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                style={styleChamp}
              />
            </div>
            <button
              onClick={nouvelArticle}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <IconPlus size={16} />
              {t('library_new_article')}
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={dtuActif}
              onChange={e => setDtuActif(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[13px] outline-none"
              style={styleChamp}
            >
              <option value="">{t('library_all_dtu')}</option>
              {dtuDisponibles.map(d => (
                <option key={d.code} value={d.code}>{d.code} — {d.titre}</option>
              ))}
            </select>
            <select
              value={origineActive}
              onChange={e => setOrigineActive(e.target.value)}
              className="px-2 py-1.5 rounded-lg text-[13px] outline-none"
              style={styleChamp}
            >
              <option value="">{t('library_all_origins')}</option>
              <option value="saisie">{t('library_origin_saisie')}</option>
              <option value="bpu">{t('library_origin_bpu')}</option>
              <option value="offre">{t('library_origin_offre')}</option>
              <option value="reference">{t('library_origin_reference')}</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {chargement ? (
            <p className="p-4 text-sm" style={{ color: 'var(--tblr-muted)' }}>Chargement...</p>
          ) : articles.length === 0 ? (
            <div className="p-6 text-center text-sm space-y-2" style={{ color: 'var(--tblr-muted)' }}>
              <IconBooks size={32} className="mx-auto opacity-30" />
              <p>{t('library_empty')}</p>
              <button onClick={nouvelArticle} className="hover:underline" style={{ color: 'var(--tblr-primary)' }}>
                {t('library_create_first')}
              </button>
            </div>
          ) : articles.map(article => {
            const actif = selection?.id === article.id;
            return (
              <div
                key={article.id}
                onClick={() => selectionner(article)}
                className="group px-3 py-2.5 cursor-pointer transition-colors"
                style={{
                  borderBottom: '1px solid var(--tblr-border)',
                  background: actif ? 'var(--tblr-primary-lt)' : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>
                      {article.designation}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <BadgeOrigine origine={article.origine} />
                      {article.dtu_code && (
                        <span className="text-[11px] font-mono" style={{ color: 'var(--tblr-muted)' }}>
                          {article.dtu_code}
                        </span>
                      )}
                      {article.unite && (
                        <span className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{article.unite}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--tblr-text)' }}>
                      {formatCurrency(Number(article.prix_unitaire) || 0)}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); basculerFavori(article); }}
                      style={{ color: article.favori ? '#f59f00' : 'var(--tblr-muted)' }}
                      title="Favori"
                    >
                      {article.favori ? <IconStarFilled size={13} /> : <IconStar size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Colonne 3 : fiche de l'article ── */}
      <section
        className="flex-1 min-w-0 rounded-lg overflow-y-auto"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        {erreur && (
          <div className="m-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm border"
            style={{ color: '#e67700', background: '#fff3bf', borderColor: '#ffe066' }}>
            <IconAlertTriangle size={16} />
            {erreur}
          </div>
        )}

        {!brouillon ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center" style={{ color: 'var(--tblr-muted)' }}>
            <IconFileText size={48} className="opacity-20" />
            <p className="text-sm">{t('library_select_hint')}</p>
            <p className="text-xs max-w-md">{t('library_select_detail')}</p>
          </div>
        ) : (
          <div className="p-5 max-w-3xl space-y-6">
            {/* En-tête */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
                  {selection ? selection.designation : t('library_new_article_title')}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  {selection && <BadgeOrigine origine={selection.origine} />}
                  {selection?.usage_count ? (
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                      {t('library_used_times', { count: selection.usage_count })}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selection && (
                  <button
                    onClick={supprimer}
                    className="p-2 rounded-lg transition-colors"
                    style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    title="Supprimer"
                  >
                    <IconTrash size={16} />
                  </button>
                )}
                <button
                  onClick={enregistrer}
                  disabled={enregistrement || !brouillon.designation?.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {enregistrement ? <IconLoader2 size={16} className="animate-spin" /> : <IconDeviceFloppy size={16} />}
                  {t('save')}
                </button>
              </div>
            </div>

            {/* Identification */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <label className="sm:col-span-4 text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_designation')}</span>
                <input
                  type="text"
                  value={brouillon.designation}
                  onChange={e => majBrouillon('designation', e.target.value)}
                  placeholder={t('library_designation_placeholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                  style={styleChamp}
                />
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_code')}</span>
                <input
                  type="text" value={brouillon.code ?? ''}
                  onChange={e => majBrouillon('code', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                />
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_unit')}</span>
                <input
                  type="text" value={brouillon.unite ?? ''}
                  onChange={e => majBrouillon('unite', e.target.value)}
                  placeholder={t('library_unit_placeholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                />
              </label>
              <label className="sm:col-span-2 text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_unit_price')}</span>
                <div className="relative">
                  <IconCurrencyEuro className="absolute right-3 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--tblr-muted)' }} />
                  <input
                    type="number" step="0.01" value={brouillon.prix_unitaire ?? 0}
                    onChange={e => majBrouillon('prix_unitaire', e.target.value)}
                    className="w-full pl-3 pr-9 py-2 rounded-lg text-sm outline-none tabular-nums" style={styleChamp}
                  />
                </div>
              </label>
            </div>

            {/* Classement */}
            <div>
              <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--tblr-text)' }}>{t('library_classification')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_trade')}</span>
                  <select
                    value={brouillon.corps_etat_code ?? ''}
                    onChange={e => { majBrouillon('corps_etat_code', e.target.value); majBrouillon('dtu_code', ''); }}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                  >
                    <option value="">{t('library_unclassified')}</option>
                    {familles.map(({ famille, metiers }) => (
                      <optgroup key={famille} label={famille}>
                        {metiers.map(m => <option key={m.code} value={m.code}>{m.libelle}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_dtu')}</span>
                  <select
                    value={brouillon.dtu_code ?? ''}
                    onChange={e => majBrouillon('dtu_code', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                  >
                    <option value="">{t('library_no_dtu')}</option>
                    {dtuBrouillonDisponibles.map(d => (
                      <option key={d.code} value={d.code}>
                        {d.code} — {d.titre}{d.norme ? ` (${d.norme})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_sfb')}</span>
                  <select
                    value={brouillon.sfb_code ?? ''}
                    onChange={e => majBrouillon('sfb_code', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                  >
                    <option value="">— Non classé —</option>
                    {referentiels.sfb.filter(s => s.niveau === 1).map(groupe => (
                      <optgroup key={groupe.code} label={`(${groupe.code}) ${groupe.libelle}`}>
                        {referentiels.sfb
                          .filter(s => s.parent_code === groupe.code)
                          .map(s => (
                            <option key={s.code} value={s.code}>({s.code}) {s.libelle.slice(0, 70)}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_naf')}</span>
                  <select
                    value={brouillon.naf_code ?? ''}
                    onChange={e => majBrouillon('naf_code', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={styleChamp}
                  >
                    <option value="">{t('library_unclassified')}</option>
                    {referentiels.naf.filter(n => n.niveau === 5).map(n => (
                      <option key={n.code} value={n.code}>{n.code} — {n.libelle}</option>
                    ))}
                  </select>
                </label>
              </div>
              {brouillon.dtu_code && (
                <p className="mt-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>
                  {libelle(referentiels.dtu as any, brouillon.dtu_code)}
                </p>
              )}
            </div>

            {/* Prescriptions */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>
                  {t('library_description')}
                </span>
                <textarea
                  rows={5}
                  value={brouillon.description ?? ''}
                  onChange={e => majBrouillon('description', e.target.value)}
                  placeholder={t('library_description_placeholder')}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y leading-relaxed"
                  style={styleChamp}
                />
              </label>
              <label className="block text-sm">
                <span className="block mb-1 font-medium" style={{ color: 'var(--tblr-text)' }}>{t('library_notes')}</span>
                <textarea
                  rows={2}
                  value={brouillon.notes ?? ''}
                  onChange={e => majBrouillon('notes', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
                  style={styleChamp}
                />
              </label>
            </div>

            {/* Historique de prix */}
            {selection && (
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                  <IconHistory size={16} />
                  {t('library_price_history')}
                </h4>

                {stats && stats.nombre > 0 && (
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {([['library_min', stats.min], ['library_median', stats.mediane], ['library_max', stats.max]] as const).map(([label, valeur]) => (
                      <div key={label} className="px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                        <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t(label)}</p>
                        <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--tblr-text)' }}>
                          {valeur == null ? '—' : formatCurrency(valeur)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {observations.length > 0 && (
                  <div className="rounded-lg overflow-hidden mb-3" style={{ border: '1px solid var(--tblr-border)' }}>
                    {observations.map((obs, i) => (
                      <div
                        key={obs.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                        style={{ borderTop: i > 0 ? '1px solid var(--tblr-border)' : undefined }}
                      >
                        <span className="tabular-nums font-medium w-24" style={{ color: 'var(--tblr-text)' }}>
                          {formatCurrency(Number(obs.prix_ht))}
                        </span>
                        <span className="text-xs w-24" style={{ color: 'var(--tblr-muted)' }}>
                          {new Date(obs.date_observation).toLocaleDateString('fr-FR')}
                        </span>
                        <span className="text-xs flex-1 truncate" style={{ color: 'var(--tblr-muted)' }}>
                          {obs.entreprise || t(`library_origin_${obs.origine}`)}
                        </span>
                        <button onClick={() => supprimerObservation(obs.id)} style={{ color: 'var(--tblr-muted)' }}>
                          <IconX size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                  <label className="text-xs">
                    <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_observed_price')}</span>
                    <input
                      type="text" inputMode="decimal" value={nouveauPrix}
                      onChange={e => setNouveauPrix(e.target.value)}
                      className="w-28 px-2 py-1.5 rounded text-sm outline-none tabular-nums"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    />
                  </label>
                  <label className="text-xs flex-1 min-w-[140px]">
                    <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_company')}</span>
                    <input
                      type="text" value={nouvelleEntreprise}
                      onChange={e => setNouvelleEntreprise(e.target.value)}
                      className="w-full px-2 py-1.5 rounded text-sm outline-none"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('library_provenance')}</span>
                    <select
                      value={nouvelleOrigine}
                      onChange={e => setNouvelleOrigine(e.target.value as PrixObservation['origine'])}
                      className="px-2 py-1.5 rounded text-sm outline-none"
                      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    >
                      <option value="offre">{t('library_provenance_offre')}</option>
                      <option value="marche">{t('library_provenance_marche')}</option>
                      <option value="bpu">{t('library_origin_bpu')}</option>
                      <option value="saisie">{t('library_provenance_saisie')}</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs pb-2" style={{ color: 'var(--tblr-muted)' }}>
                    <input type="checkbox" checked={definirCourant} onChange={e => setDefinirCourant(e.target.checked)} />
                    {t('library_set_current')}
                  </label>
                  <button
                    onClick={ajouterObservation}
                    disabled={!nouveauPrix.trim()}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
                      'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40',
                    )}
                  >
                    <IconPlus size={14} />
                    {t('add')}
                  </button>
                </div>
                <p className="mt-2 text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('library_price_hint')}</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
