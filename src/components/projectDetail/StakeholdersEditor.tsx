import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { ContactAutocomplete } from '../ContactAutocomplete';
import type { Contact, ProjectStakeholder } from '../../types';

/** Rôles proposés en saisie ; le champ reste libre. */
const ROLE_SUGGESTIONS = [
  'MOA', 'AMO', 'MOE', 'BET structure', 'BET fluides', 'BET thermique', 'Économiste',
  'Contrôleur technique', 'CSPS', 'OPC', 'Géomètre', 'Architecte des bâtiments de France',
];

type Draft = { id?: string; key: string; role: string; name: string; contact_id: string };

const toDraft = (s: ProjectStakeholder): Draft => ({ id: s.id, key: s.id, role: s.role, name: s.name, contact_id: s.contact_id || '' });
const isComplete = (d: Draft) => d.role.trim().length > 0 && (d.name.trim().length > 0 || d.contact_id.length > 0);

interface Props {
  stakeholders: ProjectStakeholder[];
  contacts: Contact[];
  onSave: (list: { id?: string; role: string; name: string; contact_id: string | null }[]) => Promise<void>;
  onCancel: () => void;
}

/**
 * Brouillon des intervenants de l'affaire : rien n'est écrit avant
 * « Enregistrer », donc retirer une ligne par erreur se rattrape avec « Annuler ».
 */
export function StakeholdersEditor({ stakeholders, contacts, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const rolesId = useId();
  const [drafts, setDrafts] = useState<Draft[]>(() => stakeholders.map(toDraft));
  const [saving, setSaving] = useState(false);

  const patch = (key: string, change: Partial<Draft>) => setDrafts(list => list.map(d => (d.key === key ? { ...d, ...change } : d)));
  const add = () => setDrafts(list => [...list, { key: crypto.randomUUID(), role: '', name: '', contact_id: '' }]);
  const remove = (key: string) => setDrafts(list => list.filter(d => d.key !== key));

  const incomplete = drafts.some(d => !isComplete(d));
  const save = async () => {
    setSaving(true);
    try {
      await onSave(drafts.map(d => ({ id: d.id, role: d.role.trim(), name: d.name.trim(), contact_id: d.contact_id || null })));
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full px-2.5 py-1.5 rounded-lg border bg-transparent text-xs outline-none focus:ring-2 focus:ring-blue-500';
  const border = { borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="flex flex-col gap-3">
      <datalist id={rolesId}>{ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
      {drafts.length === 0 && (
        <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_stakeholders_empty')}</p>
      )}
      {drafts.map(d => (
        <div key={d.key} className="flex flex-col gap-1.5 rounded-lg border p-2" style={{ borderColor: 'var(--tblr-border)' }}>
          <div className="flex items-center gap-1.5">
            <input
              className={field} style={border} list={rolesId} value={d.role}
              onChange={e => patch(d.key, { role: e.target.value })}
              placeholder={t('project_overview_stakeholders_role')} aria-label={t('project_overview_stakeholders_role')} maxLength={100}
            />
            <button
              type="button" onClick={() => remove(d.key)}
              aria-label={t('project_overview_stakeholders_remove', { name: d.role || d.name || t('project_overview_intervenant_unnamed') })}
              className="p-2 rounded-lg hover:bg-[var(--tblr-surface-2)] shrink-0" style={{ color: 'var(--tblr-muted)' }}
            >
              <IconTrash size={14} />
            </button>
          </div>
          <ContactAutocomplete
            contacts={contacts} value={d.contact_id} onChange={id => patch(d.key, { contact_id: id })}
            placeholder={t('project_overview_stakeholders_contact')}
            inputClassName="text-xs"
          />
          <input
            className={field} style={border} value={d.name}
            onChange={e => patch(d.key, { name: e.target.value })}
            placeholder={t('project_overview_stakeholders_name')} aria-label={t('project_overview_stakeholders_name')} maxLength={200}
          />
        </div>
      ))}
      <button
        type="button" onClick={add}
        className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border hover:bg-[var(--tblr-surface-2)]"
        style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-primary)' }}
      >
        <IconPlus size={13} /> {t('project_overview_stakeholders_add')}
      </button>
      {incomplete && (
        <p className="text-xs" role="status" style={{ color: 'var(--tblr-muted)' }}>{t('project_overview_stakeholders_incomplete')}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button" onClick={save} disabled={saving || incomplete}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--tblr-primary)' }}
        >
          {saving ? t('project_overview_stakeholders_saving') : t('project_overview_stakeholders_save')}
        </button>
        <button
          type="button" onClick={onCancel} disabled={saving}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold border hover:bg-[var(--tblr-surface-2)]"
          style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          {t('project_overview_stakeholders_cancel')}
        </button>
      </div>
    </div>
  );
}
