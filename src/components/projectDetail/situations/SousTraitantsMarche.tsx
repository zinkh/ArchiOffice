import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiFetch } from '../../../lib/api';
import { inputClass, boutonSecondaire } from './DialogShell';

export interface SousTraitantMarche {
  id: string;
  marche_id: string;
  nom: string;
  siret?: string | null;
  adresse?: string | null;
  objet?: string | null;
}

/**
 * Sous-traitants d'une entreprise titulaire. Ils ne figurent pas sur le panneau
 * de chantier : ils sont repris dans la liste publique des entreprises atteinte
 * par le QR code du panneau.
 */
export function SousTraitantsMarche({ marcheId, liste, onChange, showToast }: {
  marcheId: string;
  liste: SousTraitantMarche[];
  onChange: () => void;
  showToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ nom: '', adresse: '', siret: '', objet: '' });
  const champ = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const ajouter = async () => {
    if (!form.nom.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/marches-entreprises/${marcheId}/sous-traitants`, { method: 'POST', body: JSON.stringify(form) });
      setForm({ nom: '', adresse: '', siret: '', objet: '' });
      setOuvert(false);
      onChange();
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_subcontractor_save_failed'));
    } finally {
      setBusy(false);
    }
  };

  const retirer = async (st: SousTraitantMarche) => {
    try {
      await apiFetch(`/api/sous-traitants/${st.id}`, { method: 'DELETE' });
      onChange();
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_subcontractor_delete_failed'));
    }
  };

  return (
    <div className="px-4 sm:px-5 py-3 border-t border-[var(--tblr-border)]">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--tblr-muted)]">{t('situations_travaux_subcontractors')}</h4>
        <button type="button" className={boutonSecondaire} onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
          <IconPlus size={14} /> {t('situations_travaux_subcontractor_add')}
        </button>
      </div>
      {liste.length > 0 ? (
        <ul className="mt-2 divide-y divide-[var(--tblr-border)]">
          {liste.map((st) => (
            <li key={st.id} className="py-2 flex items-start gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-[var(--tblr-text)]">{st.nom}</div>
                <div className="text-xs text-[var(--tblr-muted)]">
                  {[st.objet, st.adresse, st.siret ? `SIRET ${st.siret}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button type="button" className={boutonSecondaire + ' px-2'} onClick={() => retirer(st)}
                aria-label={t('situations_travaux_subcontractor_delete_named', { name: st.nom })}>
                <IconTrash size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[var(--tblr-muted)]">{t('situations_travaux_subcontractors_none')}</p>
      )}
      {ouvert && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_subcontractor_name')}
            <input className={inputClass} value={form.nom} onChange={(e) => champ('nom', e.target.value)} maxLength={200} />
          </label>
          <label className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_subcontractor_object')}
            <input className={inputClass} value={form.objet} onChange={(e) => champ('objet', e.target.value)} maxLength={200} />
          </label>
          <label className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_subcontractor_address')}
            <input className={inputClass} value={form.adresse} onChange={(e) => champ('adresse', e.target.value)} maxLength={300} />
          </label>
          <label className="text-xs text-[var(--tblr-muted)]">SIRET
            <input className={inputClass} value={form.siret} onChange={(e) => champ('siret', e.target.value)} maxLength={20} />
          </label>
          <div className="sm:col-span-2">
            <button type="button" className={boutonSecondaire} onClick={ajouter} disabled={busy || !form.nom.trim()}>
              {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />} {t('situations_travaux_subcontractor_save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
