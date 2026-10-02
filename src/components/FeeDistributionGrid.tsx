// Grille de répartition des honoraires par mission et par cotraitant —
// extraite de src/pages/Proposals.tsx pour être partagée avec l'onglet
// Honoraires d'un appel d'offres MAPA (src/pages/TenderDetail.tsx via
// src/components/HonorairesSection.tsx). `doc`/`milestoneEntityField`
// généralisent ce qui était `proposal`/`proposal_id` : un devis et un appel
// d'offres portent chacun leurs jalons sous une clé étrangère différente
// (Milestone.proposal_id / Milestone.tender_id), le reste est identique.
import * as React from 'react';
import type { Contact, Milestone } from '../types';
import { DEFAULT_MISSIONS } from '../lib/feeDistribution';

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

  const handleRelPct = (missionId: string, newRelPct: number) => {
    const newData = { ...data, missions: [...data.missions] };
    const missionIndex = newData.missions.findIndex((m: any) => m.id === missionId);
    if (missionIndex === -1) return;
    const isBaseMission = newData.missions[missionIndex].category === 'Mission base';
    if (isBaseMission) {
      const baseMissions = newData.missions.filter((m: any) => m.category === 'Mission base');
      const idx = baseMissions.findIndex((m: any) => m.id === missionId);
      const targetTotal = doc.amount || 0;
      let sumAbove = 0;
      for (let i = 0; i < idx; i++) {
        sumAbove += (baseMissions[i].amount / targetTotal) * 100;
      }
      const remaining = 100 - sumAbove - newRelPct;
      newData.missions[missionIndex] = { ...newData.missions[missionIndex], amount: (newRelPct * targetTotal) / 100 };
      const missionsBelow = baseMissions.slice(idx + 1);
      const sumBelow = missionsBelow.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      if (missionsBelow.length > 0) {
        missionsBelow.forEach((mb: any) => {
          const mbIdx = newData.missions.findIndex((m: any) => m.id === mb.id);
          newData.missions[mbIdx] = {
            ...newData.missions[mbIdx],
            amount: sumBelow > 0
              ? (mb.amount / sumBelow) * remaining * targetTotal / 100
              : (remaining / missionsBelow.length * targetTotal) / 100,
          };
        });
      }
    } else {
      newData.missions[missionIndex] = { ...newData.missions[missionIndex], amount: (newRelPct * totalBaseAmount) / 100 };
    }
    onChange(newData);
  };

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
    const relPct = totalBaseAmount > 0 ? (amt / totalBaseAmount) * 100 : 0;
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
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(amt)}
            onBlur={e => updateMission(m.id, 'amount', parseFloat(e.target.value) || 0)} />
        </td>
        <td style={tdStyle}>
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(relPct)}
            onBlur={e => handleRelPct(m.id, parseFloat(e.target.value) || 0)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(soldeAmt).toLocaleString('fr-FR')}</td>
        <td style={tdStyle}>
          <input style={inputStyle} type="number" step="any" defaultValue={safeNum(archPct)}
            onBlur={e => updateMissionPct(m.id, 'architect', parseFloat(e.target.value) || 0)} />
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>{safeNum(archAmt).toLocaleString('fr-FR')}</td>
        {selectedContacts.map((c: any) => {
          const pct = m.percentages[c.id] || 0;
          const cAmt = amt * (pct / 100);
          return (
            <React.Fragment key={c.id}>
              <td style={tdStyle}>
                <input style={inputStyle} type="number" step="any" defaultValue={safeNum(pct)}
                  onBlur={e => updateMissionPct(m.id, c.id, parseFloat(e.target.value) || 0)} />
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
    const relPct = totalBaseAmount > 0 ? (totalAmt / totalBaseAmount) * 100 : 0;
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
        <td style={totalStyle}>{safeNum(relPct).toLocaleString('fr-FR')}</td>
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
