// Vue « Détaillée » de /contacts : liste compacte à gauche, fiche à droite (onglets).
// Mêmes données et mêmes filtres que le tableau : la page lui passe la liste déjà filtrée.
// Sous 768 px on montre soit la liste, soit la fiche (bouton retour).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconBuilding, IconEdit, IconUser, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import type { Contact, Invoice, Project } from '../../types';
import { fetchJson } from '../../lib/api';
import { contactName } from '../../lib/contactMerge';
import { missingBuyerMentions } from '../../lib/invoiceLegalMentions';
import CorrespondenceTab from '../CorrespondenceTab';

type Tab = 'overview' | 'projects' | 'billing' | 'exchanges';
const TABS: Tab[] = ['overview', 'projects', 'billing', 'exchanges'];

interface Props {
  contacts: Contact[];
  projects: Pick<Project, 'id' | 'name' | 'client_id'>[];
  canSelect: boolean;
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
  onEdit: (contact: Contact) => void;
}

const euro = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-1.5 text-sm" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
      <dt className="w-40 shrink-0" style={{ color: 'var(--tblr-muted)' }}>{label}</dt>
      <dd className="min-w-0 break-words" style={{ color: 'var(--tblr-text)' }}>{value}</dd>
    </div>
  );
}

export function ContactsDetailView({ contacts, projects, canSelect, selectedIds, onToggleSelected, onEdit }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileFiche, setMobileFiche] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  // Une fiche reste ouverte tant qu'elle figure dans la liste filtrée ; sinon la première.
  const active = useMemo(
    () => contacts.find(c => c.id === activeId) || contacts[0] || null,
    [contacts, activeId],
  );

  useEffect(() => {
    if (tab !== 'billing' || invoices) return;
    fetchJson('/api/invoices').then(setInvoices).catch(() => setInvoices([]));
  }, [tab, invoices]);

  if (!active) {
    return (
      <div className="rounded-lg p-10 text-center" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
        <IconUser size={32} className="mx-auto opacity-20 mb-2" />
        {t('no_contacts')}
      </div>
    );
  }

  const linkedProjects = projects.filter(p => p.client_id === active.id);
  const linkedInvoices = (invoices || []).filter(i => i.client_id === active.id);
  const missing = missingBuyerMentions(active);
  const email = active.email || active.email_work || active.email_home || '';
  const address = [active.address || active.address_work_street, [active.zip || active.address_work_zip, active.city || active.address_work_city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div className="rounded-lg overflow-hidden md:grid md:grid-cols-[18rem_1fr]" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <ul className={`${mobileFiche ? 'hidden' : 'block'} md:block md:max-h-[70dvh] overflow-y-auto`} style={{ borderRight: '1px solid var(--tblr-border)' }} aria-label={t('contacts')}>
        {contacts.map(c => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: '1px solid var(--tblr-border)', background: c.id === active.id ? 'var(--tblr-primary-lt)' : 'transparent' }}>
            {canSelect && (
              <input type="checkbox" aria-label={t('contacts_merge_select_one', { name: contactName(c) })}
                checked={selectedIds.includes(c.id)} onChange={() => onToggleSelected(c.id)} />
            )}
            <button type="button" className="flex-1 min-w-0 text-left pointer-coarse:min-h-11"
              onClick={() => { setActiveId(c.id); setTab('overview'); setMobileFiche(true); }}>
              <div className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{contactName(c)}</div>
              <div className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>
                {c.company_name && (c.first_name || c.last_name) ? c.company_name : c.category || c.email || ''}
              </div>
            </button>
          </li>
        ))}
      </ul>

      <section className={`${mobileFiche ? 'block' : 'hidden'} md:block min-w-0`}>
        <header className="flex items-start gap-3 p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <button type="button" className="md:hidden p-2 -ml-2" aria-label={t('contacts_detail_back')} onClick={() => setMobileFiche(false)}>
            <IconArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
              {active.company_name && <IconBuilding size={16} className="inline mr-1.5" style={{ color: 'var(--tblr-muted)' }} />}
              {contactName(active)}
            </h3>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{[active.job_title, active.category].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={() => onEdit(active)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
            style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
            <IconEdit size={15} /> {t('contacts_detail_edit')}
          </button>
        </header>

        <div role="tablist" className="flex gap-1 px-3 overflow-x-auto" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          {TABS.map(k => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className="px-3 py-2.5 text-sm font-medium whitespace-nowrap pointer-coarse:min-h-11"
              style={{ color: tab === k ? 'var(--tblr-primary)' : 'var(--tblr-muted)', borderBottom: `2px solid ${tab === k ? 'var(--tblr-primary)' : 'transparent'}` }}>
              {t(`contacts_detail_tab_${k}`)}
            </button>
          ))}
        </div>

        <div className="p-4" role="tabpanel">
          {tab === 'overview' && (
            <dl>
              <Row label={t('contacts_col_company')} value={active.company_name} />
              <Row label={t('email')} value={email} />
              <Row label={t('phone')} value={active.phone || active.phone_mobile || active.phone_work} />
              <Row label={t('contacts_detail_address')} value={address} />
              <Row label="SIRET" value={active.siret} />
              <Row label={t('contacts_detail_tags')} value={active.tags} />
              <Row label={t('ca_amount')} value={active.ca_amount ? euro(Number(active.ca_amount)) : ''} />
              <Row label="Notes" value={active.notes} />
            </dl>
          )}
          {tab === 'projects' && (
            linkedProjects.length === 0
              ? <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_detail_no_projects')}</p>
              : <ul className="space-y-1.5">{linkedProjects.map(p => (
                <li key={p.id}><a className="text-sm hover:underline" style={{ color: 'var(--tblr-primary)' }} href={`/projects/${p.id}`}>{p.name}</a></li>
              ))}</ul>
          )}
          {tab === 'billing' && (
            <div className="space-y-4">
              <p className="flex items-start gap-2 text-sm" style={{ color: missing.length ? 'var(--tblr-warning, #e67700)' : 'var(--tblr-success)' }}>
                {missing.length ? <IconAlertTriangle size={16} className="mt-0.5 shrink-0" /> : <IconCircleCheck size={16} className="mt-0.5 shrink-0" />}
                {missing.length
                  ? t('invoices_legal_mentions_missing', { list: missing.map(m => t(`invoices_legal_mention_${m}`)).join(', ') })
                  : t('invoices_legal_mentions_ok')}
              </p>
              {invoices === null
                ? <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>…</p>
                : linkedInvoices.length === 0
                  ? <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_detail_no_invoices')}</p>
                  : <ul className="text-sm divide-y" style={{ borderColor: 'var(--tblr-border)' }}>{linkedInvoices.map(i => (
                    <li key={i.id} className="flex justify-between gap-3 py-1.5" style={{ color: 'var(--tblr-text)' }}>
                      <span>{i.invoice_number || '---'}</span>
                      <span className="font-mono">{euro(Number(i.total_amount ?? i.amount ?? 0))}</span>
                    </li>
                  ))}</ul>}
            </div>
          )}
          {tab === 'exchanges' && <CorrespondenceTab localType="contact" localId={active.id} contactEmail={email} />}
        </div>
      </section>
    </div>
  );
}
