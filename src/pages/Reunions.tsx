import { useState, useEffect, useRef, useCallback } from 'react';
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
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Contact, Project, Meeting, MeetingPhoto, MeetingAttendee } from '../types';
import { isContactIncomplete } from './Contacts';
import { exportMeetingToPDF, exportMeetingToDocx, type AgencySettings } from '../lib/meetingExport';

type Subsection = 'projet' | 'visite_candidature' | 'visite_proposition';
type MobileView = 'projects' | 'meetings' | 'detail';

const SUBSECTIONS: { key: Subsection; label: string }[] = [
  { key: 'projet', label: 'Projets' },
  { key: 'visite_candidature', label: 'Visites Candidatures' },
  { key: 'visite_proposition', label: 'Visites Propositions' },
];

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function contactDisplayName(c: MeetingAttendee['contact']) {
  if (!c) return 'Inconnu';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Sans nom';
}

// ── Attendee panel ────────────────────────────────────────────────────────────

interface AttendeesPanelProps {
  meetingId: string;
}

function AttendeesPanel({ meetingId }: AttendeesPanelProps) {
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
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

  useEffect(() => {
    apiFetch<MeetingAttendee[]>(`/api/meetings/${meetingId}/attendees`).then(setAttendees).catch(() => {});
    apiFetch<Contact[]>('/api/contacts').then(setContacts).catch(() => {});
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
    const att = await apiFetch<MeetingAttendee>(`/api/meetings/${meetingId}/attendees`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contact.id, role: '' }),
    });
    setAttendees(prev => [...prev, att]);
    setQuery('');
    setMode(null);
  };

  const createAndAdd = async () => {
    if (!newFirst.trim() && !newLast.trim()) return;
    const att = await apiFetch<MeetingAttendee>(`/api/meetings/${meetingId}/attendees/new-contact`, {
      method: 'POST',
      body: JSON.stringify({
        first_name: newFirst, last_name: newLast, company_name: newCompany,
        job_title: newJob, phone_mobile: newPhone, email: newEmail, role: newRole,
      }),
    });
    setAttendees(prev => [...prev, att]);
    setNewFirst(''); setNewLast(''); setNewCompany(''); setNewJob('');
    setNewPhone(''); setNewEmail(''); setNewRole('');
    setMode(null);
  };

  const removeAttendee = async (id: string) => {
    await apiFetch(`/api/meetings/${meetingId}/attendees/${id}`, { method: 'DELETE' });
    setAttendees(prev => prev.filter(a => a.id !== id));
  };

  const saveRole = async (id: string) => {
    await apiFetch(`/api/meetings/${meetingId}/attendees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: roleValue }),
    });
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
        <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          {attendees.map((att, idx) => (
            <div key={att.id} className="flex items-center gap-3 px-3 py-2.5" style={{
              background: 'var(--tblr-surface)',
              borderTop: idx > 0 ? '1px solid var(--tblr-border)' : undefined,
            }}>
              <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--tblr-surface-2)' }}>
                <IconUser size={16} style={{ color: 'var(--tblr-muted)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{contactDisplayName(att.contact)}</span>
                  {att.contact?.company_name && (
                    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{att.contact.company_name}</span>
                  )}
                  {incomplete(att) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border" style={{ background: '#fff3bf', color: '#e67700', borderColor: '#ffe066' }}>
                      <IconAlertTriangle size={9} />
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
                      placeholder="Rôle / Entreprise..."
                      autoFocus
                      className="flex-1 px-2 py-0.5 text-xs rounded outline-none focus:ring-1 focus:ring-blue-500"
                      style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                      onKeyDown={e => e.key === 'Enter' && saveRole(att.id)}
                    />
                    <button onClick={() => saveRole(att.id)} className="p-1" style={{ color: 'var(--tblr-primary)' }}><IconCheck size={12} /></button>
                    <button onClick={() => setEditingRole(null)} className="p-1" style={{ color: 'var(--tblr-muted)' }}><IconX size={12} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingRole(att.id); setRoleValue(att.role || ''); }}
                    className="text-xs mt-0.5 text-left"
                    style={{ color: 'var(--tblr-muted)' }}
                  >
                    {att.role || <span className="italic">+ Rôle / Entreprise</span>}
                  </button>
                )}
              </div>
              <button
                onClick={() => removeAttendee(att.id)}
                className="flex-shrink-0 p-1 transition-colors"
                style={{ color: 'var(--tblr-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-danger)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!mode && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setMode('search')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }}
          >
            <IconSearch size={12} />
            Contact existant
          </button>
          <button
            onClick={() => setMode('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }}
          >
            <IconUserPlus size={12} />
            Nouveau contact
          </button>
        </div>
      )}

      {mode === 'search' && (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <IconSearch size={14} style={{ color: 'var(--tblr-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un contact..."
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--tblr-text)' }}
            />
            <button onClick={() => { setMode(null); setQuery(''); }} style={{ color: 'var(--tblr-muted)' }}><IconX size={14} /></button>
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
                  onClick={() => addExisting(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--tblr-border)' : undefined,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
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
                        <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-semibold border whitespace-nowrap" style={{ background: '#fff3bf', color: '#e67700', borderColor: '#ffe066' }}>
                          <IconAlertTriangle size={8} />
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
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>Nouveau contact</span>
            <button onClick={() => setMode(null)} style={{ color: 'var(--tblr-muted)' }}><IconX size={14} /></button>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2" style={{ background: 'var(--tblr-surface)' }}>
            <input type="text" placeholder="Prénom" value={newFirst} onChange={e => setNewFirst(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="text" placeholder="Nom *" value={newLast} onChange={e => setNewLast(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="text" placeholder="Entreprise" value={newCompany} onChange={e => setNewCompany(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="text" placeholder="Fonction" value={newJob} onChange={e => setNewJob(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="tel" placeholder="Portable / Téléphone" value={newPhone} onChange={e => setNewPhone(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="email" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
            <input type="text" placeholder="Rôle dans la réunion" value={newRole} onChange={e => setNewRole(e.target.value)}
              className="col-span-2 px-2 py-1.5 text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
          </div>
          {(!newFirst.trim() && !newLast.trim()) ? null : (
            (!newPhone.trim() || !newEmail.trim()) && (
              <div className="mx-3 mb-2 flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 border" style={{ color: '#e67700', background: '#fff3bf', borderColor: '#ffe066' }}>
                <IconAlertTriangle size={12} />
                Ce contact sera marqué « À compléter » dans votre carnet d'adresses.
              </div>
            )
          )}
          <div className="px-3 pb-3 flex gap-2" style={{ background: 'var(--tblr-surface)' }}>
            <button
              onClick={createAndAdd}
              disabled={!newFirst.trim() && !newLast.trim()}
              className="flex-1 py-2 text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              Créer et ajouter
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-2 text-sm rounded-lg transition-colors" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reunions() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mobile navigation state — one panel visible at a time on small screens
  const [mobileView, setMobileView] = useState<MobileView>('projects');

  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    projet: true,
    visite_candidature: false,
    visite_proposition: false,
  });
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSection, setSelectedSection] = useState<Subsection>('projet');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [newMeetingDate, setNewMeetingDate] = useState(new Date().toISOString().substring(0, 10));

  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState<MeetingPhoto | null>(null);

  const [agencySettings, setAgencySettings] = useState<AgencySettings>({});
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);

  useEffect(() => {
    apiFetch<Project[]>('/api/projects').then(data => {
      setProjects(data.filter(p => p.status !== 'Completed'));
    }).catch(() => {});
    apiFetch<any>('/api/settings').then(s => {
      setAgencySettings({
        agencyName: s.agencyName || s.agency_name,
        logoUrl: s.logoUrl || s.logo_url,
        address: s.address,
        phone: s.phone,
        email: s.email,
      });
    }).catch(() => {});
  }, []);

  const loadMeetings = useCallback(async (project: Project, section: Subsection) => {
    setLoadingMeetings(true);
    setSelectedMeeting(null);
    try {
      const data = await apiFetch<Meeting[]>(`/api/meetings?project_id=${project.id}&type=${section}`);
      setMeetings(data);
    } catch {
      setMeetings([]);
    } finally {
      setLoadingMeetings(false);
    }
  }, []);

  const selectProject = (project: Project, section: Subsection) => {
    setSelectedProject(project);
    setSelectedSection(section);
    loadMeetings(project, section);
    setShowNewMeeting(false);
    setMobileView('meetings');
  };

  const loadMeetingDetail = async (meeting: Meeting) => {
    setLoadingDetail(true);
    setSelectedMeeting(null);
    try {
      const data = await apiFetch<Meeting>(`/api/meetings/${meeting.id}`);
      setSelectedMeeting(data);
      setNotesValue(data.notes || '');
    } catch {
      setSelectedMeeting(meeting);
      setNotesValue(meeting.notes || '');
    } finally {
      setLoadingDetail(false);
    }
    setMobileView('detail');
  };

  const createMeeting = async () => {
    if (!selectedProject || !newMeetingTitle.trim()) return;
    const data = await apiFetch<Meeting>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        project_id: selectedProject.id,
        type: selectedSection,
        title: newMeetingTitle.trim(),
        date: newMeetingDate,
        notes: '',
      }),
    });
    setMeetings(prev => [data, ...prev]);
    setNewMeetingTitle('');
    setNewMeetingDate(new Date().toISOString().substring(0, 10));
    setShowNewMeeting(false);
    loadMeetingDetail(data);
  };

  const deleteMeeting = async (id: string) => {
    if (!confirm('Supprimer cette réunion ?')) return;
    await apiFetch(`/api/meetings/${id}`, { method: 'DELETE' });
    setMeetings(prev => prev.filter(m => m.id !== id));
    if (selectedMeeting?.id === id) setSelectedMeeting(null);
  };

  const saveNotes = async () => {
    if (!selectedMeeting) return;
    setSavingNotes(true);
    try {
      await apiFetch(`/api/meetings/${selectedMeeting.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: selectedMeeting.title, date: selectedMeeting.date, notes: notesValue }),
      });
      setSelectedMeeting(prev => prev ? { ...prev, notes: notesValue } : prev);
      setMeetings(prev => prev.map(m => m.id === selectedMeeting.id ? { ...m, notes: notesValue } : m));
    } finally {
      setSavingNotes(false);
    }
  };

  const getAttendeesForExport = async (): Promise<MeetingAttendee[]> => {
    if (!selectedMeeting) return [];
    try { return await apiFetch<MeetingAttendee[]>(`/api/meetings/${selectedMeeting.id}/attendees`); }
    catch { return []; }
  };

  const handleExportPDF = async () => {
    if (!selectedMeeting || !selectedProject) return;
    setExportingPdf(true);
    try {
      const attendees = await getAttendeesForExport();
      await exportMeetingToPDF(selectedMeeting, attendees, agencySettings, selectedProject.name);
    } finally { setExportingPdf(false); }
  };

  const handleExportDocx = async () => {
    if (!selectedMeeting || !selectedProject) return;
    setExportingDocx(true);
    try {
      const attendees = await getAttendeesForExport();
      await exportMeetingToDocx(selectedMeeting, attendees, agencySettings, selectedProject.name);
    } finally { setExportingDocx(false); }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedMeeting || !e.target.files?.length) return;
    const files = Array.from(e.target.files);
    setUploadingPhoto(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/meetings/${selectedMeeting.id}/photos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body: formData,
        });
        if (res.ok) {
          const photo = await res.json();
          setSelectedMeeting(prev => prev ? { ...prev, photos: [...(prev.photos || []), photo] } : prev);
        }
      }
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!selectedMeeting) return;
    await apiFetch(`/api/meetings/${selectedMeeting.id}/photos/${photoId}`, { method: 'DELETE' });
    setSelectedMeeting(prev => prev ? { ...prev, photos: (prev.photos || []).filter(p => p.id !== photoId) } : prev);
  };

  const saveCaption = async (photoId: string) => {
    await apiFetch(`/api/meetings/photos/${photoId}/caption`, {
      method: 'PATCH',
      body: JSON.stringify({ caption: captionValue }),
    });
    setSelectedMeeting(prev => prev ? {
      ...prev,
      photos: (prev.photos || []).map(p => p.id === photoId ? { ...p, caption: captionValue } : p),
    } : prev);
    setEditingCaption(null);
  };

  const filteredProjects = (_section: Subsection) => {
    return projects.filter(p =>
      !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.client?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Panel: project list ──────────────────────────────────────────────────────

  const ProjectsPanel = (
    <div className={`
      flex flex-col overflow-hidden
      md:w-64 md:flex-shrink-0 md:border-r
      ${mobileView === 'projects' ? 'flex flex-col w-full h-full' : 'hidden md:flex'}
    `} style={{ background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)' }}>
      <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div className="relative">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--tblr-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {SUBSECTIONS.map(({ key, label }) => (
          <div key={key}>
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
              style={{ color: 'var(--tblr-muted)' }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--tblr-text)';
                e.currentTarget.style.background = 'var(--tblr-surface)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--tblr-muted)';
                e.currentTarget.style.background = '';
              }}
            >
              {expandedSections[key] ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {label}
            </button>
            {expandedSections[key] && (
              <div className="pb-1">
                {filteredProjects(key).length === 0 ? (
                  <p className="px-4 py-1.5 text-xs italic" style={{ color: 'var(--tblr-muted)' }}>Aucun projet actif</p>
                ) : (
                  filteredProjects(key).map(project => (
                    <button
                      key={project.id}
                      onClick={() => selectProject(project, key)}
                      className="w-full text-left px-4 py-2 text-xs transition-colors truncate"
                      style={selectedProject?.id === project.id && selectedSection === key
                        ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                        : { color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => {
                        if (!(selectedProject?.id === project.id && selectedSection === key)) {
                          e.currentTarget.style.background = 'var(--tblr-surface)';
                          e.currentTarget.style.color = 'var(--tblr-text)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!(selectedProject?.id === project.id && selectedSection === key)) {
                          e.currentTarget.style.background = '';
                          e.currentTarget.style.color = 'var(--tblr-muted)';
                        }
                      }}
                    >
                      <div className="truncate font-medium">{project.name}</div>
                      <div className="truncate text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{project.client}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );

  // ── Panel: meetings list ─────────────────────────────────────────────────────

  const MeetingsPanel = (
    <div className={`
      flex flex-col overflow-hidden
      md:w-64 md:flex-shrink-0 md:border-r
      ${mobileView === 'meetings' ? 'flex flex-col w-full h-full' : 'hidden md:flex'}
    `} style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
      {/* Mobile back button */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
        <button
          onClick={() => setMobileView('projects')}
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: 'var(--tblr-primary)' }}
        >
          <IconChevronLeft size={14} />
          Projets
        </button>
      </div>

      {selectedProject ? (
        <>
          <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{selectedProject.name}</h3>
              <button
                onClick={() => setShowNewMeeting(true)}
                className="p-1 rounded-md transition-colors"
                style={{ color: 'var(--tblr-primary)' }}
                title="Nouvelle réunion"
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--tblr-primary-lt)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <IconPlus size={14} />
              </button>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>
              {SUBSECTIONS.find(s => s.key === selectedSection)?.label}
            </p>
          </div>

          {showNewMeeting && (
            <div className="p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-primary-lt)' }}>
              <input
                type="text"
                placeholder="Titre de la réunion"
                value={newMeetingTitle}
                onChange={e => setNewMeetingTitle(e.target.value)}
                autoFocus
                className="w-full px-2 py-1.5 text-xs rounded outline-none focus:ring-1 focus:ring-blue-500 mb-2"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                onKeyDown={e => e.key === 'Enter' && createMeeting()}
              />
              <input
                type="date"
                value={newMeetingDate}
                onChange={e => setNewMeetingDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded outline-none focus:ring-1 focus:ring-blue-500 mb-2"
                style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
              <div className="flex gap-1">
                <button onClick={createMeeting} className="flex-1 py-1 text-xs rounded transition-colors" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>Créer</button>
                <button onClick={() => setShowNewMeeting(false)} className="px-2 py-1 text-xs rounded transition-colors" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}><IconX size={12} /></button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loadingMeetings ? (
              <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--tblr-muted)' }}>Chargement...</div>
            ) : meetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-xs gap-2" style={{ color: 'var(--tblr-muted)' }}>
                <IconNotes size={24} className="opacity-30" />
                <p>Aucune réunion</p>
                <button onClick={() => setShowNewMeeting(true)} className="hover:underline" style={{ color: 'var(--tblr-primary)' }}>+ Ajouter</button>
              </div>
            ) : (
              meetings.map(meeting => (
                <div
                  key={meeting.id}
                  onClick={() => loadMeetingDetail(meeting)}
                  className="group relative px-3 py-2.5 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--tblr-border)',
                    background: selectedMeeting?.id === meeting.id ? 'var(--tblr-primary-lt)' : undefined,
                  }}
                  onMouseEnter={e => {
                    if (selectedMeeting?.id !== meeting.id) e.currentTarget.style.background = 'var(--tblr-surface-2)';
                  }}
                  onMouseLeave={e => {
                    if (selectedMeeting?.id !== meeting.id) e.currentTarget.style.background = '';
                  }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--tblr-text)' }}>{meeting.title}</p>
                      <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--tblr-muted)' }}>
                        <IconCalendar size={9} />
                        {formatDate(meeting.date)}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteMeeting(meeting.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all"
                      style={{ color: 'var(--tblr-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--tblr-danger)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--tblr-muted)')}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-xs gap-2 px-4 text-center" style={{ color: 'var(--tblr-muted)' }}>
          <IconBuilding size={28} className="opacity-20" />
          <p>Sélectionnez un projet pour voir les réunions</p>
          <button
            onClick={() => setMobileView('projects')}
            className="md:hidden hover:underline mt-1"
            style={{ color: 'var(--tblr-primary)' }}
          >
            ← Retour aux projets
          </button>
        </div>
      )}
    </div>
  );

  // ── Panel: meeting detail ────────────────────────────────────────────────────

  const DetailPanel = (
    <div className={`
      flex-1 overflow-y-auto
      ${mobileView === 'detail' ? 'flex flex-col w-full' : 'hidden md:block'}
    `} style={{ background: 'var(--tblr-surface)' }}>
      {/* Mobile back button */}
      {mobileView === 'detail' && (
        <div className="md:hidden flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
          <button
            onClick={() => setMobileView('meetings')}
            className="flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--tblr-primary)' }}
          >
            <IconChevronLeft size={14} />
            Réunions
          </button>
        </div>
      )}

      {selectedMeeting ? (
        loadingDetail ? (
          <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--tblr-muted)' }}>Chargement...</div>
        ) : (
          <div className="max-w-3xl mx-auto p-4 sm:p-6">
            {/* Header */}
            <div className="mb-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-2">
                <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{selectedMeeting.title}</h1>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleExportPDF}
                    disabled={exportingPdf}
                    title="Exporter en PDF"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50"
                    style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#ffe0e0';
                      e.currentTarget.style.color = 'var(--tblr-danger)';
                      e.currentTarget.style.borderColor = '#fca5a5';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--tblr-surface)';
                      e.currentTarget.style.color = 'var(--tblr-muted)';
                      e.currentTarget.style.borderColor = 'var(--tblr-border)';
                    }}
                  >
                    {exportingPdf ? <IconLoader2 size={13} className="animate-spin" /> : <IconFileTypePdf size={13} />}
                    PDF
                  </button>
                  <button
                    onClick={handleExportDocx}
                    disabled={exportingDocx}
                    title="Exporter en Word"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50"
                    style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)', background: 'var(--tblr-surface)' }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--tblr-primary-lt)';
                      e.currentTarget.style.color = 'var(--tblr-primary)';
                      e.currentTarget.style.borderColor = 'var(--tblr-primary)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--tblr-surface)';
                      e.currentTarget.style.color = 'var(--tblr-muted)';
                      e.currentTarget.style.borderColor = 'var(--tblr-border)';
                    }}
                  >
                    {exportingDocx ? <IconLoader2 size={13} className="animate-spin" /> : <IconFileTypeDocx size={13} />}
                    Word
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-sm flex-wrap" style={{ color: 'var(--tblr-muted)' }}>
                <span className="flex items-center gap-1"><IconCalendar size={14} />{formatDate(selectedMeeting.date)}</span>
                <span style={{ color: 'var(--tblr-border)' }}>•</span>
                <span className="truncate max-w-[120px] sm:max-w-none">{selectedProject?.name}</span>
                <span className="hidden sm:inline" style={{ color: 'var(--tblr-border)' }}>•</span>
                <span className="hidden sm:inline">{SUBSECTIONS.find(s => s.key === selectedSection)?.label}</span>
              </div>
            </div>

            {/* Intervenants */}
            <div className="mb-8">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                <IconUsers size={16} />
                Intervenants
              </h2>
              <AttendeesPanel meetingId={selectedMeeting.id} />
            </div>

            <hr className="mb-8" style={{ borderColor: 'var(--tblr-border)' }} />

            {/* Notes */}
            <div className="mb-8">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                <IconNotes size={16} />
                Notes de réunion
              </h2>
              <textarea
                value={notesValue}
                onChange={e => setNotesValue(e.target.value)}
                onBlur={saveNotes}
                placeholder="Saisissez vos notes de réunion ici..."
                rows={10}
                className="w-full px-4 py-3 text-sm rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-y leading-relaxed"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-2 gap-2">
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>Sauvegarde automatique à la perte de focus</p>
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 self-start sm:self-auto"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  <IconCheck size={12} />
                  {savingNotes ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            <hr className="mb-8" style={{ borderColor: 'var(--tblr-border)' }} />

            {/* Photos */}
            <div>
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
                  <IconPhoto size={16} />
                  Photos ({(selectedMeeting.photos || []).length})
                </h2>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                  style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}
                >
                  <IconCamera size={14} />
                  {uploadingPhoto ? 'Upload...' : 'Ajouter'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </div>

              {(selectedMeeting.photos || []).length === 0 ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors"
                  style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--tblr-primary)';
                    e.currentTarget.style.color = 'var(--tblr-primary)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--tblr-border)';
                    e.currentTarget.style.color = 'var(--tblr-muted)';
                  }}
                >
                  <IconCamera size={32} className="opacity-50" />
                  <span className="text-sm">Appuyez pour ajouter des photos</span>
                  <span className="text-xs opacity-70">Depuis l'appareil photo ou la galerie</span>
                </button>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(selectedMeeting.photos || []).map(photo => (
                    <div key={photo.id} className="group relative rounded-xl overflow-hidden aspect-square" style={{ background: 'var(--tblr-surface-2)' }}>
                      <img
                        src={photo.file_url}
                        alt={photo.caption || 'Photo'}
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => setLightboxPhoto(photo)}
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex flex-col justify-between p-2 opacity-0 group-hover:opacity-100">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setLightboxPhoto(photo)} className="p-1 bg-white/20 backdrop-blur-sm rounded text-white hover:bg-white/30 transition-colors">
                            <IconEye size={14} />
                          </button>
                          <button onClick={() => deletePhoto(photo.id)} className="p-1 bg-red-500/80 backdrop-blur-sm rounded text-white hover:bg-red-600 transition-colors">
                            <IconTrash size={14} />
                          </button>
                        </div>
                        <button
                          onClick={() => { setEditingCaption(photo.id); setCaptionValue(photo.caption || ''); }}
                          className="text-left p-1 bg-black/30 backdrop-blur-sm rounded text-white text-xs flex items-center gap-1 hover:bg-black/50 transition-colors"
                        >
                          <IconEdit size={10} />
                          {photo.caption || 'Légende...'}
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors"
                    style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--tblr-primary)';
                      e.currentTarget.style.color = 'var(--tblr-primary)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--tblr-border)';
                      e.currentTarget.style.color = 'var(--tblr-muted)';
                    }}
                  >
                    <IconCamera size={20} />
                    <span className="text-xs">Ajouter</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      ) : selectedProject ? (
        <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--tblr-muted)' }}>
          <IconNotes size={36} className="opacity-20" />
          <p className="text-sm">Sélectionnez ou créez une réunion</p>
          <button
            onClick={() => setShowNewMeeting(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
            style={{ background: 'var(--tblr-primary)', color: '#fff' }}
          >
            <IconPlus size={16} />
            Nouvelle réunion
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--tblr-muted)' }}>
          <IconBuilding size={48} className="opacity-10" />
          <p className="text-sm">Sélectionnez un projet dans la liste</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {ProjectsPanel}
      {MeetingsPanel}
      {DetailPanel}

      {/* Caption edit modal */}
      {editingCaption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingCaption(null)}>
          <div className="rounded-xl p-4 w-full max-w-xs shadow-2xl" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--tblr-text)' }}>Légende de la photo</h3>
            <input
              type="text"
              value={captionValue}
              onChange={e => setCaptionValue(e.target.value)}
              autoFocus
              placeholder="Saisissez une légende..."
              className="w-full px-3 py-2 text-sm rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              onKeyDown={e => e.key === 'Enter' && saveCaption(editingCaption)}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => saveCaption(editingCaption)} className="flex-1 py-1.5 text-sm rounded-lg" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>Enregistrer</button>
              <button onClick={() => setEditingCaption(null)} className="px-3 py-1.5 text-sm rounded-lg" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setLightboxPhoto(null)}>
          <button onClick={() => setLightboxPhoto(null)} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors">
            <IconX size={20} />
          </button>
          <img
            src={lightboxPhoto.file_url}
            alt={lightboxPhoto.caption || 'Photo'}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          {lightboxPhoto.caption && <p className="mt-3 text-white/70 text-sm text-center">{lightboxPhoto.caption}</p>}
        </div>
      )}
    </div>
  );
}
