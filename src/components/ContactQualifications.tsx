import { useCallback, useEffect, useState } from 'react';
import {
  IconPlus, IconTrash, IconEdit, IconShieldCheck, IconShieldOff, IconDownload, IconExternalLink, IconX,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import {
  ORGANISMES, ORGANISME_LABELS, SOURCE_LABELS, QUALIBAT_ANNUAIRE_URL, formaterDate, normaliserSiret,
  resumeQualifications, siretValide, statutQualification,
  type OrganismeQualification, type Qualification,
} from '../lib/qualifications';
import { QualificationBadge } from './QualificationBadge';

interface Props {
  contactId: string;
  /** SIRET tel qu'affiché dans le formulaire (peut ne pas être encore enregistré). */
  siret?: string;
  /** Prévient le parent qu'une qualification a changé (pastilles d'un tableau voisin). */
  onChanged?: () => void;
}

interface Brouillon {
  id: string | null;
  organisme: OrganismeQualification;
  reference: string;
  libelle: string;
  domaines: string;
  date_debut: string;
  date_fin: string;
}

const VIDE: Brouillon = { id: null, organisme: 'qualibat', reference: '', libelle: '', domaines: '', date_debut: '', date_fin: '' };

const champ = 'w-full text-xs rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-blue-500/20';
const styleChamp = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };
const bouton = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50';

/**
 * Qualifications d'une entreprise sur sa fiche contact : saisie, import des
 * qualifications RGE de l'ADEME, contrôle du certificat. Aucune ne vaut
 * verdict : « contrôlée » veut dire qu'un humain a vu le certificat.
 */
export function ContactQualifications({ contactId, siret, onChanged }: Props) {
  const [liste, setListe] = useState<Qualification[]>([]);
  const [chargement, setChargement] = useState(true);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ton: 'info' | 'erreur'; texte: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      setListe(await apiFetch<Qualification[]>(`/api/qualifications?contact_id=${encodeURIComponent(contactId)}`));
    } catch {
      setMessage({ ton: 'erreur', texte: 'Impossible de lire les qualifications.' });
    } finally {
      setChargement(false);
    }
  }, [contactId]);

  useEffect(() => { void charger(); }, [charger]);

  const apres = async () => { await charger(); onChanged?.(); };
  const echec = (e: any, defaut: string) => setMessage({ ton: 'erreur', texte: e?.message || defaut });

  const enregistrer = async () => {
    if (!brouillon) return;
    setOccupe(true);
    setMessage(null);
    const corps = {
      organisme: brouillon.organisme, reference: brouillon.reference, libelle: brouillon.libelle,
      domaines: brouillon.domaines, date_debut: brouillon.date_debut, date_fin: brouillon.date_fin,
    };
    try {
      if (brouillon.id) await apiFetch(`/api/qualifications/${brouillon.id}`, { method: 'PUT', body: JSON.stringify(corps) });
      else await apiFetch(`/api/contacts/${contactId}/qualifications`, { method: 'POST', body: JSON.stringify(corps) });
      setBrouillon(null);
      await apres();
    } catch (e) { echec(e, "Impossible d'enregistrer la qualification."); }
    finally { setOccupe(false); }
  };

  const supprimer = async (q: Qualification) => {
    if (!window.confirm(`Supprimer la qualification ${ORGANISME_LABELS[q.organisme]}${q.reference ? ` ${q.reference}` : ''} ?`)) return;
    try { await apiFetch(`/api/qualifications/${q.id}`, { method: 'DELETE' }); await apres(); }
    catch (e) { echec(e, 'Impossible de supprimer la qualification.'); }
  };

  const basculerControle = async (q: Qualification) => {
    try {
      await apiFetch(`/api/qualifications/${q.id}/verify`, { method: 'POST', body: JSON.stringify({ verified: !q.verified_at }) });
      await apres();
    } catch (e) { echec(e, 'Impossible de mettre à jour le contrôle.'); }
  };

  const importerRge = async () => {
    setOccupe(true);
    setMessage(null);
    try {
      const r = await apiFetch<{ found: number; created: number; updated: number; skipped: number }>(
        `/api/contacts/${contactId}/qualifications/rge-sync`, { method: 'POST', body: JSON.stringify({}) });
      await apres();
      setMessage({
        ton: 'info',
        texte: r.found === 0
          ? "Aucune qualification RGE connue pour ce SIRET. Cela ne prouve pas que l'entreprise n'est pas qualifiée : la base ne couvre que les qualifications RGE."
          : `${r.created} ajoutée(s), ${r.updated} mise(s) à jour${r.skipped ? `, ${r.skipped} laissée(s) telle(s) quelle(s) car saisie(s) à la main` : ''}.`,
      });
    } catch (e) { echec(e, "Impossible d'importer les qualifications."); }
    finally { setOccupe(false); }
  };

  const verifierQualibat = async () => {
    const s = normaliserSiret(siret);
    try { await navigator.clipboard.writeText(s); } catch { /* presse-papiers indisponible : le SIRET reste affiché sur la fiche */ }
    window.open(QUALIBAT_ANNUAIRE_URL, '_blank', 'noopener,noreferrer');
    setMessage({
      ton: 'info',
      texte: `SIRET ${s ? 'copié' : 'à saisir'}. Contrôlez le certificat sur l'annuaire Qualibat, puis cliquez sur le bouclier de la qualification pour la marquer comme contrôlée.`,
    });
  };

  const resume = resumeQualifications(liste);
  const siretOk = siretValide(siret);
  const modifier = (q: Qualification) => setBrouillon({
    id: q.id, organisme: q.organisme, reference: q.reference || '', libelle: q.libelle || '',
    domaines: q.domaines || '', date_debut: q.date_debut || '', date_fin: q.date_fin || '',
  });

  return (
    <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Qualifications</p>
          {!chargement && <QualificationBadge resume={resume} liste={liste} />}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" className={cn(bouton, 'border')} style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            onClick={() => { setMessage(null); setBrouillon({ ...VIDE }); }}>
            <IconPlus size={13} /> Ajouter
          </button>
          <button type="button" className={cn(bouton, 'border')} style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            disabled={!siretOk || occupe} onClick={importerRge}
            title={siretOk ? "Importer les qualifications RGE connues de l'ADEME pour ce SIRET" : 'Renseignez un SIRET valide (et enregistrez la fiche) pour importer'}>
            <IconDownload size={13} /> Importer (base RGE)
          </button>
          <button type="button" className={cn(bouton, 'border')} style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
            onClick={verifierQualibat} title="Copie le SIRET et ouvre le site de Qualibat">
            <IconExternalLink size={13} /> Vérifier sur Qualibat
          </button>
        </div>
      </div>

      {message && (
        <p role="status" className={cn('text-[0.6875rem] rounded-md px-2 py-1.5', message.ton === 'erreur' ? 'text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300' : '')}
          style={message.ton === 'info' ? { color: 'var(--tblr-muted)' } : undefined}>
          {message.texte}
        </p>
      )}

      {brouillon && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label className="space-y-1">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Organisme</span>
              <select className={champ} style={styleChamp} value={brouillon.organisme}
                onChange={e => setBrouillon({ ...brouillon, organisme: e.target.value as OrganismeQualification })}>
                {ORGANISMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>N° ou code</span>
              <input className={champ} style={styleChamp} value={brouillon.reference} placeholder="ex. 2111"
                onChange={e => setBrouillon({ ...brouillon, reference: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Valable du</span>
              <input type="date" className={champ} style={styleChamp} value={brouillon.date_debut}
                onChange={e => setBrouillon({ ...brouillon, date_debut: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Au</span>
              <input type="date" className={champ} style={styleChamp} value={brouillon.date_fin}
                onChange={e => setBrouillon({ ...brouillon, date_fin: e.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Intitulé</span>
              <input className={champ} style={styleChamp} value={brouillon.libelle} placeholder="ex. Maçonnerie et béton armé"
                onChange={e => setBrouillon({ ...brouillon, libelle: e.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Domaines couverts</span>
              <input className={champ} style={styleChamp} value={brouillon.domaines}
                onChange={e => setBrouillon({ ...brouillon, domaines: e.target.value })} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={occupe} onClick={enregistrer} className={cn(bouton, 'bg-blue-600 text-white hover:bg-blue-700')}>
              {brouillon.id ? 'Enregistrer' : 'Ajouter la qualification'}
            </button>
            <button type="button" onClick={() => setBrouillon(null)} className={cn(bouton)} style={{ color: 'var(--tblr-muted)' }}>
              <IconX size={13} /> Annuler
            </button>
            {brouillon.id && <span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>Modifier une date ou un code retire le contrôle : il faudra le refaire.</span>}
          </div>
        </div>
      )}

      {!chargement && liste.length === 0 && !brouillon && (
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Aucune qualification enregistrée.</p>
      )}

      <ul className="space-y-1.5">
        {liste.map(q => {
          const statut = statutQualification(q);
          return (
            <li key={q.id} className="flex items-start justify-between gap-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>
                  {ORGANISME_LABELS[q.organisme]}{q.reference ? ` · ${q.reference}` : ''}
                  <span className="ml-2"><QualificationBadge enLigne resume={{ statut, principale: q, total: 1, verifiee: !!q.verified_at }} /></span>
                </p>
                {(q.libelle || q.domaines) && (
                  <p className="text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>{[q.libelle, q.domaines].filter(Boolean).join(' · ')}</p>
                )}
                <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                  {SOURCE_LABELS[q.source]}
                  {q.date_debut || q.date_fin ? ` · du ${formaterDate(q.date_debut) || '…'} au ${formaterDate(q.date_fin) || '…'}` : ''}
                  {' · '}
                  {q.verified_at ? `Contrôlée${q.verified_by ? ` par ${q.verified_by}` : ''} le ${new Date(q.verified_at).toLocaleDateString('fr-FR')}` : 'Non contrôlée'}
                </p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" onClick={() => basculerControle(q)} className="p-1.5 rounded-md hover:bg-black/5"
                  title={q.verified_at ? 'Retirer le contrôle' : 'Marquer comme contrôlée sur le certificat'}
                  aria-label={q.verified_at ? 'Retirer le contrôle' : 'Marquer comme contrôlée'}
                  style={{ color: q.verified_at ? '#059669' : 'var(--tblr-muted)' }}>
                  {q.verified_at ? <IconShieldCheck size={15} /> : <IconShieldOff size={15} />}
                </button>
                <button type="button" onClick={() => modifier(q)} className="p-1.5 rounded-md hover:bg-black/5" aria-label="Modifier" title="Modifier" style={{ color: 'var(--tblr-muted)' }}><IconEdit size={15} /></button>
                <button type="button" onClick={() => supprimer(q)} className="p-1.5 rounded-md hover:bg-black/5" aria-label="Supprimer" title="Supprimer" style={{ color: 'var(--tblr-muted)' }}><IconTrash size={15} /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
