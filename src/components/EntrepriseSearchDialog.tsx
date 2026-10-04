import { useEffect, useRef, useState } from 'react';
import { IconSearch, IconX, IconPlus, IconBuilding, IconLoader2, IconUserPlus } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import { CONTACT_CATEGORY_ENTREPRISE } from '../lib/contactCategories';
import { frenchVatNumber } from '../lib/siren';
import { formaterSiret, libelleEffectif, rueSeule, type ReponseRecherche, type ResultatRecherche } from '../lib/entreprisesSearch';
import { ORGANISME_LABELS, formaterDate, statutQualification } from '../lib/qualifications';

export interface EntrepriseChoisie {
  contactId: string;
  nom: string;
  siret: string;
  email: string;
  lotId?: string;
}

interface Props {
  onClose: () => void;
  /** Lots du projet : permet d'affecter l'entreprise en même temps qu'on l'ajoute à la consultation. */
  lots?: { id: string; lot_number: string; lot_title: string }[];
  /** Identifiants de fiches déjà dans la consultation. */
  dejaConsultes?: Set<string>;
  /** Absent hors consultation : seul l'ajout aux contacts est proposé. */
  onAddToConsultation?: (e: EntrepriseChoisie) => void;
  /** Une fiche vient d'être créée ou retrouvée (rafraîchir les listes voisines). */
  onContactReady?: () => void;
}

const TON_STATUT = {
  valide: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  bientot: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  expiree: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  sans_date: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
};

const champ = 'text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';

export function EntrepriseSearchDialog({ onClose, lots = [], dejaConsultes = new Set(), onAddToConsultation, onContactReady }: Props) {
  const [q, setQ] = useState('');
  const [departement, setDepartement] = useState('');
  const [batiment, setBatiment] = useState(true);
  const [rge, setRge] = useState(false);
  const [page, setPage] = useState(1);
  const [reponse, setReponse] = useState<ReponseRecherche | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lotId, setLotId] = useState('');
  const [enCours, setEnCours] = useState<string | null>(null); // siren en cours d'ajout
  const [ajoutes, setAjoutes] = useState<Record<string, string>>({}); // siren -> contact_id créé ici
  const entree = useRef<HTMLInputElement>(null);
  // Une réponse qui arrive après une recherche plus récente ne doit pas l'écraser.
  const derniere = useRef(0);

  useEffect(() => { entree.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chercher = async (numeroPage = 1) => {
    if (q.trim().length < 2) { setErreur('Saisissez au moins deux caractères.'); return; }
    const id = ++derniere.current;
    setChargement(true);
    setErreur(null);
    const params = new URLSearchParams({ q: q.trim(), page: String(numeroPage) });
    if (departement.trim()) params.set('departement', departement.trim());
    if (batiment) params.set('batiment', '1');
    if (rge) params.set('rge', '1');
    try {
      const r = await apiFetch<ReponseRecherche>(`/api/entreprises/search?${params.toString()}`);
      if (id !== derniere.current) return;
      setReponse(r);
      setPage(numeroPage);
    } catch (e: any) {
      if (id !== derniere.current) return;
      setReponse(null);
      setErreur(e?.message || 'La recherche a échoué.');
    } finally {
      if (id === derniere.current) setChargement(false);
    }
  };

  /** Retrouve la fiche du cabinet portant ce SIRET, ou la crée avec ce que l'annuaire fournit. */
  const assurerFiche = async (r: ResultatRecherche): Promise<string> => {
    const connu = r.contact_id || ajoutes[r.siren];
    if (connu) return connu;
    const creee = await apiFetch<{ id: string }>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({
        first_name: '', last_name: '',
        company_name: r.nom,
        category: CONTACT_CATEGORY_ENTREPRISE,
        siret: formaterSiret(r.siret),
        vat_number: frenchVatNumber(r.siren),
        address_work_street: rueSeule(r.adresse, r.code_postal, r.commune),
        address_work_zip: r.code_postal,
        address_work_city: r.commune,
      }),
    });
    setAjoutes(prev => ({ ...prev, [r.siren]: creee.id }));
    // Les qualifications RGE trouvées suivent la fiche (rejeu depuis le cache serveur).
    if (r.siret && r.qualifications && r.qualifications.length > 0) {
      await apiFetch(`/api/contacts/${creee.id}/qualifications/rge-sync`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    }
    return creee.id;
  };

  const ajouter = async (r: ResultatRecherche, versConsultation: boolean) => {
    setEnCours(r.siren);
    setErreur(null);
    try {
      const contactId = await assurerFiche(r);
      onContactReady?.();
      if (versConsultation && onAddToConsultation) {
        onAddToConsultation({ contactId, nom: r.nom, siret: r.siret, email: '', lotId: lotId || undefined });
      }
    } catch (e: any) {
      setErreur(e?.message || "Impossible d'ajouter l'entreprise.");
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Rechercher des entreprises"
        className="rounded-xl shadow-xl w-full max-w-3xl max-h-[88dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>Rechercher des entreprises</h3>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
              Annuaire des entreprises (SIRENE) et base RGE de l'ADEME. Les qualifications Qualibat n'apparaissent que pour les entreprises RGE : leur absence ne prouve rien.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <form className="p-4 flex items-end gap-2 flex-wrap" style={{ borderBottom: '1px solid var(--tblr-border)' }}
          onSubmit={e => { e.preventDefault(); void chercher(1); }}>
          <label className="flex-1 min-w-[200px] flex flex-col gap-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Nom, activité ou SIRET</span>
            <div className="relative">
              <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
              <input ref={entree} className={cn(champ, 'w-full pl-7')} value={q} onChange={e => setQ(e.target.value)} placeholder="ex. charpente, étanchéité, Dupont…" />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Département</span>
            <input className={cn(champ, 'w-24')} value={departement} onChange={e => setDepartement(e.target.value)} placeholder="54" maxLength={3} />
          </label>
          <label className="flex items-center gap-1.5 text-xs pb-2" style={{ color: 'var(--tblr-text)' }}>
            <input type="checkbox" className="w-3.5 h-3.5 rounded" checked={batiment} onChange={e => setBatiment(e.target.checked)} /> Bâtiment
          </label>
          <label className="flex items-center gap-1.5 text-xs pb-2" style={{ color: 'var(--tblr-text)' }}>
            <input type="checkbox" className="w-3.5 h-3.5 rounded" checked={rge} onChange={e => setRge(e.target.checked)} /> RGE uniquement
          </label>
          <button type="submit" disabled={chargement} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
            {chargement ? <IconLoader2 size={13} className="animate-spin" /> : <IconSearch size={13} />} Rechercher
          </button>
        </form>

        {onAddToConsultation && lots.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2 text-xs" style={{ borderBottom: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            Affecter à la consultation sur
            <select className={champ} value={lotId} onChange={e => setLotId(e.target.value)} aria-label="Lot à affecter">
              <option value="">aucun lot pour l'instant</option>
              {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} · {l.lot_title}</option>)}
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2" aria-live="polite">
          {erreur && <p role="alert" className="text-xs rounded-md px-3 py-2 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300">{erreur}</p>}
          {reponse?.rge_indisponible && (
            <p className="text-xs rounded-md px-3 py-2 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              La base RGE de l'ADEME est injoignable : les qualifications ne sont pas affichées pour cette recherche.
            </p>
          )}
          {!reponse && !erreur && !chargement && (
            <p className="text-xs text-center py-8 italic" style={{ color: 'var(--tblr-muted)' }}>Saisissez un nom, un métier ou un SIRET puis lancez la recherche.</p>
          )}
          {reponse && reponse.resultats.length === 0 && (
            <p className="text-xs text-center py-8 italic" style={{ color: 'var(--tblr-muted)' }}>Aucune entreprise trouvée. Essayez un autre mot, ou décochez « Bâtiment » ou « RGE uniquement ».</p>
          )}
          {reponse && reponse.resultats.map(r => {
            const contactId = r.contact_id || ajoutes[r.siren] || null;
            const dejaDansConsultation = !!contactId && dejaConsultes.has(contactId);
            const occupe = enCours === r.siren;
            const effectif = libelleEffectif(r.effectif);
            return (
              <article key={r.siren} className="rounded-lg p-3 flex gap-3 justify-between items-start flex-wrap" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--tblr-text)' }}>
                    <IconBuilding size={14} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />{r.nom}
                  </p>
                  <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                    {[r.adresse, r.siret ? `SIRET ${formaterSiret(r.siret)}` : `SIREN ${r.siren}`].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                    {[r.naf && `${r.naf}${r.naf_libelle ? ` ${r.naf_libelle}` : ''}`, effectif].filter(Boolean).join(' · ')}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {r.qualifications && r.qualifications.length > 0 && r.qualifications.map(qa => {
                      const statut = statutQualification(qa);
                      return (
                        <span key={`${qa.organisme}|${qa.reference}`} className={cn('px-2 py-0.5 rounded-full text-[0.6875rem] font-bold', TON_STATUT[statut])}
                          title={[qa.libelle, qa.domaines].filter(Boolean).join(' · ')}>
                          {ORGANISME_LABELS[qa.organisme]}{qa.reference ? ` ${qa.reference}` : ''}{qa.date_fin ? ` · ${formaterDate(qa.date_fin)}` : ''}
                        </span>
                      );
                    })}
                    {r.qualifications && r.qualifications.length === 0 && (
                      <span className="text-[0.6875rem] italic" style={{ color: 'var(--tblr-muted)' }}>
                        {r.rge_declaree ? 'Déclarée RGE, détail indisponible' : 'Aucune qualification RGE connue'}
                      </span>
                    )}
                    {contactId && <span className="px-2 py-0.5 rounded-full text-[0.6875rem] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Dans vos contacts</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {onAddToConsultation && (
                    <button type="button" disabled={occupe || dejaDansConsultation} onClick={() => ajouter(r, true)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 justify-center">
                      {occupe ? <IconLoader2 size={13} className="animate-spin" /> : <IconPlus size={13} />}
                      {dejaDansConsultation ? 'Déjà consultée' : 'Ajouter à la consultation'}
                    </button>
                  )}
                  {!contactId && (
                    <button type="button" disabled={occupe} onClick={() => ajouter(r, false)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold border hover:bg-black/5 disabled:opacity-50 flex items-center gap-1.5 justify-center"
                      style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
                      <IconUserPlus size={13} /> Ajouter aux contacts
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {reponse && reponse.pages > 1 && (
          <div className="px-4 py-2.5 flex items-center justify-between text-xs" style={{ borderTop: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
            <span>{reponse.total.toLocaleString('fr-FR')} résultat{reponse.total > 1 ? 's' : ''} · page {page} sur {reponse.pages}</span>
            <div className="flex gap-1.5">
              <button type="button" disabled={page <= 1 || chargement} onClick={() => chercher(page - 1)} className="px-2.5 py-1 rounded-lg font-bold border disabled:opacity-40" style={{ borderColor: 'var(--tblr-border)' }}>Précédent</button>
              <button type="button" disabled={page >= reponse.pages || chargement} onClick={() => chercher(page + 1)} className="px-2.5 py-1 rounded-lg font-bold border disabled:opacity-40" style={{ borderColor: 'var(--tblr-border)' }}>Suivant</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
