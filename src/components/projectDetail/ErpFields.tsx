import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ErpCalcul } from '../../types';
import { ERP_CATEGORIES, ERP_TYPES, categorieFromEffectif, formatTypeEtCat, parseTypeEtCat } from '../../lib/erp';
import { calculerEffectif, categorieErp, descriptionSeuils, naturesDuType, natureParShort } from '../../lib/erpEffectif';

interface Props {
  value?: string;
  calcul?: ErpCalcul | null;
  onCalculChange: (calcul: ErpCalcul) => void;
  effectifPublic: number;
  effectifPersonnel: number;
  onChange: (typeEtCat: string) => void;
  onApplyEffectif: (e: { public: number; personnel: number }) => void;
}

const selectCls = 'w-full bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] font-medium';
const inputCls = 'w-full bg-[var(--tblr-surface)] border border-[var(--tblr-border)] rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-[var(--tblr-text)] tabular-nums';
const labelCls = 'block text-[0.6875rem] font-bold text-[var(--tblr-muted)] uppercase tracking-wider';
const linkBtn = 'h-9 px-3 inline-flex items-center rounded-lg border text-[0.8125rem] font-semibold transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** Type, nature et catégorie ERP (stockés dans `type_et_cat`) et calcul de l'effectif du type choisi. */
export function ErpFields({ value, calcul, onCalculChange, effectifPublic, effectifPersonnel, onChange, onApplyEffectif }: Props) {
  const { t } = useTranslation();
  const ids = [useId(), useId(), useId(), useId(), useId()];
  const { code, categorie, nature: natureShort } = parseTypeEtCat(value);
  const natures = naturesDuType(code);
  const nature = natureParShort(code, natureShort) ?? (natures.length === 1 ? natures[0] : undefined);

  // Les saisies appartiennent à la nature pour laquelle elles ont été faites.
  const saisies = calcul && calcul.nature === nature?.id ? calcul : undefined;
  const quantites = saisies?.quantites ?? {};
  const declare = saisies?.declare ?? '';
  const sousSol = saisies?.sous_sol ?? '';
  const etages = saisies?.etages ?? '';
  const saisir = (patch: Partial<ErpCalcul>) => {
    if (nature) onCalculChange({ nature: nature.id, quantites, declare, sous_sol: sousSol, etages, ...patch });
  };

  const nombres = useMemo(() => Object.fromEntries(Object.entries(quantites).map(([k, v]) => [k, Number(v) || 0])), [quantites]);
  const calcule = nature ? calculerEffectif(nature, nombres, declare === '' ? undefined : Number(declare)) : null;
  const aSaisi = !!calcule && calcule.total > 0;
  const effectifTotal = aSaisi ? calcule!.total : effectifPublic + effectifPersonnel;
  const verdict = categorieErp(nature, effectifTotal, {
    sousSol: Number(sousSol) || 0,
    etages: Number(etages) || 0,
    residents: nature?.residentsLigne ? nombres[nature.residentsLigne] : undefined,
  });
  const propose = verdict.categorie ?? categorieFromEffectif(effectifTotal);

  const set = (patch: Partial<{ code: string; nature: string; categorie: number | null }>) =>
    onChange(formatTypeEtCat({ code, categorie, nature: natureShort, ...patch }));

  return (
    <>
      <div className="space-y-1">
        <label htmlFor={ids[0]} className={labelCls}>{t('projectdetail_erp_type')}</label>
        <select id={ids[0]} className={selectCls} value={code} onChange={e => {
          const next = naturesDuType(e.target.value);
          set({ code: e.target.value, nature: next.length === 1 ? next[0].short : undefined });
        }}>
          <option value="">{t('projectdetail_field_select')}</option>
          {ERP_TYPES.map(o => <option key={o.code} value={o.code}>{`${o.code} : ${o.nature}`}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids[1]} className={labelCls}>{t('projectdetail_erp_nature')}</label>
        <select id={ids[1]} className={selectCls} disabled={!code} value={nature?.short ?? ''} onChange={e => set({ nature: e.target.value || undefined })}>
          <option value="">{t('projectdetail_field_select')}</option>
          {natures.map(n => <option key={n.id} value={n.short}>{n.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={ids[2]} className={labelCls}>{t('projectdetail_erp_category')}</label>
        <select id={ids[2]} className={selectCls} value={categorie ?? ''} onChange={e => set({ categorie: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('projectdetail_field_select')}</option>
          {ERP_CATEGORIES.map(o => <option key={o.value} value={o.value}>{`${o.label} (${o.effectif})`}</option>)}
        </select>
        {propose != null && propose !== categorie && (
          <button type="button" className="text-[0.6875rem] font-semibold text-[var(--tblr-primary)] underline underline-offset-2"
            onClick={() => set({ categorie: propose })}>
            {t('projectdetail_erp_suggest', { cat: ERP_CATEGORIES[propose - 1].label, count: effectifTotal })}
          </button>
        )}
      </div>

      {nature && (
        <details className="md:col-span-3 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)]" open>
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-[var(--tblr-text)]">{t('projectdetail_erp_calc_title')}</summary>
          <div className="px-4 pb-4 space-y-5">
            {nature.note && <p className="text-xs text-[var(--tblr-muted)]">{nature.note}</p>}

            {nature.lignes.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {nature.lignes.map(l => {
                  const id = `${ids[3]}-${l.id}`;
                  return (
                    <div key={l.id} className="space-y-1">
                      <label htmlFor={id} className="block text-xs text-[var(--tblr-text)]">{l.label}</label>
                      <div className="flex items-center gap-2">
                        <input id={id} type="number" min="0" inputMode="decimal" className={inputCls} value={quantites[l.id] ?? ''}
                          onChange={e => saisir({ quantites: { ...quantites, [l.id]: e.target.value } })} />
                        <span className="text-xs text-[var(--tblr-muted)] shrink-0 w-20">{l.unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-1 max-w-sm">
              <label htmlFor={ids[4]} className="block text-xs text-[var(--tblr-text)]">{t('projectdetail_erp_declared')}</label>
              <input id={ids[4]} type="number" min="0" inputMode="numeric" className={inputCls} value={declare} onChange={e => saisir({ declare: e.target.value })} />
            </div>

            {calcule && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <p className="text-sm text-[var(--tblr-text)]">
                  {t('projectdetail_erp_result', { public: calcule.public, personnel: calcule.personnel, total: calcule.total })}
                  {calcule.formule && <span className="block text-xs text-[var(--tblr-muted)]">{t('projectdetail_erp_formula', { formula: calcule.formule })}</span>}
                </p>
                <button type="button" disabled={!aSaisi} className={`${linkBtn} disabled:opacity-50`}
                  style={{ borderColor: 'var(--tblr-border)' }}
                  onClick={() => onApplyEffectif({ public: calcule.public, personnel: calcule.personnel })}>
                  {t('projectdetail_erp_apply_effectif')}
                </button>
              </div>
            )}

            <div className="space-y-3 pt-4 border-t border-[var(--tblr-border)]">
              <p className="text-xs font-bold text-[var(--tblr-text)]">{t('projectdetail_erp_thresholds')}</p>
              <p className="text-xs text-[var(--tblr-muted)]">{descriptionSeuils(nature.seuils).join(' · ')}</p>
              {!nature.seuils.sansCinquieme && (nature.seuils.sousSol !== null || nature.seuils.etages !== null) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                  {nature.seuils.sousSol !== null && (
                    <label className="space-y-1 block">
                      <span className="block text-xs text-[var(--tblr-text)]">{t('projectdetail_erp_basement')}</span>
                      <input type="number" min="0" inputMode="numeric" className={inputCls} value={sousSol} onChange={e => saisir({ sous_sol: e.target.value })} />
                    </label>
                  )}
                  {nature.seuils.etages !== null && (
                    <label className="space-y-1 block">
                      <span className="block text-xs text-[var(--tblr-text)]">{t('projectdetail_erp_floors')}</span>
                      <input type="number" min="0" inputMode="numeric" className={inputCls} value={etages} onChange={e => saisir({ etages: e.target.value })} />
                    </label>
                  )}
                </div>
              )}
              {verdict.categorie != null && (
                <p className="text-sm text-[var(--tblr-text)]" aria-live="polite">
                  {t('projectdetail_erp_verdict', { cat: ERP_CATEGORIES[verdict.categorie - 1].label, count: effectifTotal })}
                  {verdict.motifs.length > 0 && <span className="block text-xs text-[var(--tblr-muted)]">{verdict.motifs.join(', ')}</span>}
                </p>
              )}
            </div>
          </div>
        </details>
      )}
    </>
  );
}
