import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  IconCamera, IconPencil, IconCheck, IconX, IconPlus, IconTrash, IconSchool,
  IconBuilding, IconFileText, IconDownload, IconUpload, IconBriefcase,
  IconMail, IconPhone, IconMapPin, IconMessageCircle, IconBell
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { cn } from '../lib/utils';
import { useUser } from '../UserContext';

interface EducationEntry {
  id: string;
  school: string;
  degree?: string;
  field?: string;
  start_year?: string;
  end_year?: string;
}

interface ExperienceEntry {
  id: string;
  title: string;
  company?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
}

interface CurrentProject {
  id: string;
  name: string;
  status?: string;
  role?: string;
}

interface ProfileData {
  id: string;
  name: string;
  email?: string;
  role?: string;
  jobTitle?: string;
  department?: string;
  phone?: string;
  address?: string;
  avatar?: string;
  bio?: string;
  cv_url?: string;
  cv_filename?: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  current_projects: CurrentProject[];
  is_self: boolean;
}

function initials(name: string) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function SectionCard({ title, icon: Icon, action, children }: { title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-blue-600 dark:text-blue-400" />
          <h2 className="font-bold text-zinc-900 dark:text-white">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function Profile() {
  const { userId: paramUserId } = useParams();
  const { currentUser } = useUser();
  const navigate = useNavigate();
  const targetUserId = paramUserId || currentUser?.id;
  const isViewingSelf = !paramUserId || paramUserId === currentUser?.id;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingAbout, setIsEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState({ bio: '', jobTitle: '', department: '' });
  const [isSavingAbout, setIsSavingAbout] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingCv, setIsUploadingCv] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);

  const [showEducationForm, setShowEducationForm] = useState(false);
  const [educationDraft, setEducationDraft] = useState({ school: '', degree: '', field: '', start_year: '', end_year: '' });
  const [showExperienceForm, setShowExperienceForm] = useState(false);
  const [experienceDraft, setExperienceDraft] = useState({ title: '', company: '', start_date: '', end_date: '', description: '' });

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(async () => {
    if (!targetUserId) return;
    setIsLoading(true);
    try {
      const data = await apiFetch<ProfileData>(`/api/profile/${targetUserId}`);
      setProfile(data);
      setAboutDraft({ bio: data.bio || '', jobTitle: data.jobTitle || '', department: data.department || '' });
    } catch (err) {
      console.error(err);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const uploadFile = async (url: string, field: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const token = await getAccessToken();
    return fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    try {
      const res = await uploadFile('/api/upload/avatar', 'file', file);
      if (res.ok) {
        const { url } = await res.json();
        setProfile(p => p ? { ...p, avatar: url } : p);
      }
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleCvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingCv(true);
    try {
      const res = await uploadFile('/api/profile/cv', 'file', file);
      if (res.ok) {
        const { url, filename } = await res.json();
        setProfile(p => p ? { ...p, cv_url: url, cv_filename: filename } : p);
      }
    } finally {
      setIsUploadingCv(false);
    }
  };

  const handleRemoveCv = async () => {
    try {
      await apiFetch('/api/profile/cv', { method: 'DELETE' });
      setProfile(p => p ? { ...p, cv_url: undefined, cv_filename: undefined } : p);
    } catch (err) { console.error(err); }
  };

  const saveAbout = async () => {
    setIsSavingAbout(true);
    try {
      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ bio: aboutDraft.bio, job_title: aboutDraft.jobTitle, department: aboutDraft.department })
      });
      setProfile(p => p ? { ...p, bio: aboutDraft.bio, jobTitle: aboutDraft.jobTitle, department: aboutDraft.department } : p);
      setIsEditingAbout(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingAbout(false);
    }
  };

  const addEducation = async () => {
    if (!educationDraft.school.trim()) return;
    try {
      const entry = await apiFetch<EducationEntry>('/api/profile/education', { method: 'POST', body: JSON.stringify(educationDraft) });
      setProfile(p => p ? { ...p, education: [...p.education, entry] } : p);
      setEducationDraft({ school: '', degree: '', field: '', start_year: '', end_year: '' });
      setShowEducationForm(false);
    } catch (err) { console.error(err); }
  };

  const deleteEducation = async (id: string) => {
    try {
      await apiFetch(`/api/profile/education/${id}`, { method: 'DELETE' });
      setProfile(p => p ? { ...p, education: p.education.filter(e => e.id !== id) } : p);
    } catch (err) { console.error(err); }
  };

  const addExperience = async () => {
    if (!experienceDraft.title.trim()) return;
    try {
      const entry = await apiFetch<ExperienceEntry>('/api/profile/experience', { method: 'POST', body: JSON.stringify(experienceDraft) });
      setProfile(p => p ? { ...p, experience: [...p.experience, entry] } : p);
      setExperienceDraft({ title: '', company: '', start_date: '', end_date: '', description: '' });
      setShowExperienceForm(false);
    } catch (err) { console.error(err); }
  };

  const deleteExperience = async (id: string) => {
    try {
      await apiFetch(`/api/profile/experience/${id}`, { method: 'DELETE' });
      setProfile(p => p ? { ...p, experience: p.experience.filter(e => e.id !== id) } : p);
    } catch (err) { console.error(err); }
  };

  const startConversation = async () => {
    if (!profile) return;
    setIsStartingChat(true);
    try {
      const { id } = await apiFetch<{ id: string }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ participant_ids: [profile.id], is_group: false })
      });
      navigate(`/messages?c=${id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsStartingChat(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center text-zinc-400">
        <p>Profil introuvable.</p>
      </div>
    );
  }

  const inputClass = "w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-zinc-900 dark:text-white text-sm";

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="relative shrink-0">
            <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
              {profile.avatar ? <img src={profile.avatar} alt={profile.name} className="w-full h-full object-cover" /> : initials(profile.name)}
            </div>
            {isViewingSelf && (
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="absolute -bottom-1 -right-1 p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-colors disabled:opacity-50"
                title="Changer la photo"
              >
                <IconCamera size={14} />
              </button>
            )}
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>

          <div className="flex-1 text-center sm:text-left min-w-0">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">{profile.name}</h1>
            <p className="text-zinc-500 dark:text-zinc-400">{profile.jobTitle || profile.role}{profile.department ? ` · ${profile.department}` : ''}</p>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {profile.email && <span className="flex items-center gap-1"><IconMail size={13} />{profile.email}</span>}
              {profile.phone && <span className="flex items-center gap-1"><IconPhone size={13} />{profile.phone}</span>}
              {profile.address && <span className="flex items-center gap-1"><IconMapPin size={13} />{profile.address}</span>}
            </div>
          </div>

          <div className="flex sm:flex-col gap-2 shrink-0">
            {isViewingSelf ? (
              <Link to="/notifications" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 rounded-lg transition-colors">
                <IconBell size={15} /> Notifications
              </Link>
            ) : (
              <button
                onClick={startConversation}
                disabled={isStartingChat}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60"
              >
                <IconMessageCircle size={15} /> {isStartingChat ? '...' : 'Message'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* About */}
      <SectionCard
        title="À propos"
        icon={IconPencil}
        action={isViewingSelf && !isEditingAbout && (
          <button onClick={() => setIsEditingAbout(true)} className="text-zinc-400 hover:text-blue-600 transition-colors">
            <IconPencil size={16} />
          </button>
        )}
      >
        {isEditingAbout ? (
          <div className="space-y-3">
            <textarea
              rows={3}
              placeholder="Parlez un peu de vous..."
              className={inputClass}
              value={aboutDraft.bio}
              onChange={e => setAboutDraft(d => ({ ...d, bio: e.target.value }))}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputClass} placeholder="Poste" value={aboutDraft.jobTitle} onChange={e => setAboutDraft(d => ({ ...d, jobTitle: e.target.value }))} />
              <input className={inputClass} placeholder="Service" value={aboutDraft.department} onChange={e => setAboutDraft(d => ({ ...d, department: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <button onClick={saveAbout} disabled={isSavingAbout} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                <IconCheck size={14} /> Enregistrer
              </button>
              <button onClick={() => { setIsEditingAbout(false); setAboutDraft({ bio: profile.bio || '', jobTitle: profile.jobTitle || '', department: profile.department || '' }); }} className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
                <IconX size={14} /> Annuler
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
            {profile.bio || <span className="text-zinc-400 italic">Aucune bio renseignée.</span>}
          </p>
        )}
      </SectionCard>

      {/* Current projects — read-only, sourced from real project assignments */}
      <SectionCard title="Projets en cours" icon={IconBriefcase}>
        {profile.current_projects.length === 0 ? (
          <p className="text-sm text-zinc-400 italic">Aucun projet assigné pour le moment.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {profile.current_projects.map(proj => (
              <Link
                key={proj.id}
                to={`/projects/${proj.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{proj.name}</p>
                  {proj.role && <p className="text-xs text-zinc-400">{proj.role}</p>}
                </div>
                {proj.status && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shrink-0">
                    {proj.status}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Experience */}
      <SectionCard
        title="Expérience"
        icon={IconBuilding}
        action={isViewingSelf && (
          <button onClick={() => setShowExperienceForm(v => !v)} className="text-zinc-400 hover:text-blue-600 transition-colors">
            <IconPlus size={16} />
          </button>
        )}
      >
        {showExperienceForm && (
          <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className={inputClass} placeholder="Intitulé du poste" value={experienceDraft.title} onChange={e => setExperienceDraft(d => ({ ...d, title: e.target.value }))} />
              <input className={inputClass} placeholder="Entreprise" value={experienceDraft.company} onChange={e => setExperienceDraft(d => ({ ...d, company: e.target.value }))} />
              <input className={inputClass} placeholder="Début (ex: 2020)" value={experienceDraft.start_date} onChange={e => setExperienceDraft(d => ({ ...d, start_date: e.target.value }))} />
              <input className={inputClass} placeholder="Fin (ou 'Présent')" value={experienceDraft.end_date} onChange={e => setExperienceDraft(d => ({ ...d, end_date: e.target.value }))} />
            </div>
            <textarea rows={2} className={inputClass} placeholder="Description (optionnel)" value={experienceDraft.description} onChange={e => setExperienceDraft(d => ({ ...d, description: e.target.value }))} />
            <div className="flex gap-2">
              <button onClick={addExperience} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">Ajouter</button>
              <button onClick={() => setShowExperienceForm(false)} className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-semibold rounded-lg">Annuler</button>
            </div>
          </div>
        )}
        {profile.experience.length === 0 && !showExperienceForm ? (
          <p className="text-sm text-zinc-400 italic">Aucune expérience renseignée.</p>
        ) : (
          <div className="space-y-3">
            {profile.experience.map(exp => (
              <div key={exp.id} className="flex items-start justify-between gap-2 group">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{exp.title}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {exp.company}{(exp.start_date || exp.end_date) ? ` · ${exp.start_date || ''} — ${exp.end_date || 'Présent'}` : ''}
                  </p>
                  {exp.description && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{exp.description}</p>}
                </div>
                {isViewingSelf && (
                  <button onClick={() => deleteExperience(exp.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all shrink-0">
                    <IconTrash size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Education */}
      <SectionCard
        title="Études"
        icon={IconSchool}
        action={isViewingSelf && (
          <button onClick={() => setShowEducationForm(v => !v)} className="text-zinc-400 hover:text-blue-600 transition-colors">
            <IconPlus size={16} />
          </button>
        )}
      >
        {showEducationForm && (
          <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className={inputClass} placeholder="Établissement" value={educationDraft.school} onChange={e => setEducationDraft(d => ({ ...d, school: e.target.value }))} />
              <input className={inputClass} placeholder="Diplôme" value={educationDraft.degree} onChange={e => setEducationDraft(d => ({ ...d, degree: e.target.value }))} />
              <input className={inputClass} placeholder="Domaine" value={educationDraft.field} onChange={e => setEducationDraft(d => ({ ...d, field: e.target.value }))} />
              <div className="flex gap-2">
                <input className={inputClass} placeholder="Début" value={educationDraft.start_year} onChange={e => setEducationDraft(d => ({ ...d, start_year: e.target.value }))} />
                <input className={inputClass} placeholder="Fin" value={educationDraft.end_year} onChange={e => setEducationDraft(d => ({ ...d, end_year: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addEducation} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">Ajouter</button>
              <button onClick={() => setShowEducationForm(false)} className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm font-semibold rounded-lg">Annuler</button>
            </div>
          </div>
        )}
        {profile.education.length === 0 && !showEducationForm ? (
          <p className="text-sm text-zinc-400 italic">Aucune formation renseignée.</p>
        ) : (
          <div className="space-y-3">
            {profile.education.map(edu => (
              <div key={edu.id} className="flex items-start justify-between gap-2 group">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{edu.school}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {[edu.degree, edu.field].filter(Boolean).join(' · ')}{(edu.start_year || edu.end_year) ? ` · ${edu.start_year || ''}–${edu.end_year || ''}` : ''}
                  </p>
                </div>
                {isViewingSelf && (
                  <button onClick={() => deleteEducation(edu.id)} className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all shrink-0">
                    <IconTrash size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* CV */}
      <SectionCard title="CV" icon={IconFileText}>
        {profile.cv_url ? (
          <div className="flex items-center justify-between gap-2">
            <a href={profile.cv_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
              <IconDownload size={15} /> {profile.cv_filename || 'Télécharger le CV'}
            </a>
            {isViewingSelf && (
              <button onClick={handleRemoveCv} className="text-zinc-400 hover:text-red-500 transition-colors">
                <IconTrash size={14} />
              </button>
            )}
          </div>
        ) : isViewingSelf ? (
          <button
            onClick={() => cvInputRef.current?.click()}
            disabled={isUploadingCv}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 text-sm rounded-lg hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
          >
            <IconUpload size={14} /> {isUploadingCv ? 'Envoi...' : 'Importer un CV (PDF)'}
          </button>
        ) : (
          <p className="text-sm text-zinc-400 italic">Aucun CV renseigné.</p>
        )}
        {isViewingSelf && (
          <input ref={cvInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleCvChange} />
        )}
      </SectionCard>
    </div>
  );
}
