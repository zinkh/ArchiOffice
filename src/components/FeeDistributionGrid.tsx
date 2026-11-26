// Grille de répartition des honoraires par mission et par cotraitant —
// extraite de src/pages/Proposals.tsx pour être partagée avec l'onglet
// Honoraires d'un appel d'offres MAPA (src/pages/TenderDetail.tsx via
// src/components/HonorairesSection.tsx). `doc`/`milestoneEntityField`
// généralisent ce qui était `proposal`/`proposal_id` : un devis et un appel
// d'offres portent chacun leurs jalons sous une clé étrangère différente
// (Milestone.proposal_id / Milestone.tender_id), le reste est identique.
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { Contact, Milestone } from '../types';
import { DEFAULT_MISSIONS, applyDefaultCotraitantShares } from '../lib/feeDistribution';
import {
  tranchesActives, listeTranches, trancheDeMission, missionsDeTranche, totauxParTranche,
  modifierTranche, supprimerTranche, deplacerTranche, affecterMission, dupliquerMissionSurTranche,
  type Tranche,
} from '../lib/tranches';

/**
 * Champ numérique contrôlé : affiche toujours la valeur calculée (un `defaultValue`
 * restait figé après un recalcul, d'où des montants à 0 et des Rel % périmés), et
 * garde le texte en cours de frappe tant que le champ a le focus. La valeur est
 * remontée à chaque modification, y compris aux flèches du champ.
 */
function NumCell({ value, onCommit, style }: { value: number; onCommit: (v: number) => void; style: React.CSSProperties }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      style={style}
      type="number"
      step="any"
      value={draft ?? String(value)}
      onFocus={() => setDraft(String(value))}
      onChange={e => { setDraft(e.target.value); onCommit(parseFloat(e.target.value) || 0); }}
      onBlur={() => setDraft(null)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export interface FeeDistributionDoc {
  id?: string;
  amount?: number;
  fee_distribution?: string;
  specialties_list?: { id?: string; specialty_name?: string; contact_id?: string }[];
  decimal_precision?: number;
  vat_rate?: number;
}

export interface FeeDistributionGridProps {
  doc: FeeDistributionDoc;
  contacts: Contact[];
  onChange: (data: any) => void;
  milestones: Milestone[];
  onMilestonesChange: (milestones: Milestone[]) => void;
  /** Quelle clé étrangère de Milestone rattache un jalon à ce document. */
  milestoneEntityField: 'proposal_id' | 'tender_id';
}

export function FeeDistributionGrid({ doc, contacts, onChange, milestones, onMilestonesChange, milestoneEntityField }: FeeDistributionGridProps) {
  const { t } = useTranslation();
  const totalLabels: Record<string, string> = {
    'Sous-total Base': t('fee_grid_subtotal_base'),
    'Sous-total Exécution': t('fee_grid_subtotal_exe'),
    'Total Base + Exé': t('fee_grid_total_base_exe'),
    'Sous-total Complémentaire': t('fee_grid_subtotal_comp'),
    'TOTAL GENERAL HT': t('fee_grid_total_ht'),
  };
  const data = React.useMemo(() => {
    if (doc.fee_distribution) {
      try {
        return JSON.parse(doc.fee_distribution);
      } catch (e) {}
    }
    return { missions: DEFAULT_MISSIONS.map(m => ({ ...m, percentages: { architect: 100 } })) };
  }, [doc.fee_distribution]);

  React.useEffect(() => {
    if (!doc.id) return;
    const currentMissions = data.missions;
    const currentMilestones = milestones.filter(m => m[milestoneEntityField] === doc.id);
    let hasChanges = false;
    const updatedMilestones = [...currentMilestones];
    currentMissions.forEach((mission: any) => {
      if (!currentMilestones.find(m => m.title === mission.name)) {
        updatedMilestones.push({
          id: `ms-${Date.now()}-${Math.random()}`,
          [milestoneEntityField]: doc.id,
          title: mission.name,
          due_date: new Date().toISOString(),
          completed: false,
          duration_days: 30,
        } as Milestone);
        hasChanges = true;
      }
    });
    const finalMilestones = updatedMilestones.filter(m =>
      currentMissions.find((mission: any) => mission.name === m.title)
    );
    if (finalMilestones.length !== currentMilestones.length || hasChanges) {
      onMilestonesChange(finalMilestones);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.missions, doc.id]);

  const selectedContacts = React.useMemo(() => {
    const list = doc.specialties_list || [];
    return list.map((s: any) => {
      const contact = contacts.find(c => c.id === s.contact_id);
      return {
        id: s.contact_id || s.id,
        name: contact ? `${contact.first_name} ${contact.last_name}` : s.specialty_name,
        role: s.specialty_name,
      };
    }).filter((c: any) => c.id);
  }, [doc.specialties_list, contacts]);

  const precision = (typeof doc.decimal_precision === 'number' && !isNaN(doc.decimal_precision)) ? doc.decimal_precision : 2;
  const safeNum = (val: number) => isNaN(val) ? 0 : Number(val.toFixed(precision));

  const totalBaseAmount = React.useMemo(() => {
    return data.missions
      .filter((m: any) => m.category === 'Mission base')
      .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
  }, [data.missions]);

  const updateMission = (missionId: string, field: string, value: any) => {
    const newData = { ...data, missions: data.missions.map((m: any) => m.id === missionId ? { ...m, [field]: value } : m) };
    onChange(newData);
  };

  const updateMissionPct = (missionId: string, key: string, value: number) => {
    const newData = {
      ...data,
      missions: data.missions.map((m: any) =>
        m.id === missionId ? { ...m, percentages: { ...m.percentages, [key]: value } } : m
      ),
    };
    onChange(newData);
  };

  // Les Rel % se lisent par rapport aux honoraires de base du document (doc.amount) ; à
  // défaut de montant global, par rapport au sous-total de base. Avec le sous-total
  // comme référence, le total de base valait toujours 100 % quoi qu'on saisisse.
  const refAmount = (doc.amount && doc.amount > 0) ? doc.amount : totalBaseAmount;

  // Saisir un Rel % fixe le montant HT de la seule mission concernée : les autres ne
  // bougent pas, et le sous-total de base montre l'écart avec 100 %.
  const handleRelPct = (missionId: string, newRelPct: number) => {
    updateMission(missionId, 'amount', (newRelPct * refAmount) / 100);
  };

  // Compléter uniquement les parts absentes, sans modifier les saisies manuelles.
  const contactIdsKey = selectedContacts.map((c: any) => c.id).join('|');
  React.useEffect(() => {
    const ids = contactIdsKey ? contactIdsKey.split('|') : [];
    const next = applyDefaultCotraitantShares(data.missions, ids);
    if (next) onChange({ ...data, missions: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIdsKey, doc.fee_distribution]);

  // Tranches fermes et conditionnelles (voir src/lib/tranches.ts) : sans liste de
  // tranches enregistrée, la grille s'affiche exactement comme avant.
  const tranchesOn = tranchesActives(data);
  const tranches: Tranche[] = listeTranches(data);

  const deleteMission = (missionId: string) => {
    const newData = { ...data, missions: data.missions.filter((m: any) => m.id !== missionId) };
    onChange(newData);
  };

  const thStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 12, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '2px 4px', border: '1px solid #e2e8f0', fontSize: 12 };
  const inputStyle: React.CSSProperties = { width: '100%', border: 'none', background: 'transparent', fontSize: 12, padding: '2px', outline: 'none', textAlign: 'right' };
  const catStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#e2e8f0', fontWeight: 700, fontSize: 12 };
  const trancheStyle: React.CSSProperties = { padding: '5px 6px', border: '1px solid #94a3b8', background: '#cbd5e1', fontWeight: 700, fontSize: 13 };
  const totalStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, fontSize: 12, textAlign: 'right' };

  const colCount = 6 + selectedContacts.length * 2 + 1;

  const renderMissionRow = (m: any) => {
    const isBase = m.category === 'Mission base' && !String(m.id).includes('__');
    const trancheCourante = trancheDeMission(m, tranches);
    const autresTranches = tranches.filter(x => x.id !== trancheCourante.id);
    const amt = m.amount || 0;
    const relPct = refAmount > 0 ? (amt / refAmount) * 100 : 0;
    const archPct = m.percentages?.['architect'] ?? 100;
    const archAmt = amt * (archPct / 100);
    let sumPct = archPct;
    selectedContacts.forEach((c: any) => { sumPct += (m.percentages[c.id] || 0); });
    const soldeAmt = amt * ((100 - sumPct) / 100);
    return (
      <tr key={m.id}>
        <td style={tdStyle}>
          <input style={{ ...inputStyle, textAlign: 'left' }} defaultValue={m.name}
            onBlur={e => updateMission(m.id, 'name', e.target.value)} />
        </td>
        <td style={tdStyle}>
          <NumCell style={inputStyle} value={safeNum(amt)} onCommit={v => updateMission(m.id, 'amount', v)} />
        </td>
        <td style={tdStyle}>
          <NumCell style={inputStyle} value={safeNum(relPct)} onCommit={v => handleRelPct(m.id, v)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(soldeAmt).toLocaleString('fr-FR')}</td>
        <td style={tdStyle}>
          <NumCell style={inputStyle} value={safeNum(archPct)} onCommit={v => updateMissionPct(m.id, 'architect', v)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(archAmt).toLocaleString('fr-FR')}</td>
        {selectedContacts.map((c: any) => {
          const pct = m.percentages[c.id] || 0;
          const cAmt = amt * (pct / 100);
          return (
            <React.Fragment key={c.id}>
              <td style={tdStyle}>
                <NumCell style={inputStyle} value={safeNum(pct)} onCommit={v => updateMissionPct(m.id, c.id, v)} />
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(cAmt).toLocaleString('fr-FR')}</td>
            </React.Fragment>
          );
        })}
        <td style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {tranchesOn && autresTranches.length > 0 && (
            <>
              <select
                aria-label={t('fee_tranches_move')} title={t('fee_tranches_move')} value=""
                style={{ fontSize: 11, maxWidth: 46 }}
                onChange={e => { if (e.target.value) onChange(affecterMission(data, m.id, e.target.value)); }}
              >
                <option value="">⇄</option>
                {autresTranches.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <select
                aria-label={t('fee_tranches_split')} title={t('fee_tranches_split')} value=""
                style={{ fontSize: 11, maxWidth: 46 }}
                onChange={e => { if (e.target.value) onChange(dupliquerMissionSurTranche(data, m.id, e.target.value)); }}
              >
                <option value="">⧉</option>
                {autresTranches.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </>
          )}
          {!isBase && (
            <button onClick={() => deleteMission(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }} title="Supprimer">🗑️</button>
          )}
        </td>
      </tr>
    );
  };

  const renderTotalRow = (label: string, missions: any[], opts: { key?: string; display?: string } = {}) => {
    const totalAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
    const relPct = refAmount > 0 ? (totalAmt / refAmount) * 100 : 0;
    // Le sous-total de base doit faire 100 % des honoraires de base : on signale tout écart.
    const relEcart = !tranchesOn && label === 'Sous-total Base' && refAmount > 0 && Math.abs(relPct - 100) > 0.005;
    const totalSolde = missions.reduce((acc: number, m: any) => {
      const mAmt = m.amount || 0;
      const archPct = m.percentages?.['architect'] ?? 100;
      let sumPct = archPct;
      selectedContacts.forEach((c: any) => { sumPct += (m.percentages[c.id] || 0); });
      return acc + mAmt * ((100 - sumPct) / 100);
    }, 0);
    const totalArchAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0) * ((m.percentages?.['architect'] ?? 100) / 100), 0);
    return (
      <tr key={opts.key ?? label}>
        <td style={totalStyle}>{opts.display ?? totalLabels[label] ?? label}</td>
        <td style={totalStyle}>{safeNum(totalAmt).toLocaleString('fr-FR')}</td>
        <td
          style={relEcart ? { ...totalStyle, color: '#b91c1c' } : totalStyle}
          title={relEcart ? t('fee_grid_base_not_100') : undefined}
        >{safeNum(relPct).toLocaleString('fr-FR')}</td>
        <td style={totalStyle}>{safeNum(totalSolde).toLocaleString('fr-FR')}</td>
        <td style={totalStyle}>—</td>
        <td style={totalStyle}>{safeNum(totalArchAmt).toLocaleString('fr-FR')}</td>
        {selectedContacts.map((c: any) => {
          const cAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0) * ((m.percentages[c.id] || 0) / 100), 0);
          return (
            <React.Fragment key={c.id}>
              <td style={totalStyle}>—</td>
              <td style={totalStyle}>{safeNum(cAmt).toLocaleString('fr-FR')}</td>
            </React.Fragment>
          );
        })}
        <td style={totalStyle} />
      </tr>
    );
  };

  const baseMissions = data.missions.filter((m: any) => m.category === 'Mission base');
  const exeMissions = data.missions.filter((m: any) => m.category === 'Mission Exécution');
  const compMissions = data.missions.filter((m: any) => m.category === 'Missions complémentaires');
  const allMissions = [...baseMissions, ...exeMissions, ...compMissions];

  const totalHT = allMissions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
  const vatRate = doc.vat_rate || 20;
  const vatAmt = totalHT * (vatRate / 100);
  const totalTTC = totalHT + vatAmt;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
        <thead>
          <tr>
            <th style={thStyle} rowSpan={2}>{t('fee_grid_designation')}</th>
            <th style={thStyle} rowSpan={2}>{t('fee_grid_amount_ht')}</th>
            <th style={thStyle} rowSpan={2}>{t('fee_grid_rel_pct')}</th>
            <th style={thStyle} rowSpan={2}>{t('fee_grid_balance')}</th>
            <th style={{ ...thStyle, textAlign: 'center' }} colSpan={2}>{t('fee_grid_architect')}</th>
            {selectedContacts.map((c: any) => (
              <th key={c.id} style={{ ...thStyle, textAlign: 'center' }} colSpan={2}>{c.name}</th>
            ))}
            <th style={thStyle} rowSpan={2} />
          </tr>
          <tr>
            <th style={thStyle}>%</th>
            <th style={thStyle}>€</th>
            {selectedContacts.map((c: any) => (
              <React.Fragment key={c.id}>
                <th style={thStyle}>%</th>
                <th style={thStyle}>€</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {tranchesOn ? (
            <>
              {tranches.map((tr, idx) => {
                const missionsTr = missionsDeTranche(data.missions, tr, tranches);
                const parCategorie = [
                  { cat: 'Mission base', label: t('fee_grid_cat_base') },
                  { cat: 'Mission Exécution', label: t('fee_grid_cat_exe') },
                  { cat: 'Missions complémentaires', label: t('fee_grid_cat_comp') },
                ];
                return (
                  <React.Fragment key={tr.id}>
                    <tr>
                      <td style={trancheStyle} colSpan={colCount}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <input
                            key={`${tr.id}-${tr.label}`} defaultValue={tr.label} aria-label="Nom de la tranche"
                            style={{ ...inputStyle, textAlign: 'left', width: 220, fontWeight: 700, background: '#fff', border: '1px solid #94a3b8', borderRadius: 4 }}
                            onBlur={e => { if (e.target.value.trim() && e.target.value !== tr.label) onChange(modifierTranche(data, tr.id, { label: e.target.value.trim() })); }}
                          />
                          <select
                            value={tr.type} aria-label="Type de tranche" style={{ fontSize: 12 }}
                            onChange={e => onChange(modifierTranche(data, tr.id, { type: e.target.value as Tranche['type'] }))}
                          >
                            <option value="ferme">{t('fee_tranches_type_firm')}</option>
                            <option value="conditionnelle">{t('fee_tranches_type_cond')}</option>
                          </select>
                          {tr.type === 'conditionnelle' && (
                            <input
                              key={`${tr.id}-cond`} defaultValue={tr.condition ?? ''} placeholder={t('fee_tranches_condition_ph')}
                              style={{ ...inputStyle, textAlign: 'left', flex: 1, minWidth: 240, fontWeight: 400, background: '#fff', border: '1px solid #94a3b8', borderRadius: 4 }}
                              onBlur={e => { if (e.target.value !== (tr.condition ?? '')) onChange(modifierTranche(data, tr.id, { condition: e.target.value })); }}
                            />
                          )}
                          <button type="button" title={t('fee_tranches_up')} disabled={idx === 0} onClick={() => onChange(deplacerTranche(data, tr.id, -1))} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>↑</button>
                          <button type="button" title={t('fee_tranches_down')} disabled={idx === tranches.length - 1} onClick={() => onChange(deplacerTranche(data, tr.id, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>↓</button>
                          {tranches.length > 1 && (
                            <button type="button" title={t('fee_tranches_remove')} onClick={() => onChange(supprimerTranche(data, tr.id))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {parCategorie.map(({ cat, label }) => {
                      const lignes = missionsTr.filter((m: any) => m.category === cat);
                      if (lignes.length === 0) return null;
                      return (
                        <React.Fragment key={cat}>
                          <tr><td style={catStyle} colSpan={colCount}>{label}</td></tr>
                          {lignes.map(renderMissionRow)}
                        </React.Fragment>
                      );
                    })}
                    {missionsTr.length === 0 && (
                      <tr><td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b' }} colSpan={colCount}>{t('fee_tranches_empty')}</td></tr>
                    )}
                    {renderTotalRow(tr.label, missionsTr, { key: `total-${tr.id}`, display: t('fee_tranches_total', { label: tr.label }) })}
                  </React.Fragment>
                );
              })}
              {renderTotalRow('TOTAL FERME', tranches.filter(x => x.type === 'ferme').flatMap(x => missionsDeTranche(data.missions, x, tranches)), { key: 'total-ferme', display: t('fee_tranches_total_firm') })}
              {tranches.some(x => x.type === 'conditionnelle') && renderTotalRow('TOTAL CONDITIONNEL', tranches.filter(x => x.type === 'conditionnelle').flatMap(x => missionsDeTranche(data.missions, x, tranches)), { key: 'total-cond', display: t('fee_tranches_total_cond') })}
              {renderTotalRow('TOTAL GENERAL HT', data.missions)}
            </>
          ) : (
            <>
          <tr><td style={catStyle} colSpan={colCount}>{t('fee_grid_cat_base')}</td></tr>
          {baseMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Base', baseMissions)}

          <tr><td style={catStyle} colSpan={colCount}>{t('fee_grid_cat_exe')}</td></tr>
          {exeMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Exécution', exeMissions)}
          {renderTotalRow('Total Base + Exé', [...baseMissions, ...exeMissions])}

          <tr><td style={catStyle} colSpan={colCount}>{t('fee_grid_cat_comp')}</td></tr>
          {compMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Complémentaire', compMissions)}
          {renderTotalRow('TOTAL GENERAL HT', allMissions)}

            </>
          )}

          <tr>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b' }}>{t('fee_grid_vat', { rate: vatRate })}</td>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b', textAlign: 'right' }}>{safeNum(vatAmt).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af' }}>{t('fee_grid_total_ttc')}</td>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af', textAlign: 'right' }}>{safeNum(totalTTC).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
