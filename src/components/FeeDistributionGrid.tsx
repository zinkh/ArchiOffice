// Grille de répartition des honoraires par mission et par cotraitant —
// extraite de src/pages/Proposals.tsx pour être partagée avec l'onglet
// Honoraires d'un appel d'offres MAPA (src/pages/TenderDetail.tsx via
// src/components/HonorairesSection.tsx). `doc`/`milestoneEntityField`
// généralisent ce qui était `proposal`/`proposal_id` : un devis et un appel
// d'offres portent chacun leurs jalons sous une clé étrangère différente
// (Milestone.proposal_id / Milestone.tender_id), le reste est identique.
import * as React from 'react';
import type { Contact, Milestone } from '../types';
import { DEFAULT_MISSIONS, applyDefaultCotraitantShares } from '../lib/feeDistribution';

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
  const data = React.useMemo(() => {
    if (doc.fee_distribution) {
      try {
        return JSON.parse(doc.fee_distribution);
      } catch (e) {}
    }
    return { missions: DEFAULT_MISSIONS.map(m => ({ ...m, percentages: {} })) };
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

  // Un cotraitant qui apparaît reçoit, sur chaque mission, la part par défaut du
  // tableau type du cabinet ; l'architecte prend le complément. Seules les parts
  // jamais saisies sont complétées : une valeur déjà posée, même à 0, reste.
  const contactIdsKey = selectedContacts.map((c: any) => c.id).join('|');
  React.useEffect(() => {
    const ids = contactIdsKey ? contactIdsKey.split('|') : [];
    const next = applyDefaultCotraitantShares(data.missions, ids);
    if (next) onChange({ ...data, missions: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactIdsKey, doc.fee_distribution]);

  const deleteMission = (missionId: string) => {
    const newData = { ...data, missions: data.missions.filter((m: any) => m.id !== missionId) };
    onChange(newData);
  };

  const thStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 12, fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '2px 4px', border: '1px solid #e2e8f0', fontSize: 12 };
  const inputStyle: React.CSSProperties = { width: '100%', border: 'none', background: 'transparent', fontSize: 12, padding: '2px', outline: 'none', textAlign: 'right' };
  const catStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#e2e8f0', fontWeight: 700, fontSize: 12 };
  const totalStyle: React.CSSProperties = { padding: '3px 6px', border: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: 700, fontSize: 12, textAlign: 'right' };

  const colCount = 6 + selectedContacts.length * 2 + 1;

  const renderMissionRow = (m: any) => {
    const isBase = m.category === 'Mission base';
    const amt = m.amount || 0;
    const relPct = refAmount > 0 ? (amt / refAmount) * 100 : 0;
    const archPct = m.percentages['architect'] || 0;
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
        <td style={{ ...tdStyle, textAlign: 'center' }}>
          {!isBase && (
            <button onClick={() => deleteMission(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }} title="Supprimer">🗑️</button>
          )}
        </td>
      </tr>
    );
  };

  const renderTotalRow = (label: string, missions: any[]) => {
    const totalAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
    const relPct = refAmount > 0 ? (totalAmt / refAmount) * 100 : 0;
    // Le sous-total de base doit faire 100 % des honoraires de base : on signale tout écart.
    const relEcart = label === 'Sous-total Base' && refAmount > 0 && Math.abs(relPct - 100) > 0.005;
    const totalSolde = missions.reduce((acc: number, m: any) => {
      const mAmt = m.amount || 0;
      const archPct = m.percentages['architect'] || 0;
      let sumPct = archPct;
      selectedContacts.forEach((c: any) => { sumPct += (m.percentages[c.id] || 0); });
      return acc + mAmt * ((100 - sumPct) / 100);
    }, 0);
    const totalArchAmt = missions.reduce((acc: number, m: any) => acc + (m.amount || 0) * ((m.percentages['architect'] || 0) / 100), 0);
    return (
      <tr key={label}>
        <td style={totalStyle}>{label}</td>
        <td style={totalStyle}>{safeNum(totalAmt).toLocaleString('fr-FR')}</td>
        <td
          style={relEcart ? { ...totalStyle, color: '#b91c1c' } : totalStyle}
          title={relEcart ? 'Le total des missions de base ne fait pas 100 % des honoraires de base' : undefined}
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
            <th style={thStyle} rowSpan={2}>Désignation</th>
            <th style={thStyle} rowSpan={2}>Montant HT</th>
            <th style={thStyle} rowSpan={2}>Rel %</th>
            <th style={thStyle} rowSpan={2}>Solde</th>
            <th style={{ ...thStyle, textAlign: 'center' }} colSpan={2}>Architecte</th>
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
          <tr><td style={catStyle} colSpan={colCount}>Mission base</td></tr>
          {baseMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Base', baseMissions)}

          <tr><td style={catStyle} colSpan={colCount}>Mission Exécution</td></tr>
          {exeMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Exécution', exeMissions)}
          {renderTotalRow('Total Base + Exé', [...baseMissions, ...exeMissions])}

          <tr><td style={catStyle} colSpan={colCount}>Missions complémentaires</td></tr>
          {compMissions.map(renderMissionRow)}
          {renderTotalRow('Sous-total Complémentaire', compMissions)}
          {renderTotalRow('TOTAL GENERAL HT', allMissions)}

          <tr>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b' }}>TVA ({vatRate}%)</td>
            <td style={{ ...tdStyle, fontStyle: 'italic', color: '#64748b', textAlign: 'right' }}>{safeNum(vatAmt).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af' }}>TOTAL TTC</td>
            <td style={{ ...tdStyle, fontWeight: 700, color: '#1e40af', textAlign: 'right' }}>{safeNum(totalTTC).toLocaleString('fr-FR')}</td>
            {Array.from({ length: colCount - 2 }).map((_, i) => <td key={i} style={tdStyle} />)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
