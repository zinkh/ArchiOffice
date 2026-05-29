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
        <p className="text-sm text-zinc-400 italic mb-3">Aucun intervenant ajouté</p>
      )}
      {attendees.length > 0 && (
        <div className="mb-3 divide-y divide-zinc-100 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
          {attendees.map(att => (
            <div key={att.id} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <IconUser size={16} className="text-zinc-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{contactDisplayName(att.contact)}</span>
                  {att.contact?.company_name && (
                    <span className="text-xs text-zinc-400">{att.contact.company_name}</span>
                  )}
                  {incomplete(att) && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
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
                      className="flex-1 px-2 py-0.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:ring-1 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-800"
                      onKeyDown={e => e.key === 'Enter' && saveRole(att.id)}
                    />
                    <button onClick={() => saveRole(att.id)} className="p-1 text-blue-500 hover:text-blue-700"><IconCheck size={12} /></button>
                    <button onClick={() => setEditingRole(null)} className="p-1 text-zinc-400 hover:text-zinc-600"><IconX size={12} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingRole(att.id); setRoleValue(att.role || ''); }}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mt-0.5 text-left"
                  >
                    {att.role || <span className="italic">+ Rôle / Entreprise</span>}
                  </button>
                )}
              </div>
              <button
                onClick={() => removeAttendee(att.id)}
                className="flex-shrink-0 p-1 text-zinc-300 hover:text-red-500 transition-colors"
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
          >
            <IconSearch size={12} />
            Contact existant
          </button>
          <button
            onClick={() => setMode('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
          >
            <IconUserPlus size={12} />
            Nouveau contact
          </button>
        </div>
      )}

      {mode === 'search' && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
            <IconSearch size={14} className="text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un contact..."
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none text-zinc-800 dark:text-zinc-200"
            />
            <button onClick={() => { setMode(null); setQuery(''); }} className="text-zinc-400 hover:text-zinc-600"><IconX size={14} /></button>
          </div>
          {filteredContacts.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-400 italic">
              {query ? 'Aucun contact trouvé' : 'Commencez à taper pour rechercher'}
            </p>
          ) : (
            <div>
              {filteredContacts.map(c => (
                <button
                  key={c.id}
                  onClick={() => addExisting(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0">
                    <IconUser size={14} className="text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name}
                      </span>
                      {isContactIncomplete(c) && (
                        <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 whitespace-nowrap">
                          <IconAlertTriangle size={8} />
                          À compléter
                        </span>
                      )}
                    </div>
                    {c.job_title && <p className="text-xs text-zinc-400 truncate">{c.job_title}{c.company_name ? ` · ${c.company_name}` : ''}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'new' && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Nouveau contact</span>
            <button onClick={() => setMode(null)} className="text-zinc-400 hover:text-zinc-600"><IconX size={14} /></button>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2">
            <input type="text" placeholder="Prénom" value={newFirst} onChange={e => setNewFirst(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="text" placeholder="Nom *" value={newLast} onChange={e => setNewLast(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="text" placeholder="Entreprise" value={newCompany} onChange={e => setNewCompany(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="text" placeholder="Fonction" value={newJob} onChange={e => setNewJob(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="tel" placeholder="Portable / Téléphone" value={newPhone} onChange={e => setNewPhone(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="email" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
            <input type="text" placeholder="Rôle dans la réunion" value={newRole} onChange={e => setNewRole(e.target.value)}
              className="col-span-2 px-2 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-zinc-900" />
          </div>
          {(!newFirst.trim() && !newLast.trim()) ? null : (
            (!newPhone.trim() || !newEmail.trim()) && (
              <div className="mx-3 mb-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg px-2.5 py-1.5">
                <IconAlertTriangle size={12} />
                Ce contact sera marqué « À compléter » dans votre carnet d'adresses.
              </div>
            )
          )}
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={createAndAdd}
              disabled={!newFirst.trim() && !newLast.trim()}
              className="flex-1 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Créer et ajouter
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
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
      flex flex-col overflow-hidden bg-white/30 dark:bg-zinc-900/30
      md:w-64 md:flex-shrink-0 md:border-r md:border-zinc-200 md:dark:border-zinc-800
      ${mobileView === 'projects' ? 'flex flex-col w-full h-full' : 'hidden md:flex'}
    `}>
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
        <div className="relative">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {SUBSECTIONS.map(({ key, label }) => (
          <div key={key}>
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {expandedSections[key] ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {label}
            </button>
            {expandedSections[key] && (
              <div className="pb-1">
                {filteredProjects(key).length === 0 ? (
                  <p className="px-4 py-1.5 text-xs text-zinc-400 italic">Aucun projet actif</p>
                ) : (
                  filteredProjects(key).map(project => (
                    <button
                      key={project.id}
                      onClick={() => selectProject(project, key)}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors truncate ${
                        selectedProject?.id === project.id && selectedSection === key
                          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      <div className="truncate font-medium">{project.name}</div>
                      <div className="truncate text-zinc-400 text-[10px]">{project.client}</div>
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
      flex flex-col overflow-hidden bg-white/20 dark:bg-zinc-900/20
      md:w-64 md:flex-shrink-0 md:border-r md:border-zinc-200 md:dark:border-zinc-800
      ${mobileView === 'meetings' ? 'flex flex-col w-full h-full' : 'hidden md:flex'}
    `}>
      {/* Mobile back button */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex-shrink-0">
        <button
          onClick={() => setMobileView('projects')}
          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium"
        >
          <IconChevronLeft size={14} />
          Projets
        </button>
      </div>

      {selectedProject ? (
        <>
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">{selectedProject.name}</h3>
              <button
                onClick={() => setShowNewMeeting(true)}
                className="p-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors"
                title="Nouvelle réunion"
              >
                <IconPlus size={14} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">
              {SUBSECTIONS.find(s => s.key === selectedSection)?.label}
            </p>
          </div>

          {showNewMeeting && (
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-blue-50/50 dark:bg-blue-900/10 flex-shrink-0">
              <input
                type="text"
                placeholder="Titre de la réunion"
                value={newMeetingTitle}
                onChange={e => setNewMeetingTitle(e.target.value)}
                autoFocus
                className="w-full px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:ring-1 focus:ring-blue-500 mb-2"
                onKeyDown={e => e.key === 'Enter' && createMeeting()}
              />
              <input
                type="date"
                value={newMeetingDate}
                onChange={e => setNewMeetingDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:ring-1 focus:ring-blue-500 mb-2"
              />
              <div className="flex gap-1">
                <button onClick={createMeeting} className="flex-1 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">Créer</button>
                <button onClick={() => setShowNewMeeting(false)} className="px-2 py-1 text-xs bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"><IconX size={12} /></button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loadingMeetings ? (
              <div className="flex items-center justify-center h-20 text-xs text-zinc-400">Chargement...</div>
            ) : meetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-xs text-zinc-400 gap-2">
                <IconNotes size={24} className="opacity-30" />
                <p>Aucune réunion</p>
                <button onClick={() => setShowNewMeeting(true)} className="text-blue-500 hover:underline">+ Ajouter</button>
              </div>
            ) : (
              meetings.map(meeting => (
                <div
                  key={meeting.id}
                  onClick={() => loadMeetingDetail(meeting)}
                  className={`group relative px-3 py-2.5 cursor-pointer border-b border-zinc-100 dark:border-zinc-800/50 transition-colors ${
                    selectedMeeting?.id === meeting.id
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{meeting.title}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 flex items-center gap-1">
                        <IconCalendar size={9} />
                        {formatDate(meeting.date)}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteMeeting(meeting.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-zinc-400 hover:text-red-500 transition-all"
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
        <div className="flex flex-col items-center justify-center h-full text-xs text-zinc-400 gap-2 px-4 text-center">
          <IconBuilding size={28} className="opacity-20" />
          <p>Sélectionnez un projet pour voir les réunions</p>
          <button
            onClick={() => setMobileView('projects')}
            className="md:hidden text-blue-500 hover:underline mt-1"
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
      flex-1 overflow-y-auto bg-white dark:bg-zinc-950
      ${mobileView === 'detail' ? 'flex flex-col w-full' : 'hidden md:block'}
    `}>
      {/* Mobile back button */}
      {mobileView === 'detail' && (
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex-shrink-0">
          <button
            onClick={() => setMobileView('meetings')}
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 font-medium"
          >
            <IconChevronLeft size={14} />
            Réunions
          </button>
        </div>
      )}

      {selectedMeeting ? (
        loadingDetail ? (
          <div className="flex items-center justify-center h-40 text-sm text-zinc-400">Chargement...</div>
        ) : (
          <div className="max-w-3xl mx-auto p-4 sm:p-6">
            {/* Header */}
            <div className="mb-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-2">
                <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white">{selectedMeeting.title}</h1>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleExportPDF}
                    disabled={exportingPdf}
                    title="Exporter en PDF"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 text-zinc-600 dark:text-zinc-400 transition-colors disabled:opacity-50"
                  >
                    {exportingPdf ? <IconLoader2 size={13} className="animate-spin" /> : <IconFileTypePdf size={13} />}
                    PDF
                  </button>
                  <button
                    onClick={handleExportDocx}
                    disabled={exportingDocx}
                    title="Exporter en Word"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 dark:hover:text-blue-400 text-zinc-600 dark:text-zinc-400 transition-colors disabled:opacity-50"
                  >
                    {exportingDocx ? <IconLoader2 size={13} className="animate-spin" /> : <IconFileTypeDocx size={13} />}
                    Word
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-sm text-zinc-500 flex-wrap">
                <span className="flex items-center gap-1"><IconCalendar size={14} />{formatDate(selectedMeeting.date)}</span>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                <span className="truncate max-w-[120px] sm:max-w-none">{selectedProject?.name}</span>
                <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">•</span>
                <span className="hidden sm:inline">{SUBSECTIONS.find(s => s.key === selectedSection)?.label}</span>
              </div>
            </div>

            {/* Intervenants */}
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
                <IconUsers size={16} />
                Intervenants
              </h2>
              <AttendeesPanel meetingId={selectedMeeting.id} />
            </div>

            <hr className="border-zinc-100 dark:border-zinc-800 mb-8" />

            {/* Notes */}
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                <IconNotes size={16} />
                Notes de réunion
              </h2>
              <textarea
                value={notesValue}
                onChange={e => setNotesValue(e.target.value)}
                onBlur={saveNotes}
                placeholder="Saisissez vos notes de réunion ici..."
                rows={10}
                className="w-full px-4 py-3 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-y text-zinc-800 dark:text-zinc-200 leading-relaxed"
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-2 gap-2">
                <p className="text-xs text-zinc-400">Sauvegarde automatique à la perte de focus</p>
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 self-start sm:self-auto"
                >
                  <IconCheck size={12} />
                  {savingNotes ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            </div>

            <hr className="border-zinc-100 dark:border-zinc-800 mb-8" />

            {/* Photos */}
            <div>
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <IconPhoto size={16} />
                  Photos ({(selectedMeeting.photos || []).length})
                </h2>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-800 dark:bg-zinc-700 text-white rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-600 transition-colors disabled:opacity-50 whitespace-nowrap"
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
                  className="w-full border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-10 flex flex-col items-center gap-3 text-zinc-400 hover:border-blue-400 hover:text-blue-400 transition-colors"
                >
                  <IconCamera size={32} className="opacity-50" />
                  <span className="text-sm">Appuyez pour ajouter des photos</span>
                  <span className="text-xs opacity-70">Depuis l'appareil photo ou la galerie</span>
                </button>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(selectedMeeting.photos || []).map(photo => (
                    <div key={photo.id} className="group relative rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 aspect-square">
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
                    className="aspect-square rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center gap-1 text-zinc-400 hover:border-blue-400 hover:text-blue-400 transition-colors"
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
        <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
          <IconNotes size={36} className="opacity-20" />
          <p className="text-sm">Sélectionnez ou créez une réunion</p>
          <button
            onClick={() => setShowNewMeeting(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <IconPlus size={16} />
            Nouvelle réunion
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-3">
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
          <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Légende de la photo</h3>
            <input
              type="text"
              value={captionValue}
              onChange={e => setCaptionValue(e.target.value)}
              autoFocus
              placeholder="Saisissez une légende..."
              className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-zinc-50 dark:bg-zinc-800"
              onKeyDown={e => e.key === 'Enter' && saveCaption(editingCaption)}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => saveCaption(editingCaption)} className="flex-1 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600">Enregistrer</button>
              <button onClick={() => setEditingCaption(null)} className="px-3 py-1.5 text-sm bg-zinc-200 dark:bg-zinc-700 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-600">Annuler</button>
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
