import { useState, useEffect, useRef, useCallback, useId, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconChevronLeft,
  IconCamera,
  IconX,
  IconEdit,
  IconCheck,
  IconPhoto,
  IconCalendar,
  IconNotes,
  IconBuilding,
  IconEye,
  IconSearch,
  IconUsers,
  IconUserPlus,
  IconAlertTriangle,
  IconUser,
  IconFileTypePdf,
  IconFileTypeDocx,
  IconLoader2,
  IconBriefcase,
  IconClipboardList,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { CollapsiblePanel, PanelCollapseButton, useListPanel, useExpandLabel } from '../components/CollapsiblePanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useProjectGroupement } from '../hooks/useActiveGroupement';
import { queuedJsonRequest, queuedMultipartRequest, listPendingWrites, OFFLINE_WRITE_SYNCED_EVENT } from '../lib/offlineQueue';
import { cachedListFirst } from '../lib/offlineReadCache';
import { attendeesUrl, toAttendeeContact, loadContactsForAttendees, loadMeetingAttendees } from '../lib/meetingAttendeesOffline';
import { db } from '../db';
import { SignedImage } from '../components/SignedImage';
import { PhotoSourcePicker } from '../components/PhotoSourcePicker';
import CroquisPanel from '../components/croquis/CroquisPanel';
import MeetingRecordingPanel from '../components/MeetingRecordingPanel';
import { appendMeetingNotes } from '../lib/meetingRecordingDrafts';
import { useImageDrop } from '../hooks/useImageDrop';
import type { Contact, Project, Meeting, MeetingPhoto, MeetingAttendee, Proposal, Tender } from '../types';
import { isContactIncomplete } from './Contacts';
import { exportMeetingToPDF, exportMeetingToDocx, type AgencySettings } from '../lib/meetingExport';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import { useEscapeKey } from '../hooks/useEscapeKey';

// Focus de la charte : bordure bleue et halo de 3 px, au clavier seulement.
const FOCUS = 'focus-visible:outline-none focus-visible:border-[var(--tblr-primary)] focus-visible:shadow-[0_0_0_3px_var(--tblr-primary-lt)]';
// Cible tactile de 44 px sur écran tactile, taille compacte à la souris.
const TOUCH = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';
// Bouton d'icône seul : toujours nommé par un aria-label au point d'emploi.
const ICON_BTN = `inline-flex items-center justify-center min-h-7 min-w-7 rounded text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-text)] transition-colors ${FOCUS} ${TOUCH}`;
const ICON_BTN_DANGER = `inline-flex items-center justify-center min-h-7 min-w-7 rounded text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-danger)] transition-colors ${FOCUS} ${TOUCH}`;
// Champ de saisie et boutons : rayon de 4 px pour ce qu'on actionne.
const INPUT = `rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] ${FOCUS}`;
const BTN_PRIMARY = `inline-flex items-center justify-center gap-1.5 rounded bg-[var(--tblr-primary)] text-white hover:brightness-110 active:scale-[0.97] transition ${FOCUS} ${TOUCH}`;
const BTN_SECONDARY = `inline-flex items-center justify-center gap-1.5 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] active:scale-[0.97] transition ${FOCUS} ${TOUCH}`;

type Subsection = 'projet' | 'visite_candidature' | 'visite_proposition';
type MobileView = 'projects' | 'meetings' | 'detail';
type ParentKind = 'project' | 'proposal' | 'tender';

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Brouillon des notes ──────────────────────────────────────────────────────
// Les notes sont enregistrées au fil de la frappe, mais une page rechargée ou
// une session renouvelée en pleine saisie ne doit rien perdre : le texte est
// aussi gardé localement, de façon synchrone, jusqu'à ce que l'écriture soit
// partie (ou mise en file).
const NOTES_DRAFT_PREFIX = 'meeting-notes-draft:';
const NOTES_AUTOSAVE_DELAY_MS = 1000;

function readNotesDraft(meetingId: string): string | null {
  try { return localStorage.getItem(NOTES_DRAFT_PREFIX + meetingId); } catch { return null; }
}
function writeNotesDraft(meetingId: string, value: string) {
  try { localStorage.setItem(NOTES_DRAFT_PREFIX + meetingId, value); } catch { /* stockage indisponible */ }
}
function clearNotesDraft(meetingId: string) {
  try { localStorage.removeItem(NOTES_DRAFT_PREFIX + meetingId); } catch { /* stockage indisponible */ }
}
const notesWriteId = (meetingId: string) => `notes:${meetingId}`;

/** Dernières notes encore en file pour cette réunion (écriture pas encore partie). */
async function pendingMeetingNotes(meetingId: string): Promise<string | undefined> {
  const writes = (await listPendingWrites('meeting'))
    .filter(w => w.method === 'PUT' && w.url === `/api/meetings/${meetingId}` && typeof w.jsonBody?.notes === 'string');
  return writes.length ? writes[writes.length - 1].jsonBody.notes : undefined;
}

/** Notes à afficher : brouillon non enregistré > écriture en file > valeur connue. */
async function resolveMeetingNotes(meetingId: string, known: string | undefined): Promise<{ notes: string; fromDraft: boolean }> {
  const draft = readNotesDraft(meetingId);
  if (draft !== null) return { notes: draft, fromDraft: true };
  const pending = await pendingMeetingNotes(meetingId);
  return { notes: pending ?? known ?? '', fromDraft: false };
}

/**
 * Section repliable du détail d'une réunion. Le contenu reste monté quand la section est repliée
 * (état des intervenants, envoi de photos en cours) ; le choix est mémorisé par section et par poste.
 */
function DetailSection({ id, title, icon, count, action, children }: {
  id: string; title: string; icon: ReactNode; count?: number; action?: ReactNode; children: ReactNode;
}) {
  const storageKey = `reunions:section:${id}`;
  const headingId = useId();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '0'; } catch { return true; }
  });
  const toggle = () => setOpen(prev => {
    try { localStorage.setItem(storageKey, prev ? '0' : '1'); } catch { /* stockage indisponible */ }
    return !prev;
  });
  return (
    <section aria-labelledby={headingId} className="mt-4 pt-1 border-t border-[var(--tblr-border)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="flex-1 min-w-0 text-sm font-semibold">
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className={`w-full flex items-center gap-2 py-2 text-left rounded text-[var(--tblr-text)] ${FOCUS} pointer-coarse:min-h-11`}
          >
            {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
            {icon}
            <span>{title}</span>
            {count !== undefined && <span className="font-normal text-[var(--tblr-muted)]">({count})</span>}
          </button>
        </h2>
        {action}
      </div>
      <div hidden={!open} className="pt-1">{children}</div>
    </section>
  );
}

function contactDisplayName(c: MeetingAttendee['contact']) {
  if (!c) return 'Inconnu';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Sans nom';
}

// ── Attendee panel ────────────────────────────────────────────────────────────

interface AttendeesPanelProps {
  meetingId: string;
  /** Prévient la page du nombre d'intervenants, pour l'afficher dans l'en-tête de la section. */
  onCountChange?: (count: number) => void;
}

function AttendeesPanel({ meetingId, onCountChange }: AttendeesPanelProps) {
  const { confirm, dialog } = useConfirmDialog();
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
  useEffect(() => { onCountChange?.(attendees.length); }, [attendees.length, onCountChange]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [mode, setMode] = useState<null | 'search' | 'new'>(null);
  const [query, setQuery] = useState('');
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [roleValue, setRoleValue] = useState('');

  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newJob, setNewJob] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('');

  // Cache d'abord, écritures en file rejouées par-dessus : les intervenants se
  // lisent et se modifient sans réseau (src/lib/meetingAttendeesOffline.ts).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const all = await loadContactsForAttendees();
      if (cancelled) return;
      setContacts(all);
      const list = await loadMeetingAttendees(meetingId, all, a => { if (!cancelled) setAttendees(a); });
      if (!cancelled) setAttendees(list);
    };
    void load();
    const onSynced = (e: Event) => {
      if ((e as CustomEvent).detail?.entity === 'meetingAttendee') void load();
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => { cancelled = true; window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced); };
  }, [meetingId]);

  const alreadyAdded = new Set(attendees.map(a => a.contact_id));

  const filteredContacts = contacts.filter(c => {
    if (alreadyAdded.has(c.id)) return false;
    const q = query.toLowerCase();
    if (!q) return true;
    return (
      c.first_name?.toLowerCase().includes(q) ||
      c.last_name?.toLowerCase().includes(q) ||
      c.company_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }).slice(0, 8);

  const addExisting = async (contact: Contact) => {
    const id = crypto.randomUUID();
    const body = { id, contact_id: contact.id, role: '' };
    const { queued, data } = await queuedJsonRequest<MeetingAttendee>({ entity: 'meetingAttendee', id, method: 'POST', url: attendeesUrl(meetingId), body });
    const att: MeetingAttendee = queued || !data
      ? { id, meeting_id: meetingId, contact_id: contact.id, role: '', contact: toAttendeeContact(contact) }
      : data;
    setAttendees(prev => [...prev, att]);
    setQuery('');
    setMode(null);
  };

  const createAndAdd = async () => {
    if (!newFirst.trim() && !newLast.trim()) return;
    const id = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const body = {
      id, contact_id: contactId,
      first_name: newFirst, last_name: newLast, company_name: newCompany,
      job_title: newJob, phone_mobile: newPhone, email: newEmail, role: newRole,
    };
    const { queued, data } = await queuedJsonRequest<MeetingAttendee>({
      entity: 'meetingAttendee', id, method: 'POST', url: `${attendeesUrl(meetingId)}/new-contact`, body,
    });
    const att: MeetingAttendee = queued || !data
      ? {
          id, meeting_id: meetingId, contact_id: contactId, role: newRole,
          contact: toAttendeeContact({ id: contactId, first_name: newFirst, last_name: newLast, company_name: newCompany, job_title: newJob, phone_mobile: newPhone, phone: newPhone, email: newEmail }),
        }
      : data;
    setAttendees(prev => [...prev, att]);
    setNewFirst(''); setNewLast(''); setNewCompany(''); setNewJob('');
    setNewPhone(''); setNewEmail(''); setNewRole('');
    setMode(null);
  };

  const removeAttendee = async (att: MeetingAttendee) => {
    const id = att.id;
    const ok = await confirm({
      title: 'Retirer cet intervenant ?',
      message: `${contactDisplayName(att.contact)} ne figurera plus dans cette réunion. Sa fiche contact reste dans votre carnet d'adresses.`,
      confirmLabel: 'Retirer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!ok) return;
    await queuedJsonRequest({ entity: 'meetingAttendee', id: `delete:${id}`, method: 'DELETE', url: `${attendeesUrl(meetingId)}/${id}` });
    setAttendees(prev => prev.filter(a => a.id !== id));
  };

  const saveRole = async (id: string) => {
    // Id stable : plusieurs corrections du rôle hors ligne n'en gardent qu'une.
    await queuedJsonRequest({ entity: 'meetingAttendee', id: `role:${id}`, method: 'PATCH', url: `${attendeesUrl(meetingId)}/${id}`, body: { role: roleValue } });
    setAttendees(prev => prev.map(a => a.id === id ? { ...a, role: roleValue } : a));
    setEditingRole(null);
  };

  const incomplete = (a: MeetingAttendee) => a.contact ? isContactIncomplete(a.contact as Contact) : false;

  return (
    <div>
      {attendees.length === 0 && !mode && (
        <p className="text-sm italic mb-3" style={{ color: 'var(--tblr-muted)' }}>Aucun intervenant ajouté</p>
      )}
      {attendees.length > 0 && (
        <ul aria-label="Intervenants de la réunion" className="mb-3 rounded-lg overflow-hidden border border-[var(--tblr-border)]">
          {attendees.map((att, idx) => (
            <li key={att.id} className={`flex items-center gap-3 px-3 py-2.5 bg-[var(--tblr-surface)] ${idx > 0 ? 'border-t border-[var(--tblr-border)]' : ''}`}>
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--tblr-surface-2)' }}>
                <IconUser size={16} aria-hidden="true" style={{ color: 'var(--tblr-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{contactDisplayName(att.contact)}</span>
                  {att.contact?.company_name && (
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{att.contact.company_name}</span>
                  )}
                  {incomplete(att) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                      <IconAlertTriangle size={11} aria-hidden="true" />
                      À compléter
                    </span>
                  )}
                </div>
                {editingRole === att.id ? (
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="text"
                      value={roleValue}
                      onChange={e => setRoleValue(e.target.value)}
                      aria-label={`Rôle ou entreprise de ${contactDisplayName(att.contact)}`}
                      placeholder="Rôle / Entreprise…"
                      autoFocus
                      className={`flex-1 min-w-0 px-2 py-1 text-xs ${INPUT} pointer-coarse:min-h-11`}
                      onKeyDown={e => { if (e.key === 'Enter') saveRole(att.id); if (e.key === 'Escape') setEditingRole(null); }}
                    />
                    <button type="button" aria-label="Enregistrer le rôle" onClick={() => saveRole(att.id)} className={ICON_BTN}><IconCheck size={14} /></button>
                    <button type="button" aria-label="Annuler la modification du rôle" onClick={() => setEditingRole(null)} className={ICON_BTN}><IconX size={14} /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditingRole(att.id); setRoleValue(att.role || ''); }}
                    aria-label={att.role ? `Modifier le rôle de ${contactDisplayName(att.contact)} : ${att.role}` : `Ajouter un rôle ou une entreprise pour ${contactDisplayName(att.contact)}`}
                    className={`text-xs mt-0.5 text-left rounded text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] pointer-coarse:min-h-11 pointer-coarse:flex pointer-coarse:items-center ${FOCUS}`}
                  >
                    {att.role || <span className="italic">+ Rôle / Entreprise</span>}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label={`Retirer ${contactDisplayName(att.contact)} de la réunion`}
                onClick={() => removeAttendee(att)}
                className={`flex-shrink-0 ${ICON_BTN_DANGER}`}
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!mode && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setMode('search')} className={`px-3 py-1.5 text-xs ${BTN_SECONDARY}`}>
            <IconSearch size={14} aria-hidden="true" />
            Contact existant
          </button>
          <button type="button" onClick={() => setMode('new')} className={`px-3 py-1.5 text-xs ${BTN_SECONDARY}`}>
            <IconUserPlus size={14} aria-hidden="true" />
            Nouveau contact
          </button>
        </div>
      )}

      {mode === 'search' && (
        <div className="rounded-lg overflow-hidden border border-[var(--tblr-border)]">
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <IconSearch size={14} aria-hidden="true" style={{ color: 'var(--tblr-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Rechercher un contact"
              placeholder="Rechercher un contact…"
              autoFocus
              className={`flex-1 min-w-0 px-2 py-1 text-sm ${INPUT} pointer-coarse:min-h-11`}
            />
            <button type="button" aria-label="Fermer la recherche de contact" onClick={() => { setMode(null); setQuery(''); }} className={ICON_BTN}><IconX size={16} /></button>
          </div>
          {filteredContacts.length === 0 ? (
            <p className="px-3 py-3 text-sm italic" style={{ color: 'var(--tblr-muted)' }}>
              {query ? 'Aucun contact trouvé' : 'Commencez à taper pour rechercher'}
            </p>
          ) : (
            <div>
              {filteredContacts.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addExisting(c)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--tblr-surface-2)] pointer-coarse:min-h-11 ${FOCUS} ${idx > 0 ? 'border-t border-[var(--tblr-border)]' : ''}`}
                >
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--tblr-surface-2)' }}>
                    <IconUser size={14} style={{ color: 'var(--tblr-muted)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--tblr-text)' }}>
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name}
                      </span>
                      {isContactIncomplete(c) && (
                        <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[0.6875rem] font-semibold whitespace-nowrap bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                          <IconAlertTriangle size={11} aria-hidden="true" />
                          À compléter
                        </span>
                      )}
                    </div>
                    {c.job_title && <p className="text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{c.job_title}{c.company_name ? ` · ${c.company_name}` : ''}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'new' && (
        <div className="rounded-lg overflow-hidden border border-[var(--tblr-border)]">
          <div className="flex items-center justify-between px-3 py-1 gap-2" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>Nouveau contact</span>
            <button type="button" aria-label="Fermer le formulaire de nouveau contact" onClick={() => setMode(null)} className={ICON_BTN}><IconX size={16} /></button>
          </div>
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ background: 'var(--tblr-surface)' }}>
            <input type="text" aria-label="Prénom" placeholder="Prénom" value={newFirst} onChange={e => setNewFirst(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="text" aria-label="Nom (obligatoire)" aria-required="true" placeholder="Nom *" value={newLast} onChange={e => setNewLast(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="text" aria-label="Entreprise" placeholder="Entreprise" value={newCompany} onChange={e => setNewCompany(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="text" aria-label="Fonction" placeholder="Fonction" value={newJob} onChange={e => setNewJob(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="tel" aria-label="Portable ou téléphone" placeholder="Portable / Téléphone" value={newPhone} onChange={e => setNewPhone(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="email" aria-label="Adresse e-mail" placeholder="E-mail" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className={`px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
            <input type="text" aria-label="Rôle dans la réunion" placeholder="Rôle dans la réunion" value={newRole} onChange={e => setNewRole(e.target.value)}
              className={`sm:col-span-2 px-2 py-1.5 text-sm ${INPUT} pointer-coarse:min-h-11`} />
          </div>
          {(!newFirst.trim() && !newLast.trim()) ? null : (
            (!newPhone.trim() || !newEmail.trim()) && (
              <div role="status" className="mx-3 mb-2 flex items-center gap-1.5 text-xs rounded px-2.5 py-1.5 bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                <IconAlertTriangle size={14} aria-hidden="true" />
                Ce contact sera marqué « À compléter » dans votre carnet d'adresses.
              </div>
            )
          )}
          <div className="px-3 pb-3 flex gap-2" style={{ background: 'var(--tblr-surface)' }}>
            <button
              type="button"
              onClick={createAndAdd}
              disabled={!newFirst.trim() && !newLast.trim()}
              className={`flex-1 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed ${BTN_PRIMARY}`}
            >
              Créer et ajouter
            </button>
            <button type="button" onClick={() => setMode(null)} className={`px-3 py-2 text-sm ${BTN_SECONDARY}`}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reunions() {
  const { t } = useTranslation();

  const [mobileView, setMobileView] = useState<MobileView>('projects');

  const [projects, setProjects] = useState<Project[]>([]);
  // Liste complète, affaires terminées comprises : la colonne de gauche les
  // masque, mais un lien direct (?parent=project:<id>, depuis la fiche d'une
  // affaire) doit pouvoir ouvrir leurs réunions.
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);

  const [expandedTopSections, setExpandedTopSections] = useState<Record<string, boolean>>({
    projects: true,
    proposals: false,
    tenders: false,
  });

  // Active entity
  const [activeKind, setActiveKind] = useState<ParentKind>('project');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  // Les logos des cotraitants de l'affaire figurent sur les comptes rendus exportés.
  useProjectGroupement(activeKind === 'project' ? selectedProject?.id : null);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  // ── Repli des colonnes de listes (écrans lg+), mémorisé par panneau et par page
  const projectsPanel = useListPanel('reunions:projects');
  const meetingsPanel = useListPanel('reunions:meetings');
  const panelLabels = useExpandLabel(projectsPanel.collapsed);
  const meetingsLabels = useExpandLabel(meetingsPanel.collapsed);
  // iPad et écrans moyens : à l'ouverture d'une réunion, les deux listes se
  // replient d'elles-mêmes pour laisser la place au détail. Repli passager
  // (non mémorisé) : il ne remplace pas le choix fait par la personne.
  const isNarrowDesktop = useMediaQuery('(max-width: 1279px)');
  const openedMeetingId = selectedMeeting?.id;
  useEffect(() => {
    if (!openedMeetingId || !isNarrowDesktop) return;
    projectsPanel.set(true, false);
    meetingsPanel.set(true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedMeetingId, isNarrowDesktop]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [newMeetingDate, setNewMeetingDate] = useState(new Date().toISOString().substring(0, 10));
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [createError, setCreateError] = useState('');

  // Créer une proposition ou un appel d'offres à la volée, y compris hors
  // ligne — pour une visite de candidature ou de proposition, l'affaire
  // n'existe souvent pas encore dans ArchiOffice au moment de la visite.
  // Un titre suffit : le reste se complète plus tard, en ligne, depuis
  // /propositions ou /appels-offres.
  const [newParentKind, setNewParentKind] = useState<null | 'proposal' | 'tender'>(null);
  const [newParentTitle, setNewParentTitle] = useState('');
  const [creatingParent, setCreatingParent] = useState(false);

  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState<MeetingPhoto | null>(null);
  useEscapeKey(!!lightboxPhoto, () => setLightboxPhoto(null));
  useEscapeKey(!!editingCaption, () => setEditingCaption(null));
  const { confirm: askConfirm, dialog: confirmDialog } = useConfirmDialog();

  // État de l'enregistrement des notes, dit à voix haute : c'est ce qui rassure sur le chantier.
  type NotesStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: number } | { kind: 'queued' } | { kind: 'error' };
  const [notesStatus, setNotesStatus] = useState<NotesStatus>({ kind: 'idle' });
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [attendeeCount, setAttendeeCount] = useState(0);

  const [agencySettings, setAgencySettings] = useState<AgencySettings>({});
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);

  useEffect(() => {
    // Hors ligne : réaffiche d'abord ce que src/db.ts a déjà en cache
    // (rempli par cette page ou par /projects, /propositions,
    // /appels-offres lors d'une précédente visite en ligne) — sans ça, les
    // trois colonnes de gauche restent vides hors connexion et il devient
    // impossible de rattacher une nouvelle réunion à une affaire.
    (async () => {
      try {
        const [localProjects, localProposals, localTenders] = await Promise.all([
          db.projects.toArray(),
          db.proposals.toArray(),
          db.tenders.toArray(),
        ]);
        if (localProjects.length > 0) {
          setAllProjects(localProjects);
          setProjects(localProjects.filter(p => p.status !== 'Completed'));
        }
        if (localProposals.length > 0) setProposals(localProposals);
        if (localTenders.length > 0) setTenders(localTenders);
      } catch {
        // IndexedDB indisponible (navigation privée, quota…) — pas de cache,
        // on retombe simplement sur le réseau ci-dessous.
      }
    })();

    apiFetch<Project[]>('/api/projects').then(data => {
      setAllProjects(data);
      setProjects(data.filter(p => p.status !== 'Completed'));
      db.projects.clear().then(() => db.projects.bulkPut(data)).catch(() => {});
    }).catch(() => {});
    apiFetch<Proposal[]>('/api/proposals').then(data => {
      setProposals(data);
      db.proposals.clear().then(() => db.proposals.bulkPut(data)).catch(() => {});
    }).catch(() => {});
    apiFetch<any[]>('/api/tenders').then(data => {
      setTenders(data);
      db.tenders.clear().then(() => db.tenders.bulkPut(data)).catch(() => {});
    }).catch(() => {});
    apiFetch<any>('/api/settings').then(s => {
      setAgencySettings({
        agencyName: s.agencyName || s.agency_name,
        logoUrl: s.logoUrl || s.logo_url,
        address: s.address,
        phone: s.phone,
        email: s.email,
        siret: s.siret,
        oaNumber: s.oaNumber,
        vatNumber: s.vatNumber,
      });
    }).catch(() => {});
  }, []);

  const loadMeetings = useCallback(async (kind: ParentKind, id: string, section?: Subsection) => {
    setLoadingMeetings(true);
    setSelectedMeeting(null);
    try {
      let url = '';
      let scopeFilter: (m: Meeting) => boolean;
      if (kind === 'project') {
        url = `/api/meetings?project_id=${id}&type=${section}`;
        scopeFilter = m => m.project_id === id && m.type === section;
      } else if (kind === 'proposal') {
        url = `/api/meetings?proposal_id=${id}`;
        scopeFilter = m => m.proposal_id === id;
      } else {
        url = `/api/meetings?tender_id=${id}`;
        scopeFilter = m => m.tender_id === id;
      }
      // Cache d'abord (src/lib/offlineReadCache.ts) : hors-ligne, la liste
      // déjà consultée pour cette affaire reste affichée au lieu de
      // disparaître — c'est ce que l'ancien apiFetch seul ne permettait pas.
      // Les réunions créées hors-ligne et pas encore rejouées ne sont ni sur
      // le serveur ni dans le cache : sans les relire dans la file, un
      // rechargement de la page (ou une reconnexion) les faisait disparaître
      // de l'écran alors qu'elles attendaient toujours d'être envoyées.
      const pending = (await Promise.all((await listPendingWrites('meeting'))
        .filter(w => w.method === 'POST' && w.jsonBody)
        .map(async w => {
          const { notes } = await resolveMeetingNotes(w.jsonBody.id, w.jsonBody.notes);
          return { ...w.jsonBody, notes, created_at: new Date(w.createdAt).toISOString(), photos: [], pendingSync: true } as Meeting;
        })))
        .filter(scopeFilter);
      const withPending = (list: Meeting[]) => [...pending.filter(p => !list.some(m => m.id === p.id)), ...list];
      const { hadLocalData, synced } = await cachedListFirst(db.meetingsCache, scopeFilter, url, list => setMeetings(withPending(list)));
      if (!hadLocalData && !synced) setMeetings(withPending([]));
    } finally {
      setLoadingMeetings(false);
    }
  }, []);

  const selectProject = (project: Project) => {
    setActiveKind('project');
    setSelectedProject(project);
    setSelectedProposal(null);
    setSelectedTender(null);
    loadMeetings('project', project.id, 'projet');
    setShowNewMeeting(false);
    setMobileView('meetings');
  };

  const selectProposal = (proposal: Proposal) => {
    setActiveKind('proposal');
    setSelectedProposal(proposal);
    setSelectedProject(null);
    setSelectedTender(null);
    loadMeetings('proposal', proposal.id);
    setShowNewMeeting(false);
    setMobileView('meetings');
  };

  const selectTender = (tender: Tender) => {
    setActiveKind('tender');
    setSelectedTender(tender);
    setSelectedProject(null);
    setSelectedProposal(null);
    loadMeetings('tender', tender.id);
    setShowNewMeeting(false);
    setMobileView('meetings');
  };

  // Crée une proposition ou un appel d'offres minimal (un titre suffit) et le
  // sélectionne aussitôt, pour pouvoir y accrocher une réunion de visite dans
  // la foulée. Id généré côté client (voir src/lib/offlineQueue.ts) : hors
  // ligne, la création est mise en file et la réunion créée juste après peut
  // référencer cet id immédiatement, sans attendre le retour du réseau —
  // POST /api/tenders accepte désormais cet id tel quel, comme le fait déjà
  // POST /api/proposals (server/routes/tenders.ts).
  const createParent = async () => {
    const kind = newParentKind;
    const title = newParentTitle.trim();
    if (!kind || !title || creatingParent) return;
    const id = crypto.randomUUID();
    setCreatingParent(true);
    try {
      if (kind === 'proposal') {
        const body = { id, title, status: 'Draft' as const };
        const { queued, data } = await queuedJsonRequest<Proposal>({ entity: 'proposal', id, method: 'POST', url: '/api/proposals', body });
        const proposal: Proposal = queued
          ? { ...body, client_id: '', amount: 0, description: '', created_at: new Date().toISOString(), pendingSync: true }
          : data!;
        setProposals(prev => [proposal, ...prev]);
        db.proposals.put(proposal).catch(() => {});
        selectProposal(proposal);
      } else {
        const body = { id, title, client: '', submission_deadline: '', status: 'Draft' as const };
        const { queued, data } = await queuedJsonRequest<Tender>({ entity: 'tender', id, method: 'POST', url: '/api/tenders', body });
        const tender: Tender = queued
          ? { ...body, value: 0, notes: '', pendingSync: true }
          : data!;
        setTenders(prev => [tender, ...prev]);
        db.tenders.put(tender).catch(() => {});
        selectTender(tender);
      }
      setNewParentKind(null);
      setNewParentTitle('');
    } finally {
      setCreatingParent(false);
    }
  };

  // Lien direct depuis un agent (?parent=project:<id>|proposal:<id>|tender:<id>
  // et ?open=<meetingId>, voir recordLinks.ts côté serveur) : cette page
  // n'affiche jamais « toutes les réunions », il faut d'abord sélectionner le
  // même parent qu'un clic dans la colonne de gauche avant que la réunion
  // elle-même ne puisse être ouverte — d'où les deux effets séparés,
  // enchaînés par le chargement de `meetings` que `loadMeetings` déclenche.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const parent = searchParams.get('parent');
    if (!parent) return;
    const [kind, parentId] = parent.split(':');
    if (kind === 'project' && allProjects.length > 0) {
      const project = allProjects.find(p => p.id === parentId);
      if (project) selectProject(project);
    } else if (kind === 'proposal' && proposals.length > 0) {
      const proposal = proposals.find(p => p.id === parentId);
      if (proposal) selectProposal(proposal);
    } else if (kind === 'tender' && tenders.length > 0) {
      const tender = tenders.find(t => t.id === parentId);
      if (tender) selectTender(tender);
    } else {
      return; // la liste concernée n'est pas encore chargée — on réessaiera au prochain rendu
    }
    // ?new=1 : réunion lancée depuis l'aperçu d'une opération, le formulaire de
    // création s'ouvre directement sur le parent sélectionné (posé APRÈS
    // selectProject, qui referme ce formulaire).
    const openNewForm = searchParams.get('new') === '1';
    if (openNewForm) setShowNewMeeting(true);
    setSearchParams(prev => { prev.delete('parent'); prev.delete('new'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjects, proposals, tenders, searchParams]);

  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId || meetings.length === 0) return;
    const meeting = meetings.find(m => m.id === openId);
    if (meeting) loadMeetingDetail(meeting);
    setSearchParams(prev => { prev.delete('open'); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, searchParams]);

  const loadMeetingDetail = async (meeting: Meeting) => {
    setLoadingDetail(true);
    setSelectedMeeting(null);
    let restoredDraft: string | null = null;
    try {
      const data = await apiFetch<Meeting>(`/api/meetings/${meeting.id}`);
      const { notes, fromDraft } = await resolveMeetingNotes(meeting.id, data.notes);
      setSelectedMeeting({ ...data, notes });
      setNotesValue(notes);
      if (fromDraft) restoredDraft = notes;
    } catch {
      // Réunion pas encore sur le serveur (créée hors-ligne) : on remet
      // ses photos en file, avec un aperçu local, plutôt qu'une fiche vide.
      const queuedPhotos = (await listPendingWrites('meetingPhoto'))
        .filter(w => w.method === 'POST' && w.blob && w.url === `/api/meetings/${meeting.id}/photos`)
        .map(w => ({ id: w.id, meeting_id: meeting.id, file_url: '', uploaded_at: new Date(w.createdAt).toISOString(), pendingSync: true, localPreviewUrl: URL.createObjectURL(w.blob!) } as MeetingPhoto));
      const { notes, fromDraft } = await resolveMeetingNotes(meeting.id, meeting.notes);
      const restored = { ...meeting, notes, photos: [...(meeting.photos || []), ...queuedPhotos] };
      setSelectedMeeting(restored);
      setNotesValue(notes);
      if (fromDraft) restoredDraft = notes;
    } finally {
      setLoadingDetail(false);
    }
    // Saisie interrompue (page rechargée, session renouvelée) : on la remet
    // en route au lieu de la laisser dans le brouillon local.
    if (restoredDraft !== null) void persistNotes(meeting.id, restoredDraft, meeting);
    setMobileView('detail');
  };

  const createMeeting = async () => {
    if (!newMeetingTitle.trim()) return;

    const id = crypto.randomUUID();
    const body: any = {
      id,
      type: (activeKind === 'project' ? 'projet' : activeKind === 'proposal' ? 'visite_proposition' : 'visite_candidature') satisfies Subsection,
      title: newMeetingTitle.trim(),
      date: newMeetingDate,
      notes: '',
    };

    if (activeKind === 'project' && selectedProject) body.project_id = selectedProject.id;
    else if (activeKind === 'proposal' && selectedProposal) body.proposal_id = selectedProposal.id;
    else if (activeKind === 'tender' && selectedTender) body.tender_id = selectedTender.id;
    else return;

    setCreatingMeeting(true);
    setCreateError('');
    try {
      // Id généré côté client (voir src/lib/offlineQueue.ts) : hors-ligne,
      // la création est mise en file et rejouée au retour du réseau — la
      // réunion reste utilisable tout de suite avec les données déjà en main.
      const { queued, data } = await queuedJsonRequest<Meeting>({ entity: 'meeting', id, method: 'POST', url: '/api/meetings', body });
      const meeting: Meeting = queued ? { ...body, created_at: new Date().toISOString(), photos: [], pendingSync: true } : data!;
      setMeetings(prev => [meeting, ...prev]);
      setNewMeetingTitle('');
      setNewMeetingDate(new Date().toISOString().substring(0, 10));
      setShowNewMeeting(false);
      if (queued) {
        setSelectedMeeting(meeting);
        setNotesValue(meeting.notes || '');
        setMobileView('detail');
      } else {
        loadMeetingDetail(meeting);
      }
    } catch {
      setCreateError('Erreur lors de la création. Veuillez réessayer.');
    } finally {
      setCreatingMeeting(false);
    }
  };

  // Lève le badge « en attente » d'une réunion dès que sa création a
  // effectivement atteint le serveur (voir src/lib/offlineQueue.ts).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { id, entity } = (e as CustomEvent).detail || {};
      if (entity === 'meeting') {
        setMeetings(prev => prev.map(m => m.id === id ? { ...m, pendingSync: false } : m));
        setSelectedMeeting(prev => prev && prev.id === id ? { ...prev, pendingSync: false } : prev);
      } else if (entity === 'proposal') {
        setProposals(prev => prev.map(p => p.id === id ? { ...p, pendingSync: false } : p));
        setSelectedProposal(prev => prev && prev.id === id ? { ...prev, pendingSync: false } : prev);
      } else if (entity === 'tender') {
        setTenders(prev => prev.map(t => t.id === id ? { ...t, pendingSync: false } : t));
        setSelectedTender(prev => prev && prev.id === id ? { ...prev, pendingSync: false } : prev);
      }
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
  }, []);

  const deleteMeeting = async (meeting: Meeting) => {
    const id = meeting.id;
    const ok = await askConfirm({
      title: 'Supprimer cette réunion ?',
      message: `« ${meeting.title} » du ${formatDate(meeting.date)}, avec ses notes, ses croquis et ses photos, sera supprimée.`,
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!ok) return;
    await queuedJsonRequest({ entity: 'meeting', id: crypto.randomUUID(), method: 'DELETE', url: `/api/meetings/${id}` });
    setMeetings(prev => prev.filter(m => m.id !== id));
    if (selectedMeeting?.id === id) setSelectedMeeting(null);
  };

  // Écrit les notes (ou les met en file hors ligne). Id stable par réunion :
  // les enregistrements successifs se remplacent dans la file, il n'en part
  // qu'un, avec le dernier texte.
  const persistNotes = async (meetingId: string, value: string, base: Pick<Meeting, 'title' | 'date'>) => {
    setNotesStatus({ kind: 'saving' });
    try {
      const { queued } = await queuedJsonRequest({
        entity: 'meeting', id: notesWriteId(meetingId), method: 'PUT', url: `/api/meetings/${meetingId}`,
        body: { title: base.title, date: base.date, notes: value },
      });
      // Le brouillon n'est libéré que si rien n'a été tapé entre-temps.
      if (readNotesDraft(meetingId) === value) clearNotesDraft(meetingId);
      setSelectedMeeting(prev => prev && prev.id === meetingId ? { ...prev, notes: value } : prev);
      setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, notes: value } : m));
      setNotesStatus(queued ? { kind: 'queued' } : { kind: 'saved', at: Date.now() });
    } catch (err) {
      // Le brouillon local reste : rien n'est perdu, mais la personne doit le savoir.
      setNotesStatus({ kind: 'error' });
      throw err;
    }
  };

  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsavedNotesRef = useRef<{ meeting: Meeting; value: string } | null>(null);
  const flushNotes = () => {
    if (notesTimerRef.current) { clearTimeout(notesTimerRef.current); notesTimerRef.current = null; }
    const unsaved = unsavedNotesRef.current;
    unsavedNotesRef.current = null;
    if (unsaved) void persistNotes(unsaved.meeting.id, unsaved.value, unsaved.meeting).catch(() => { /* le brouillon local reste */ });
  };

  const saveNotes = async () => {
    if (!selectedMeeting) return;
    if (notesTimerRef.current) { clearTimeout(notesTimerRef.current); notesTimerRef.current = null; }
    unsavedNotesRef.current = null;
    setSavingNotes(true);
    try {
      await persistNotes(selectedMeeting.id, notesValue, selectedMeeting);
    } catch { /* l'échec est affiché par l'état d'enregistrement ; le brouillon local reste */ } finally {
      setSavingNotes(false);
    }
  };

  const handleNotesChange = (value: string) => {
    setNotesValue(value);
    if (!selectedMeeting) return;
    const meeting = selectedMeeting;
    setNotesStatus({ kind: 'saving' });
    writeNotesDraft(meeting.id, value);
    unsavedNotesRef.current = { meeting, value };
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(flushNotes, NOTES_AUTOSAVE_DELAY_MS);
  };

  // Changer de réunion ou quitter l'écran : la saisie en attente part tout de
  // suite plutôt que d'attendre le délai.
  useEffect(() => {
    window.addEventListener('pagehide', flushNotes);
    return () => {
      window.removeEventListener('pagehide', flushNotes);
      flushNotes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeeting?.id]);

  const getAttendeesForExport = async (): Promise<MeetingAttendee[]> => {
    if (!selectedMeeting) return [];
    try { return await loadMeetingAttendees(selectedMeeting.id, await loadContactsForAttendees()); }
    catch { return []; }
  };

  const getParentName = () => {
    if (activeKind === 'project') return selectedProject?.name || '';
    if (activeKind === 'proposal') return selectedProposal?.title || '';
    if (activeKind === 'tender') return selectedTender?.title || '';
    return '';
  };

  /** Les croquis de la réunion, prêts à entrer dans l'export (une lecture qui échoue n'empêche jamais l'export). */
  const getCroquisForExport = async () => {
    if (!selectedMeeting) return [];
    const { loadCroquisExportItems } = await import('../lib/croquisExport');
    return loadCroquisExportItems({ kind: 'meeting', id: selectedMeeting.id, projectId: selectedMeeting.project_id ?? null, pending: selectedMeeting.pendingSync });
  };

  const handleExportPDF = async () => {
    if (!selectedMeeting) return;
    setExportingPdf(true);
    try {
      const attendees = await getAttendeesForExport();
      await exportMeetingToPDF(selectedMeeting, attendees, agencySettings, getParentName(), await getCroquisForExport());
    } finally { setExportingPdf(false); }
  };

  const handleExportDocx = async () => {
    if (!selectedMeeting) return;
    setExportingDocx(true);
    try {
      const attendees = await getAttendeesForExport();
      await exportMeetingToDocx(selectedMeeting, attendees, agencySettings, getParentName(), await getCroquisForExport());
    } finally { setExportingDocx(false); }
  };

  // Reçoit des fichiers déjà choisis : appareil photo, pellicule ou glisser-déposer.
  const uploadPhotoFiles = async (files: File[]) => {
    if (!selectedMeeting || !files.length) return;
    const meetingId = selectedMeeting.id;
    setUploadingPhoto(true);
    try {
      for (const file of files) {
        const photoId = crypto.randomUUID();
        // Id généré côté client : un envoi rejoué après coupure réseau
        // (src/lib/offlineQueue.ts) retrouve la même photo au lieu de la
        // déposer une seconde fois.
        const { queued, data } = await queuedMultipartRequest<MeetingPhoto>({
          entity: 'meetingPhoto', id: photoId, method: 'POST', url: `/api/meetings/${meetingId}/photos`,
          blob: file, blobFieldName: 'file', blobFilename: file.name, extraFields: { id: photoId },
        });
        const photo: MeetingPhoto = queued
          ? { id: photoId, meeting_id: meetingId, file_url: '', uploaded_at: new Date().toISOString(), pendingSync: true, localPreviewUrl: URL.createObjectURL(file) }
          : data!;
        setSelectedMeeting(prev => prev && prev.id === meetingId ? { ...prev, photos: [...(prev.photos || []), photo] } : prev);
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const { isOver: photoDropOver, dropProps: photoDropProps } = useImageDrop(
    files => { void uploadPhotoFiles(files); },
    !!selectedMeeting && !uploadingPhoto,
  );

  // Lève le badge « en attente » d'une photo dès que son envoi a
  // effectivement atteint le serveur, et remplace l'aperçu local par le
  // fichier réel (l'objet renvoyé n'est pas connu à la mise en file, donc on
  // recharge juste la fiche réunion pour le récupérer).
  useEffect(() => {
    const onSynced = (e: Event) => {
      const { entity } = (e as CustomEvent).detail || {};
      if (entity !== 'meetingPhoto' || !selectedMeeting) return;
      loadMeetingDetail(selectedMeeting);
    };
    window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_WRITE_SYNCED_EVENT, onSynced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeeting?.id]);

  const deletePhoto = async (photoId: string) => {
    if (!selectedMeeting) return;
    const ok = await askConfirm({
      title: 'Supprimer cette photo ?',
      message: 'La photo sera retirée de la réunion et de ses exports. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!ok) return;
    await queuedJsonRequest({ entity: 'meetingPhoto', id: crypto.randomUUID(), method: 'DELETE', url: `/api/meetings/${selectedMeeting.id}/photos/${photoId}` });
    setSelectedMeeting(prev => prev ? { ...prev, photos: (prev.photos || []).filter(p => p.id !== photoId) } : prev);
  };

  const saveCaption = async (photoId: string) => {
    await queuedJsonRequest({
      entity: 'meetingPhoto', id: crypto.randomUUID(), method: 'PATCH', url: `/api/meetings/photos/${photoId}/caption`,
      body: { caption: captionValue },
    });
    setSelectedMeeting(prev => prev ? {
      ...prev,
      photos: (prev.photos || []).map(p => p.id === photoId ? { ...p, caption: captionValue } : p),
    } : prev);
    setEditingCaption(null);
  };

  const filteredProjects = () => projects.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.client?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredProposals = () => proposals.filter(p =>
    !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || (p.client_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTenders = () => tenders.filter(t =>
    !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase()) || t.client?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleTopSection = (key: string) => {
    setExpandedTopSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Le statut d'une réunion ne suit pas la suivante.
  useEffect(() => { setNotesStatus({ kind: 'idle' }); }, [selectedMeeting?.id]);

  const hasActiveEntity = activeKind === 'project' ? !!selectedProject : activeKind === 'proposal' ? !!selectedProposal : !!selectedTender;

  // ── Panel: project/entity list ───────────────────────────────────────────────

  const ProjectsPanel = (
    <CollapsiblePanel
      collapsed={projectsPanel.collapsed}
      onExpand={() => projectsPanel.set(false)}
      expandLabel={panelLabels.expand}
      className={`
        lg:border-r
        ${mobileView === 'projects' ? 'w-full h-full' : 'hidden lg:flex'}
      `}
      style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}
    >
      <div className="p-3 flex-shrink-0 flex items-center gap-1" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="relative flex-1 min-w-0">
          <IconSearch size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Rechercher un projet, une proposition ou un appel d'offres"
            className={`w-full pl-8 pr-3 py-2 text-[0.8125rem] ${INPUT} pointer-coarse:min-h-11`}
          />
        </div>
        <PanelCollapseButton onClick={projectsPanel.toggle} label={panelLabels.collapse} expanded />
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {/* ── Projets section ── */}
        <div>
          <button
            type="button"
            aria-expanded={expandedTopSections.projects}
            onClick={() => toggleTopSection('projects')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider transition-colors text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)] ${FOCUS} pointer-coarse:min-h-11`}
          >
            {expandedTopSections.projects ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <IconBuilding size={14} />
            Projets
          </button>
          {expandedTopSections.projects && (
            <div className="pl-2 pb-1">
              {filteredProjects().length === 0 ? (
                <p className="px-4 py-1.5 text-[0.8125rem] italic" style={{ color: 'var(--tblr-muted)' }}>Aucun projet actif</p>
              ) : (
                filteredProjects().map(project => {
                  const isActive = activeKind === 'project' && selectedProject?.id === project.id;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => selectProject(project)}
                      className={`w-full text-left px-4 py-2 text-[0.8125rem] transition-colors truncate ${FOCUS} pointer-coarse:min-h-11 ${isActive
                        ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
                        : 'text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface)] hover:text-[var(--tblr-text)]'}`}
                    >
                      <div className="truncate font-medium">{project.name}</div>
                      <div className="truncate text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{project.client}</div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── Propositions section ── */}
        <div>
          <div className="flex items-center gap-0.5 pr-1.5">
            <button
              type="button"
              aria-expanded={expandedTopSections.proposals}
              onClick={() => toggleTopSection('proposals')}
              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider transition-colors text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)] ${FOCUS} pointer-coarse:min-h-11`}
            >
              {expandedTopSections.proposals ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <IconBriefcase size={14} />
              Propositions
            </button>
            <button
              type="button"
              onClick={() => { setNewParentKind('proposal'); setNewParentTitle(''); setExpandedTopSections(prev => ({ ...prev, proposals: true })); }}
              className={`flex-shrink-0 ${ICON_BTN}`}
              title="Nouvelle proposition"
              aria-label="Nouvelle proposition"
            >
              <IconPlus size={14} />
            </button>
          </div>
          {expandedTopSections.proposals && (
            <div className="pl-2 pb-1">
              {newParentKind === 'proposal' && (
                <div className="mx-2 mb-1.5 p-2 rounded-lg" style={{ background: 'var(--tblr-primary-lt)' }}>
                  <input
                    type="text"
                    placeholder="Titre de la proposition"
                    aria-label="Titre de la nouvelle proposition"
                    value={newParentTitle}
                    onChange={e => setNewParentTitle(e.target.value)}
                    autoFocus
                    className={`w-full px-2 py-1.5 text-[0.8125rem] mb-1.5 ${INPUT} pointer-coarse:min-h-11`}
                    onKeyDown={e => e.key === 'Enter' && createParent()}
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={createParent}
                      disabled={creatingParent || !newParentTitle.trim()}
                      type="button"
                      className={`flex-1 py-1 text-xs disabled:opacity-50 ${BTN_PRIMARY}`}
                    >
                      {creatingParent ? <IconLoader2 size={11} className="animate-spin" /> : null}
                      Créer
                    </button>
                    <button
                      type="button"
                      aria-label="Annuler la création"
                      onClick={() => setNewParentKind(null)}
                      className={`px-2 py-1 text-xs ${BTN_SECONDARY}`}
                    >
                      <IconX size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              {filteredProposals().length === 0 && newParentKind !== 'proposal' ? (
                <p className="px-4 py-1.5 text-[0.8125rem] italic" style={{ color: 'var(--tblr-muted)' }}>Aucune proposition</p>
              ) : (
                filteredProposals().map(proposal => {
                  const isActive = activeKind === 'proposal' && selectedProposal?.id === proposal.id;
                  return (
                    <button
                      key={proposal.id}
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => selectProposal(proposal)}
                      className={`w-full text-left px-4 py-2 text-[0.8125rem] transition-colors truncate ${FOCUS} pointer-coarse:min-h-11 ${isActive
                        ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
                        : 'text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface)] hover:text-[var(--tblr-text)]'}`}
                    >
                      <div className="truncate font-medium flex items-center gap-1.5">
                        {proposal.title}
                        {proposal.pendingSync && <span className="text-[0.5625rem] px-1 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--tblr-warning-lt)', color: 'var(--tblr-warning)' }}>en attente</span>}
                      </div>
                      <div className="truncate text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{proposal.client_name}</div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* ── Appels d'offres section ── */}
        <div>
          <div className="flex items-center gap-0.5 pr-1.5">
            <button
              type="button"
              aria-expanded={expandedTopSections.tenders}
              onClick={() => toggleTopSection('tenders')}
              className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-wider transition-colors text-[var(--tblr-muted)] hover:text-[var(--tblr-text)] hover:bg-[var(--tblr-surface)] ${FOCUS} pointer-coarse:min-h-11`}
            >
              {expandedTopSections.tenders ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <IconClipboardList size={14} />
              Appels d'offres
            </button>
            <button
              type="button"
              onClick={() => { setNewParentKind('tender'); setNewParentTitle(''); setExpandedTopSections(prev => ({ ...prev, tenders: true })); }}
              className={`flex-shrink-0 ${ICON_BTN}`}
              title="Nouvel appel d'offres"
              aria-label="Nouvel appel d'offres"
            >
              <IconPlus size={14} />
            </button>
          </div>
          {expandedTopSections.tenders && (
            <div className="pl-2 pb-1">
              {newParentKind === 'tender' && (
                <div className="mx-2 mb-1.5 p-2 rounded-lg" style={{ background: 'var(--tblr-primary-lt)' }}>
                  <input
                    type="text"
                    placeholder="Titre de l'appel d'offres"
                    aria-label="Titre du nouvel appel d'offres"
                    value={newParentTitle}
                    onChange={e => setNewParentTitle(e.target.value)}
                    autoFocus
                    className={`w-full px-2 py-1.5 text-[0.8125rem] mb-1.5 ${INPUT} pointer-coarse:min-h-11`}
                    onKeyDown={e => e.key === 'Enter' && createParent()}
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={createParent}
                      disabled={creatingParent || !newParentTitle.trim()}
                      type="button"
                      className={`flex-1 py-1 text-xs disabled:opacity-50 ${BTN_PRIMARY}`}
                    >
                      {creatingParent ? <IconLoader2 size={11} className="animate-spin" /> : null}
                      Créer
                    </button>
                    <button
                      type="button"
                      aria-label="Annuler la création"
                      onClick={() => setNewParentKind(null)}
                      className={`px-2 py-1 text-xs ${BTN_SECONDARY}`}
                    >
                      <IconX size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              {filteredTenders().length === 0 && newParentKind !== 'tender' ? (
                <p className="px-4 py-1.5 text-[0.8125rem] italic" style={{ color: 'var(--tblr-muted)' }}>Aucun appel d'offres</p>
              ) : (
                filteredTenders().map(tender => {
                  const isActive = activeKind === 'tender' && selectedTender?.id === tender.id;
                  return (
                    <button
                      key={tender.id}
                      type="button"
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => selectTender(tender)}
                      className={`w-full text-left px-4 py-2 text-[0.8125rem] transition-colors truncate ${FOCUS} pointer-coarse:min-h-11 ${isActive
                        ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
                        : 'text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface)] hover:text-[var(--tblr-text)]'}`}
                    >
                      <div className="truncate font-medium flex items-center gap-1.5">
                        {tender.title}
                        {tender.pendingSync && <span className="text-[0.5625rem] px-1 py-0.5 rounded flex-shrink-0" style={{ background: 'var(--tblr-warning-lt)', color: 'var(--tblr-warning)' }}>en attente</span>}
                      </div>
                      <div className="truncate text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{tender.client}</div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </nav>
    </CollapsiblePanel>
  );

  // ── Panel: meetings list ─────────────────────────────────────────────────────

  const activeEntityName = getParentName();
  const activeEntitySubtitle = activeKind === 'project'
    ? 'Projet'
    : activeKind === 'proposal' ? 'Proposition' : "Appel d'offres";

  const MeetingsPanel = (
    <CollapsiblePanel
      collapsed={meetingsPanel.collapsed}
      onExpand={() => meetingsPanel.set(false)}
      expandLabel={meetingsLabels.expand}
      className={`
        lg:border-r
        ${mobileView === 'meetings' ? 'w-full h-full' : 'hidden lg:flex'}
      `}
      style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
    >
      {/* Repli de la colonne (écrans larges) */}
      <div className="hidden lg:flex items-center justify-between gap-2 pl-3 pr-1 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <span className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Réunions</span>
        <PanelCollapseButton onClick={meetingsPanel.toggle} label={meetingsLabels.collapse} expanded />
      </div>
      {/* Mobile back button */}
      <div className="lg:hidden flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
        <button
          type="button"
          onClick={() => setMobileView('projects')}
          className={`flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded text-[var(--tblr-primary)] ${FOCUS} pointer-coarse:min-h-11`}
        >
          <IconChevronLeft size={16} aria-hidden="true" />
          Retour
        </button>
        {hasActiveEntity && (
          <button
            type="button"
            onClick={() => setShowNewMeeting(true)}
            className={`px-3 py-1.5 text-sm font-semibold ${BTN_PRIMARY}`}
          >
            <IconPlus size={16} aria-hidden="true" />
            Nouvelle réunion
          </button>
        )}
      </div>

      {hasActiveEntity ? (
        <>
          <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[0.8125rem] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{activeEntityName}</h3>
              <button
                type="button"
                onClick={() => setShowNewMeeting(true)}
                className={`hidden lg:inline-flex px-2 py-1 text-xs font-semibold flex-shrink-0 bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)] rounded hover:bg-[var(--tblr-primary)] hover:text-white transition-colors ${FOCUS} items-center gap-1`}
                title="Nouvelle réunion"
                aria-label="Nouvelle réunion"
              >
                <IconPlus size={14} aria-hidden="true" />
                <span>Nouveau</span>
              </button>
            </div>
            <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{activeEntitySubtitle}</p>
          </div>

          {showNewMeeting && (
            <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-primary-lt)' }}>
              <input
                type="text"
                placeholder="Titre de la réunion"
                aria-label="Titre de la réunion"
                value={newMeetingTitle}
                onChange={e => { setNewMeetingTitle(e.target.value); setCreateError(''); }}
                autoFocus
                className={`w-full px-2 py-1.5 text-[0.8125rem] mb-2 ${INPUT} pointer-coarse:min-h-11`}
                onKeyDown={e => e.key === 'Enter' && createMeeting()}
              />
              <input
                type="date"
                aria-label="Date de la réunion"
                value={newMeetingDate}
                onChange={e => setNewMeetingDate(e.target.value)}
                className={`w-full px-2 py-1.5 text-[0.8125rem] mb-2 ${INPUT} pointer-coarse:min-h-11`}
              />
              {createError && (
                <p role="alert" className="text-[0.6875rem] mb-1.5 px-1" style={{ color: 'var(--tblr-danger)' }}>{createError}</p>
              )}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={createMeeting}
                  disabled={creatingMeeting || !newMeetingTitle.trim()}
                  className={`flex-1 py-1 text-xs disabled:opacity-50 ${BTN_PRIMARY}`}
                >
                  {creatingMeeting ? <IconLoader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                  Créer
                </button>
                <button
                  type="button"
                  aria-label="Annuler la création de la réunion"
                  onClick={() => { setShowNewMeeting(false); setCreateError(''); }}
                  className={`px-2 py-1 text-xs ${BTN_SECONDARY}`}
                >
                  <IconX size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loadingMeetings ? (
              <div role="status" className="flex items-center justify-center h-20 text-[0.8125rem]" style={{ color: 'var(--tblr-muted)' }}>Chargement…</div>
            ) : meetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-[0.8125rem] gap-2" style={{ color: 'var(--tblr-muted)' }}>
                <IconNotes size={24} className="opacity-30" />
                <p>Aucune réunion</p>
                <button type="button" onClick={() => setShowNewMeeting(true)} className={`px-2 py-1 rounded text-[var(--tblr-primary)] hover:underline ${FOCUS} pointer-coarse:min-h-11`}>+ Ajouter</button>
              </div>
            ) : (
              <ul aria-label={`Réunions de ${activeEntityName}`}>
                {meetings.map(meeting => {
                  const isOpen = selectedMeeting?.id === meeting.id;
                  return (
                    <li key={meeting.id} className="group relative border-b border-[var(--tblr-border)]">
                      {/* Deux boutons frères, jamais l'un dans l'autre : ouvrir et supprimer s'atteignent chacun au clavier. */}
                      <button
                        type="button"
                        aria-current={isOpen ? 'true' : undefined}
                        onClick={() => loadMeetingDetail(meeting)}
                        className={`block w-full text-left pl-3 pr-12 py-2.5 transition-colors pointer-coarse:min-h-14 ${FOCUS} ${isOpen ? 'bg-[var(--tblr-primary-lt)]' : 'hover:bg-[var(--tblr-surface-2)]'}`}
                      >
                        <span className="block text-[0.8125rem] font-medium truncate" style={{ color: 'var(--tblr-text)' }}>
                          {meeting.title}
                          {meeting.pendingSync && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold align-middle bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                              en attente
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                          <IconCalendar size={11} aria-hidden="true" />
                          {formatDate(meeting.date)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Supprimer la réunion ${meeting.title}`}
                        title="Supprimer la réunion"
                        onClick={() => deleteMeeting(meeting)}
                        className={`absolute right-1 top-1/2 -translate-y-1/2 ${ICON_BTN_DANGER} min-h-9 min-w-9 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100`}
                      >
                        <IconTrash size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-[0.8125rem] gap-2 px-4 text-center" style={{ color: 'var(--tblr-muted)' }}>
          <IconBuilding size={28} className="opacity-20" />
          <p>Sélectionnez un projet, une proposition ou un appel d'offres</p>
        </div>
      )}
    </CollapsiblePanel>
  );

  // ── Panel: meeting detail ────────────────────────────────────────────────────

  const DetailPanel = (
    <div className={`
      flex-1 min-w-0 overflow-y-auto overflow-x-hidden
      ${mobileView === 'detail' ? 'flex flex-col w-full' : 'hidden lg:block'}
    `} style={{ background: 'var(--tblr-surface)' }}>
      {/* Mobile back button */}
      {mobileView === 'detail' && (
        <div className="lg:hidden flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
          <button
            type="button"
            onClick={() => setMobileView('meetings')}
            className={`flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded text-[var(--tblr-primary)] ${FOCUS} pointer-coarse:min-h-11`}
          >
            <IconChevronLeft size={16} aria-hidden="true" />
            Réunions
          </button>
        </div>
      )}

      {selectedMeeting ? (
        loadingDetail ? (
          <div role="status" className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--tblr-muted)' }}>Chargement…</div>
        ) : (
          <div className="w-full min-w-0 p-4 sm:p-6">
            {/* Header */}
            <div className="mb-6">
              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 mb-2 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold flex flex-wrap items-center gap-2 min-w-0 flex-1 break-words" style={{ color: 'var(--tblr-text)' }}>
                  {selectedMeeting.title}
                  {selectedMeeting.pendingSync && (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                      En attente d'envoi
                    </span>
                  )}
                </h1>
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={handleExportPDF}
                    disabled={exportingPdf}
                    title="Exporter en PDF"
                    className={`px-3 py-1.5 text-xs disabled:opacity-50 ${BTN_SECONDARY}`}
                  >
                    {exportingPdf ? <IconLoader2 size={14} className="animate-spin" aria-hidden="true" /> : <IconFileTypePdf size={14} aria-hidden="true" />}
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleExportDocx}
                    disabled={exportingDocx}
                    title="Exporter en Word"
                    className={`px-3 py-1.5 text-xs disabled:opacity-50 ${BTN_SECONDARY}`}
                  >
                    {exportingDocx ? <IconLoader2 size={14} className="animate-spin" aria-hidden="true" /> : <IconFileTypeDocx size={14} aria-hidden="true" />}
                    Word
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-sm flex-wrap" style={{ color: 'var(--tblr-muted)' }}>
                <span className="flex items-center gap-1"><IconCalendar size={14} aria-hidden="true" />{formatDate(selectedMeeting.date)}</span>
                <span aria-hidden="true" style={{ color: 'var(--tblr-border)' }}>•</span>
                <span className="truncate max-w-[7.5rem] sm:max-w-none">{activeEntityName}</span>
                {activeKind === 'project' && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline" style={{ color: 'var(--tblr-border)' }}>•</span>
                    <span className="hidden sm:inline">{activeEntitySubtitle}</span>
                  </>
                )}
              </div>
              {!online && (
                <p role="status" className="mt-3 flex items-start gap-2 rounded px-3 py-2 text-xs bg-[var(--tblr-warning-lt)] text-[var(--tblr-warning)]">
                  <IconAlertTriangle size={14} aria-hidden="true" className="mt-px flex-shrink-0" />
                  Hors ligne : ce que vous saisissez reste sur cet appareil et part au retour du réseau.
                </p>
              )}
            </div>

            {/* Notes : ce que l'on vient faire ici, donc en premier et plus grand que le reste */}
            <section aria-labelledby="reunion-notes-titre">
              <h2 id="reunion-notes-titre" className="text-base font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                <IconNotes size={18} aria-hidden="true" />
                Notes de réunion
              </h2>
              <textarea
                value={notesValue}
                onChange={e => handleNotesChange(e.target.value)}
                onBlur={saveNotes}
                aria-label="Notes de la réunion"
                aria-describedby="reunion-notes-etat"
                placeholder="Saisissez vos notes de réunion ici…"
                rows={12}
                className={`w-full px-4 py-3 text-sm resize-y leading-relaxed ${INPUT}`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 min-h-6">
                <p
                  id="reunion-notes-etat"
                  role="status"
                  aria-live="polite"
                  className="text-xs flex items-center gap-1.5"
                  style={{ color: notesStatus.kind === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}
                >
                  {notesStatus.kind === 'saving' && (<><IconLoader2 size={14} className="animate-spin" aria-hidden="true" />Enregistrement…</>)}
                  {notesStatus.kind === 'saved' && (<><IconCheck size={14} aria-hidden="true" />Enregistré à {new Date(notesStatus.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>)}
                  {notesStatus.kind === 'queued' && (<><IconAlertTriangle size={14} aria-hidden="true" />Gardé sur cet appareil : envoi au retour du réseau</>)}
                  {notesStatus.kind === 'error' && (<><IconAlertTriangle size={14} aria-hidden="true" />L'enregistrement a échoué. Votre texte est gardé sur cet appareil.</>)}
                  {notesStatus.kind === 'idle' && 'Enregistrement automatique pendant la saisie, même hors ligne'}
                </p>
                {notesStatus.kind === 'error' && (
                  <button type="button" onClick={saveNotes} disabled={savingNotes} className={`px-3 py-1 text-xs disabled:opacity-50 ${BTN_SECONDARY}`}>
                    Réessayer
                  </button>
                )}
              </div>
              {/* Enregistrement audio : le panneau garde son avertissement aux participants et son état en cours */}
              <div className="mt-4">
                <MeetingRecordingPanel kind="meeting" parentId={selectedMeeting.id} onInsert={async text => {
                  const meeting = selectedMeeting;
                  // A retry after a lost acknowledgement must not append the same draft twice.
                  const value = notesValue.trimEnd().endsWith(text) ? notesValue : appendMeetingNotes(notesValue, text);
                  handleNotesChange(value);
                  if (notesTimerRef.current) { clearTimeout(notesTimerRef.current); notesTimerRef.current = null; }
                  unsavedNotesRef.current = null;
                  await persistNotes(meeting.id, value, meeting);
                }} />
              </div>
            </section>

            {/* Intervenants */}
            <DetailSection id="intervenants" title="Intervenants" count={attendeeCount} icon={<IconUsers size={16} aria-hidden="true" />}>
              <AttendeesPanel meetingId={selectedMeeting.id} onCountChange={setAttendeeCount} />
            </DetailSection>

            {/* Croquis : schéma rapide, sur feuille blanche ou par-dessus un plan ou une photo */}
            <section className="mt-4 pt-3 border-t border-[var(--tblr-border)]">
              <CroquisPanel
                showHeading
                parent={{ kind: 'meeting', id: selectedMeeting.id, projectId: selectedMeeting.project_id ?? null, pending: selectedMeeting.pendingSync }}
              />
            </section>

            {/* Photos : appareil photo, pellicule ou glisser-déposer */}
            <PhotoSourcePicker multiple disabled={uploadingPhoto} onFiles={files => { void uploadPhotoFiles(files); }}>
            {openPhotoPicker => (
            <DetailSection
              id="photos"
              title="Photos"
              count={(selectedMeeting.photos || []).length}
              icon={<IconPhoto size={16} aria-hidden="true" />}
              action={
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  disabled={uploadingPhoto}
                  className={`px-3 py-1.5 text-xs disabled:opacity-50 whitespace-nowrap ${BTN_SECONDARY}`}
                >
                  <IconCamera size={14} aria-hidden="true" />
                  {uploadingPhoto ? 'Envoi…' : 'Ajouter'}
                </button>
              }
            >
            <div
              {...photoDropProps}
              className="rounded-lg transition-shadow"
              style={photoDropOver ? { boxShadow: '0 0 0 2px var(--tblr-primary)', background: 'var(--tblr-surface-2)' } : undefined}
            >
              {(selectedMeeting.photos || []).length === 0 ? (
                <button
                  type="button"
                  onClick={openPhotoPicker}
                  className={`w-full border-2 border-dashed border-[var(--tblr-border)] rounded-lg p-10 flex flex-col items-center gap-3 transition-colors text-[var(--tblr-muted)] hover:border-[var(--tblr-primary)] hover:text-[var(--tblr-primary)] ${FOCUS}`}
                >
                  <IconCamera size={32} aria-hidden="true" />
                  <span className="text-sm">{photoDropOver ? 'Déposez les photos ici' : 'Appuyez pour ajouter des photos'}</span>
                  <span className="text-xs">Appareil photo, pellicule ou glisser-déposer</span>
                </button>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                  {(selectedMeeting.photos || []).map(photo => (
                    <div key={photo.id} className="group relative rounded-lg overflow-hidden aspect-square" style={{ background: 'var(--tblr-surface-2)' }}>
                      {photo.pendingSync ? (
                        // Pas encore de file_url côté serveur (envoi en file, hors-ligne) :
                        // aperçu local, SignedImage n'aurait rien à résoudre.
                        <img
                          src={photo.localPreviewUrl}
                          alt={photo.caption || 'Photo'}
                          className="w-full h-full object-cover cursor-pointer opacity-70"
                        />
                      ) : (
                        <SignedImage
                          src={photo.file_url}
                          alt={photo.caption || 'Photo'}
                          className="w-full h-full object-cover cursor-pointer"
                          onClick={() => setLightboxPhoto(photo)}
                        />
                      )}
                      {photo.pendingSync && (
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold text-white bg-black/50 backdrop-blur-sm">
                          En attente d'envoi
                        </span>
                      )}
                      {/* Les commandes restent visibles au toucher, et au clavier dès qu'une d'elles a le focus ; la souris les révèle au survol. */}
                      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2 transition-colors bg-black/0 group-hover:bg-black/40 group-focus-within:bg-black/40">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                          <button
                            type="button"
                            aria-label={`Agrandir la photo${photo.caption ? ` : ${photo.caption}` : ''}`}
                            onClick={() => setLightboxPhoto(photo)}
                            className={`pointer-events-auto inline-flex items-center justify-center min-h-8 min-w-8 rounded bg-black/60 text-white hover:bg-black/80 transition-colors ${FOCUS} ${TOUCH}`}
                          >
                            <IconEye size={16} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Supprimer la photo${photo.caption ? ` : ${photo.caption}` : ''}`}
                            onClick={() => deletePhoto(photo.id)}
                            className={`pointer-events-auto inline-flex items-center justify-center min-h-8 min-w-8 rounded bg-[var(--tblr-danger)] text-white hover:brightness-110 transition ${FOCUS} ${TOUCH}`}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setEditingCaption(photo.id); setCaptionValue(photo.caption || ''); }}
                          className={`pointer-events-auto text-left px-2 py-1 bg-black/60 rounded text-white text-xs flex items-center gap-1 min-w-0 hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 ${FOCUS} pointer-coarse:min-h-11`}
                        >
                          <IconEdit size={12} aria-hidden="true" className="flex-shrink-0" />
                          <span className="truncate">{photo.caption || 'Ajouter une légende'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={openPhotoPicker}
                    className={`aspect-square rounded-lg border-2 border-dashed border-[var(--tblr-border)] flex flex-col items-center justify-center gap-1 transition-colors text-[var(--tblr-muted)] hover:border-[var(--tblr-primary)] hover:text-[var(--tblr-primary)] ${FOCUS}`}
                  >
                    <IconCamera size={20} aria-hidden="true" />
                    <span className="text-xs">Ajouter</span>
                  </button>
                </div>
              )}
            </div>
            </DetailSection>
            )}
            </PhotoSourcePicker>
          </div>
        )
      ) : hasActiveEntity ? (
        <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--tblr-muted)' }}>
          <IconNotes size={36} className="opacity-20" />
          <p className="text-sm">Sélectionnez ou créez une réunion</p>
          <button
            type="button"
            onClick={() => setShowNewMeeting(true)}
            className={`px-4 py-2 text-sm ${BTN_PRIMARY}`}
          >
            <IconPlus size={16} aria-hidden="true" />
            Nouvelle réunion
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--tblr-muted)' }}>
          <IconBuilding size={48} className="opacity-10" />
          <p className="text-sm">Sélectionnez un projet, une proposition ou un appel d'offres</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {ProjectsPanel}
      {MeetingsPanel}
      {DetailPanel}

      {/* Caption edit modal */}
      {editingCaption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingCaption(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reunion-legende-titre" className="rounded-lg p-4 w-full max-w-xs shadow-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }} onClick={e => e.stopPropagation()}>
            <h3 id="reunion-legende-titre" className="text-sm font-semibold mb-2" style={{ color: 'var(--tblr-text)' }}>Légende de la photo</h3>
            <input
              type="text"
              value={captionValue}
              onChange={e => setCaptionValue(e.target.value)}
              autoFocus
              aria-label="Légende de la photo"
              placeholder="Saisissez une légende…"
              className={`w-full px-3 py-2 text-sm ${INPUT} pointer-coarse:min-h-11`}
              onKeyDown={e => e.key === 'Enter' && saveCaption(editingCaption)}
            />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => saveCaption(editingCaption)} className={`flex-1 py-1.5 text-sm ${BTN_PRIMARY}`}>Enregistrer</button>
              <button type="button" onClick={() => setEditingCaption(null)} className={`px-3 py-1.5 text-sm ${BTN_SECONDARY}`}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div role="dialog" aria-modal="true" aria-label={lightboxPhoto.caption ? `Photo : ${lightboxPhoto.caption}` : 'Photo agrandie'} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setLightboxPhoto(null)}>
          <button
            type="button"
            autoFocus
            aria-label="Fermer la photo"
            onClick={() => setLightboxPhoto(null)}
            className={`absolute top-4 right-4 inline-flex items-center justify-center min-h-11 min-w-11 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors ${FOCUS}`}
          >
            <IconX size={20} aria-hidden="true" />
          </button>
          {lightboxPhoto.pendingSync ? (
            <img
              src={lightboxPhoto.localPreviewUrl}
              alt={lightboxPhoto.caption || 'Photo'}
              className="max-w-full max-h-[80dvh] object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <SignedImage
              src={lightboxPhoto.file_url}
              alt={lightboxPhoto.caption || 'Photo'}
              className="max-w-full max-h-[80dvh] object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />
          )}
          {lightboxPhoto.caption && <p className="mt-3 text-white/70 text-sm text-center">{lightboxPhoto.caption}</p>}
        </div>
      )}
    </div>
  );
}
