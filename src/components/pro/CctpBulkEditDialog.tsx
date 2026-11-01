// ── Modification en masse des postes sélectionnés du CCTP ────────────────────
// Chaque rubrique a sa case « modifier » : une rubrique non cochée n'est jamais
// touchée, et un champ laissé vide ne peut pas effacer par accident (effacer
// une localisation ou une phase est un choix explicite). La fenêtre ne modifie
// rien elle-même : elle remet un patch que l'éditeur applique d'un seul coup.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import type { DPGF } from '../../types/dpgf';
import { batimentsParOrdre } from '../../lib/batimentsArticles';
import type { PatchMasse } from './cctpBulkOps';

interface Props {
  doc: DPGF;
  /** Composition de la sélection, pour dire à quoi la modification s'applique. */
  resume: { lots: number; chapitres: number; articles: number };
  onClose: () => void;
  onApply: (patch: PatchMasse) => void;
}

const CHAMP = 'px-3 py-1.5 rounded-lg text-sm outline-none border focus:ring-2 focus:ring-[var(--tblr-primary)]';
const STYLE_CHAMP = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

const Rubrique: React.FC<{
  id: string; titre: string; actif: boolean; onToggle: (v: boolean) => void; aide?: string; children: React.ReactNode;
}> = ({ id, titre, actif, onToggle, aide, children }) => {
  const { t } = useTranslation();
  return (
    <fieldset className="rounded-lg border p-3 space-y-2" style={{ borderColor: actif ? 'var(--tblr-primary)' : 'var(--tblr-border)' }}>
      <legend className="px-1">
        <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>
          <input id={id} type="checkbox" checked={actif} onChange={e => onToggle(e.target.checked)} />
          {titre}
          <span className="text-xs font-normal" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_bulk_change')}</span>
        </label>
      </legend>
      {aide && <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{aide}</p>}
      <div className={actif ? '' : 'opacity-50 pointer-events-none'} aria-disabled={!actif}>{children}</div>
    </fieldset>
  );
};

export const CctpBulkEditDialog: React.FC<Props> = ({ doc, resume, onClose, onApply }) => {
  const { t } = useTranslation();
  const total = resume.lots + resume.chapitres + resume.articles;
  const batiments = doc.multiBatiments ? batimentsParOrdre(doc.batiments) : [];
  const phases = doc.multiPhases ? [...(doc.phases ?? [])].sort((a, b) => a.ordre - b.ordre) : [];

  const [visOn, setVisOn] = useState(false);
  const [visible, setVisible] = useState(true);
  const [phaseOn, setPhaseOn] = useState(false);
  const [phaseId, setPhaseId] = useState('');
  const [batOn, setBatOn] = useState(false);
  const [batModes, setBatModes] = useState<Record<string, 'ajouter' | 'retirer' | ''>>({});
  const [locOn, setLocOn] = useState(false);
  const [localisation, setLocalisation] = useState('');
  const [uniteOn, setUniteOn] = useState(false);
  const [unite, setUnite] = useState('');
  const [texteOn, setTexteOn] = useState(false);
  const [mode, setMode] = useState<'fin' | 'debut' | 'remplacer'>('fin');
  const [valeur, setValeur] = useState('');
  const [cherche, setCherche] = useState('');

  const patch: PatchMasse = {};
  if (visOn && (resume.chapitres || resume.articles)) patch.visibleDpgf = visible;
  if (phaseOn) patch.phaseId = phaseId;
  if (batOn) {
    const ajouter = Object.entries(batModes).filter(([, m]) => m === 'ajouter').map(([id]) => id);
    const retirer = Object.entries(batModes).filter(([, m]) => m === 'retirer').map(([id]) => id);
    if (ajouter.length || retirer.length) patch.batiments = { ajouter, retirer };
  }
  if (locOn && resume.articles) patch.localisation = localisation;
  if (uniteOn && resume.articles) patch.unite = unite;
  if (texteOn) {
    if (mode === 'remplacer' ? cherche.length > 0 : valeur.trim().length > 0) {
      patch.texte = mode === 'remplacer' ? { mode, cherche, valeur } : { mode, valeur };
    }
  }
  const vide = Object.keys(patch).length === 0;

  return (
    <ModalShell
      title={t('pro_cctp_bulk_title')}
      subtitle={t('pro_cctp_bulk_scope', { total, lots: resume.lots, chapitres: resume.chapitres, articles: resume.articles })}
      onClose={onClose}
      dirty={!vide}
      size="lg"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={vide} onClick={() => onApply(patch)}>
            {t('pro_cctp_bulk_apply', { count: total })}
          </button>
        </>
      }
    >
      <div className="p-4 sm:p-6 space-y-3">
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_bulk_hint')}</p>

        <Rubrique id="bulk-texte" titre={t('pro_cctp_bulk_text')} actif={texteOn} onToggle={setTexteOn}>
          <div className="space-y-2">
            <select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className={`${CHAMP} w-full`} style={STYLE_CHAMP} aria-label={t('pro_cctp_bulk_text')}>
              <option value="fin">{t('pro_cctp_bulk_text_end')}</option>
              <option value="debut">{t('pro_cctp_bulk_text_start')}</option>
              <option value="remplacer">{t('pro_cctp_bulk_text_replace')}</option>
            </select>
            {mode === 'remplacer' && (
              <input type="text" value={cherche} onChange={e => setCherche(e.target.value)} placeholder={t('pro_cctp_bulk_text_search')}
                aria-label={t('pro_cctp_bulk_text_search')} className={`${CHAMP} w-full`} style={STYLE_CHAMP} />
            )}
            <textarea rows={mode === 'remplacer' ? 2 : 5} value={valeur} onChange={e => setValeur(e.target.value)}
              placeholder={mode === 'remplacer' ? t('pro_cctp_bulk_text_by') : t('pro_cctp_bulk_text_placeholder')}
              aria-label={mode === 'remplacer' ? t('pro_cctp_bulk_text_by') : t('pro_cctp_bulk_text_placeholder')}
              className={`${CHAMP} w-full resize-y`} style={STYLE_CHAMP} />
          </div>
        </Rubrique>

        {(resume.chapitres > 0 || resume.articles > 0) && (
          <Rubrique id="bulk-vis" titre={t('pro_cctp_bulk_visibility')} actif={visOn} onToggle={setVisOn}
            aide={resume.lots ? t('pro_cctp_bulk_visibility_lots') : undefined}>
            <select value={visible ? 'dpgf' : 'cctp'} onChange={e => setVisible(e.target.value === 'dpgf')} className={`${CHAMP} w-full`} style={STYLE_CHAMP} aria-label={t('pro_cctp_bulk_visibility')}>
              <option value="dpgf">{t('pro_cctp_bulk_visible')}</option>
              <option value="cctp">{t('pro_cctp_bulk_cctp_only')}</option>
            </select>
          </Rubrique>
        )}

        {resume.articles > 0 && (
          <>
            <Rubrique id="bulk-loc" titre={t('pro_cctp_bulk_location')} actif={locOn} onToggle={setLocOn} aide={t('pro_cctp_bulk_articles_only')}>
              <input type="text" value={localisation} onChange={e => setLocalisation(e.target.value)} placeholder={t('pro_cctp_bulk_location_placeholder')}
                aria-label={t('pro_cctp_bulk_location')} className={`${CHAMP} w-full`} style={STYLE_CHAMP} />
              {locOn && !localisation.trim() && <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('pro_cctp_bulk_clear_hint')}</p>}
            </Rubrique>
            <Rubrique id="bulk-unite" titre={t('library_unit')} actif={uniteOn} onToggle={setUniteOn} aide={t('pro_cctp_bulk_articles_only')}>
              <input type="text" value={unite} onChange={e => setUnite(e.target.value)} placeholder={t('library_unit_placeholder')}
                aria-label={t('library_unit')} className={`${CHAMP} w-40`} style={STYLE_CHAMP} />
            </Rubrique>
          </>
        )}

        {phases.length > 0 && (
          <Rubrique id="bulk-phase" titre={t('pro_col_phase')} actif={phaseOn} onToggle={setPhaseOn}>
            <select value={phaseId} onChange={e => setPhaseId(e.target.value)} className={`${CHAMP} w-full`} style={STYLE_CHAMP} aria-label={t('pro_col_phase')}>
              <option value="">{t('pro_cctp_bulk_no_phase')}</option>
              {phases.map(p => <option key={p.id} value={p.id}>{p.libelle ? `${p.code} · ${p.libelle}` : p.code}</option>)}
            </select>
          </Rubrique>
        )}

        {batiments.length > 0 && (
          <Rubrique id="bulk-bat" titre={t('pro_buildings')} actif={batOn} onToggle={setBatOn} aide={t('pro_cctp_bulk_buildings_hint')}>
            <ul className="space-y-1.5">
              {batiments.map(b => (
                <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: 'var(--tblr-text)' }}>{b.libelle ? `${b.code} · ${b.libelle}` : b.code}</span>
                  <select value={batModes[b.id] ?? ''} onChange={e => setBatModes(m => ({ ...m, [b.id]: e.target.value as 'ajouter' | 'retirer' | '' }))}
                    className={`${CHAMP} w-40`} style={STYLE_CHAMP} aria-label={b.code}>
                    <option value="">{t('pro_cctp_bulk_building_keep')}</option>
                    <option value="ajouter">{t('pro_cctp_bulk_building_add')}</option>
                    <option value="retirer">{t('pro_cctp_bulk_building_remove')}</option>
                  </select>
                </li>
              ))}
            </ul>
          </Rubrique>
        )}
      </div>
    </ModalShell>
  );
};
