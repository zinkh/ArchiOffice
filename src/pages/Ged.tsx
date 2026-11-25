import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconStar, IconStarFilled, IconSearch, IconUpload, IconFolder, IconFolderOpen, IconClock, IconInbox,
  IconLayoutList, IconLayoutGrid, IconTable, IconExternalLink, IconChevronRight, IconChevronDown, IconX, IconFile,
} from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';
import { openSignedUrl } from '../lib/signedStorageUrl';
import { useUser } from '../UserContext';
import type { Document, DocumentVersion, Project } from '../types';
import {
  GED_ALL, NO_FILTERS, NO_PROJECT, countBy, extensionOf, filterDocs, highlightParts, phaseOf, recentIds, sortDocs,
  statutOf, type GedFilters, type GedNav, type GedSort, type GedSortKey,
} from '../lib/gedView';

const PHASES = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR', 'Général'];
const DOC_TYPES = ['Plan', 'Note technique', 'CCTP', 'DPGF', 'BPU', 'DQE', 'Rapport', 'Contrat', 'OS', 'CR réunion', 'Devis', 'Autre'];
const STATUTS: Record<string, { label: string; color: string }> = {
  en_cours: { label: 'En cours', color: 'var(--tblr-primary)' },
  approuve: { label: 'Approuvé', color: 'var(--tblr-success, #2f9e44)' },
  perime: { label: 'Périmé', color: 'var(--tblr-danger, #d63939)' },
};
const EXT_CHIPS: [string, string][] = [['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel'], ['dwg', 'DWG'], ['jpg', 'Image']];
const EXT_COLOR: Record<string, string> = { pdf: '#d1453b', docx: '#2b5db8', doc: '#2b5db8', xlsx: '#1f8a4c', xls: '#1f8a4c', dwg: '#c98a12', dxf: '#c98a12' };
const FAV_KEY = 'ged:favs';
type View = 'list' | 'details' | 'grid';

const readFavs = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
};
const fmtDate = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '-' : new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

function Highlight({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((p, i) => p.hit
    ? <mark key={i} className="rounded-sm px-0.5" style={{ background: '#fff1a8', color: 'inherit' }}>{p.text}</mark>
    : <span key={i}>{p.text}</span>)}</>;
}

function FileIcon({ name, size = 26 }: { name: string; size?: number }) {
  const ext = extensionOf(name);
  return (
    <span className="grid place-items-center rounded text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36, background: EXT_COLOR[ext] || 'var(--tblr-muted)' }} aria-hidden="true">
      {ext ? ext.slice(0, 3).toUpperCase() : <IconFile size={size * 0.6} />}
    </span>
  );
}

function StatutDot({ statut }: { statut: string }) {
  const s = STATUTS[statut] || STATUTS.en_cours;
  return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}</span>;
}

function NavButton({ active, onClick, icon, children, count, indent = 0 }: {
  active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode; count?: number; indent?: number;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined}
      className="w-full flex items-center gap-2 text-left rounded-lg py-1.5 pr-2 text-sm min-h-9 transition-colors hover:bg-[var(--tblr-surface-2)]"
      style={{ paddingLeft: 8 + indent * 16, ...(active ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', fontWeight: 600 } : { color: 'var(--tblr-text)' }) }}>
      {icon}<span className="truncate">{children}</span>
      {count !== undefined && <span className="ml-auto text-xs" style={{ color: 'var(--tblr-muted)' }}>{count}</span>}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-3 pb-1 uppercase tracking-wider text-[0.6875rem] font-bold" style={{ color: 'var(--tblr-muted)' }}>{children}</div>;
}

export default function Ged() {
  const { currentUser } = useUser();
  const [docs, setDocs] = useState<Document[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nav, setNav] = useState<GedNav>(GED_ALL);
  const [filters, setFilters] = useState<GedFilters>(NO_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [view, setView] = useState<View>('list');
  const [sort, setSort] = useState<GedSort>({ key: 'date', dir: 'desc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'props' | 'versions' | 'activity'>('props');
  const [favs, setFavs] = useState<Set<string>>(readFavs);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [versions, setVersions] = useState<DocumentVersion[] | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const data = await apiFetch<Document[]>('/api/documents');
    setDocs(Array.isArray(data) ? data : []);
  };
  useEffect(() => {
    let current = true;
    Promise.all([
      apiFetch<Document[]>('/api/documents'),
      apiFetch<Project[]>('/api/projects').catch(() => [] as Project[]),
    ]).then(([d, p]) => { if (!current) return; setDocs(Array.isArray(d) ? d : []); setProjects(Array.isArray(p) ? p : []); })
      .catch(() => { if (current) setError('Les documents sont indisponibles pour le moment.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const projectName = useMemo(() => {
    const byId = new Map(projects.map(p => [p.id, p.name]));
    return (id?: string | null) => (id ? byId.get(id) || '' : '');
  }, [projects]);

  const recent = useMemo(() => recentIds(docs), [docs]);
  const visible = useMemo(() => sortDocs(
    filterDocs(docs, nav, filters, { favs, recent, projectName }), sort, projectName),
  [docs, nav, filters, favs, recent, projectName, sort]);
  const selected = docs.find(d => d.id === selectedId) || null;

  useEffect(() => {
    setVersions(null);
    if (!selected || tab !== 'versions') return;
    let current = true;
    apiFetch<DocumentVersion[]>(`/api/documents/${selected.id}/versions`)
      .then(v => { if (current) setVersions(Array.isArray(v) ? v : []); })
      .catch(() => { if (current) setVersions([]); });
    return () => { current = false; };
  }, [selected?.id, tab]);

  const toggleFav = (id: string) => setFavs(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* préférence locale seulement */ }
    return next;
  });
  const toggleExpanded = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const flash = (ok: boolean, text: string) => { setNotice({ ok, text }); setTimeout(() => setNotice(null), 5000); };

  // Classement d'un document : affaire et phase. Le fichier ne bouge pas, mise à jour optimiste.
  const classify = async (doc: Document, projectId: string, phase: string) => {
    const previous = docs;
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, project_id: projectId as any, phase: phase as any } : d));
    try {
      await apiFetch(`/api/documents/${doc.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: doc.name, category: doc.category, description: doc.description || '',
          emetteur: doc.emetteur || '', doc_type: doc.doc_type || '', phase, project_id: projectId,
        }),
      });
      flash(true, 'Document classé.');
      void refresh();
    } catch { setDocs(previous); flash(false, 'Le classement a échoué.'); }
  };

  // Import : le dossier ouvert dans la navigation (affaire, phase) devient la destination.
  const importFiles = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const projectId = nav.kind === 'project' && nav.project !== NO_PROJECT ? nav.project || '' : '';
    const phase = nav.kind === 'project' && nav.value ? nav.value : 'Général';
    setUploading(true);
    let failed = 0;
    try {
      const token = await getAccessToken();
      for (const file of list) {
        const form = new FormData();
        form.append('file', file); form.append('name', file.name); form.append('category', 'Other');
        form.append('phase', phase); form.append('description', ''); form.append('uploaded_by', currentUser?.name || 'Unknown');
        form.append('indice', 'A'); form.append('emetteur', ''); form.append('doc_type', '');
        if (projectId) form.append('project_id', projectId);
        try {
          const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
          if (!res.ok) failed++;
        } catch { failed++; }
      }
    } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
    await refresh();
    const s = (n: number) => (n > 1 ? 's' : '');
    flash(failed === 0, failed === 0
      ? `${list.length} document${s(list.length)} importé${s(list.length)}.`
      : `${failed} fichier${s(failed)} sur ${list.length} n'${failed > 1 ? 'ont' : 'a'} pas pu être importé${s(failed)}.`);
  };

  // Compteurs de la navigation.
  const byProject = useMemo(() => countBy(docs, d => d.project_id || NO_PROJECT), [docs]);
  const byPhase = useMemo(() => countBy(docs, phaseOf), [docs]);
  const byType = useMemo(() => countBy(docs, d => d.doc_type || ''), [docs]);
  const byStatut = useMemo(() => countBy(docs, statutOf), [docs]);
  const projectPhases = (projectId: string) => {
    const m = countBy(docs.filter(d => (d.project_id || NO_PROJECT) === projectId), phaseOf);
    return PHASES.filter(p => m.has(p)).map(p => [p, m.get(p)!] as const);
  };
  const navProjects = useMemo(() => projects.filter(p => byProject.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true })), [projects, byProject]);

  const isNav = (kind: GedNav['kind'], project?: string, value?: string) =>
    nav.kind === kind && (nav.project || '') === (project || '') && (nav.value || '') === (value || '');
  const go = (next: GedNav) => { setNav(next); setSelectedId(null); };

  const sortBy = (key: GedSortKey) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const headStyle = { color: 'var(--tblr-muted)', background: 'var(--tblr-surface-2)', borderBottom: '1px solid var(--tblr-border)' } as const;
  const sortHead = (k: GedSortKey, label: string) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap" style={headStyle}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1">
        {label}{sort.key === k && <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );

  const title = (() => {
    switch (nav.kind) {
      case 'all': return 'Tous les documents';
      case 'recent': return 'Récents';
      case 'fav': return 'Favoris';
      case 'toclass': return 'À classer';
      case 'phase': return `Phase ${nav.value}`;
      case 'type': return nav.value ? nav.value : 'Sans type';
      case 'statut': return STATUTS[nav.value || '']?.label || 'Statut';
      case 'project': return `${nav.project === NO_PROJECT ? 'Sans projet' : projectName(nav.project) || 'Projet'}${nav.value ? ` · ${nav.value}` : ''}`;
    }
  })();

  const surface = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' } as const;
  const control = 'rounded-lg px-2.5 py-2 text-sm min-h-9';
  const controlStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' } as const;
  const toggleExt = (ext: string) => setFilters(f => {
    const next = new Set(f.extensions);
    const group = ext === 'jpg' ? ['jpg', 'jpeg', 'png'] : [ext];
    if (group.every(e => next.has(e))) group.forEach(e => next.delete(e)); else group.forEach(e => next.add(e));
    return { ...f, extensions: next };
  });
  const muted = { color: 'var(--tblr-muted)' } as const;

  return (
    <div className="space-y-3">
      {/* Barre de commandes */}
      <div role="toolbar" aria-label="Commandes des documents" className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={surface}>
        <input ref={fileInput} type="file" multiple className="hidden" aria-label="Choisir des fichiers à importer" onChange={e => void importFiles(e.target.files)} />
        <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold min-h-9 disabled:opacity-50" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
          <IconUpload size={16} aria-hidden="true" />{uploading ? 'Import en cours…' : 'Importer'}
        </button>
        <label className="flex items-center gap-2 flex-1 min-w-[14rem] rounded-lg px-3 min-h-9" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
          <IconSearch size={16} aria-hidden="true" style={muted} />
          <input type="search" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Rechercher un document, un projet, un type…" aria-label="Recherche dans les documents"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm py-2" style={{ color: 'var(--tblr-text)' }} />
        </label>
        <Link to="/settings" className="text-xs underline" style={muted}>Réglages du partage et du lecteur</Link>
      </div>

      <div className="grid gap-3 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_21rem] items-start">
        {/* Navigation */}
        <nav aria-label="Navigation des documents" className="rounded-xl p-2 lg:sticky lg:top-2 lg:max-h-[calc(100dvh-8rem)] overflow-y-auto" style={surface}>
          <NavButton active={isNav('all')} onClick={() => go(GED_ALL)} icon={<IconFolderOpen size={16} aria-hidden="true" />} count={docs.length}>Tous les documents</NavButton>
          <NavButton active={isNav('recent')} onClick={() => go({ kind: 'recent' })} icon={<IconClock size={16} aria-hidden="true" />}>Récents</NavButton>
          <NavButton active={isNav('fav')} onClick={() => go({ kind: 'fav' })} icon={<IconStar size={16} aria-hidden="true" />} count={favs.size}>Favoris</NavButton>
          <NavButton active={isNav('toclass')} onClick={() => go({ kind: 'toclass' })} icon={<IconInbox size={16} aria-hidden="true" />} count={byProject.get(NO_PROJECT) || 0}>À classer</NavButton>

          <SectionTitle>Par projet</SectionTitle>
          {[...navProjects.map(p => ({ id: p.id, name: p.name })), ...(byProject.has(NO_PROJECT) ? [{ id: NO_PROJECT, name: 'Sans projet' }] : [])].map(p => {
            const open = expanded.has(p.id);
            return (
              <div key={p.id}>
                <div className="flex items-center">
                  <button type="button" onClick={() => toggleExpanded(p.id)} aria-expanded={open} aria-label={`${open ? 'Replier' : 'Déplier'} ${p.name}`}
                    className="p-1.5 rounded hover:bg-[var(--tblr-surface-2)]" style={muted}>
                    {open ? <IconChevronDown size={14} aria-hidden="true" /> : <IconChevronRight size={14} aria-hidden="true" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <NavButton active={isNav('project', p.id)} onClick={() => { go({ kind: 'project', project: p.id }); if (!open) toggleExpanded(p.id); }}
                      icon={<IconFolder size={16} aria-hidden="true" />} count={byProject.get(p.id)}>{p.name}</NavButton>
                  </div>
                </div>
                {open && projectPhases(p.id).map(([phase, n]) => (
                  <NavButton key={phase} indent={2} active={isNav('project', p.id, phase)} onClick={() => go({ kind: 'project', project: p.id, value: phase })} count={n}>{phase}</NavButton>
                ))}
              </div>
            );
          })}

          <SectionTitle>Par phase</SectionTitle>
          {PHASES.filter(p => byPhase.has(p)).map(p => (
            <NavButton key={p} active={isNav('phase', undefined, p)} onClick={() => go({ kind: 'phase', value: p })} count={byPhase.get(p)}>{p}</NavButton>
          ))}
          <SectionTitle>Par type</SectionTitle>
          {[...byType.keys()].sort((a, b) => a.localeCompare(b, 'fr')).map(t => (
            <NavButton key={t || 'none'} active={isNav('type', undefined, t)} onClick={() => go({ kind: 'type', value: t })} count={byType.get(t)}>{t || 'Sans type'}</NavButton>
          ))}
          <SectionTitle>Statut qualité</SectionTitle>
          {Object.entries(STATUTS).map(([key, s]) => (
            <NavButton key={key} active={isNav('statut', undefined, key)} onClick={() => go({ kind: 'statut', value: key })} count={byStatut.get(key) || 0}
              icon={<span className="w-2 h-2 rounded-full ml-1" style={{ background: s.color }} aria-hidden="true" />}>{s.label}</NavButton>
          ))}
        </nav>

        {/* Liste */}
        <section aria-label="Liste des documents" className="rounded-xl min-w-0" style={surface}>
          <div className="px-4 pt-3 pb-1">
            <h1 className="text-lg font-semibold" style={{ color: 'var(--tblr-text)' }}>{title}</h1>
            <p className="text-xs" role="status" style={muted}>
              {visible.length} document{visible.length > 1 ? 's' : ''}{filters.search.trim() ? ` pour « ${filters.search.trim()} »` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2">
            <select aria-label="Phase" className={control} style={controlStyle} value={filters.phase} onChange={e => setFilters(f => ({ ...f, phase: e.target.value }))}>
              <option value="">Phase : toutes</option>{PHASES.map(p => <option key={p}>{p}</option>)}
            </select>
            <select aria-label="Type" className={control} style={controlStyle} value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
              <option value="">Type : tous</option>{DOC_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select aria-label="Statut" className={control} style={controlStyle} value={filters.statut} onChange={e => setFilters(f => ({ ...f, statut: e.target.value }))}>
              <option value="">Statut : tous</option>{Object.entries(STATUTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(v => !v)} className={control} style={controlStyle}>Filtres avancés</button>
            <div role="group" aria-label="Affichage" className="ml-auto inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--tblr-border)' }}>
              {([['list', 'Liste', IconLayoutList], ['details', 'Détails', IconTable], ['grid', 'Vignettes', IconLayoutGrid]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" aria-label={label} aria-pressed={view === v} title={label} onClick={() => setView(v)}
                  className="px-3 min-h-9" style={view === v ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' } : { background: 'var(--tblr-surface)', color: 'var(--tblr-muted)' }}>
                  <Icon size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          {showAdvanced && (
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              <span className="text-xs" style={muted}>Extension :</span>
              {EXT_CHIPS.map(([ext, label]) => {
                const on = filters.extensions.has(ext);
                return <button key={ext} type="button" aria-pressed={on} onClick={() => toggleExt(ext)} className="rounded-full px-3 py-1 text-xs"
                  style={on ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' } : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>{label}</button>;
              })}
              <button type="button" className="text-xs underline" style={muted} onClick={() => setFilters(NO_FILTERS)}>Réinitialiser</button>
            </div>
          )}
          {notice && <p role="status" className="px-4 pb-2 text-xs font-medium" style={{ color: notice.ok ? 'var(--tblr-success, #2f9e44)' : 'var(--tblr-danger)' }}>{notice.text}</p>}
          {error && <p role="alert" className="px-4 pb-2 text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
          {loading && <p className="px-4 pb-4 text-sm" style={muted}>Chargement des documents…</p>}
          {!loading && !error && visible.length === 0 && (
            <p className="px-4 pb-6 text-sm" style={muted}>Aucun document ne correspond à ces critères.</p>
          )}

          {visible.length > 0 && view !== 'grid' && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead><tr>
                  {sortHead('name', 'Document')}
                  {view === 'details' && sortHead('project', 'Projet')}
                  {sortHead('phase', 'Phase')}{sortHead('type', 'Type')}
                  {view === 'details' && sortHead('indice', 'Indice')}
                  {sortHead('date', 'Déposé le')}
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold" style={headStyle}>Statut</th>
                </tr></thead>
                <tbody>
                  {visible.map(d => (
                    <tr key={d.id} tabIndex={0} aria-selected={d.id === selectedId} onClick={() => setSelectedId(d.id)}
                      onKeyDown={e => { if (e.key === 'Enter') setSelectedId(d.id); }}
                      className="cursor-pointer hover:bg-[var(--tblr-surface-2)]"
                      style={{ borderBottom: '1px solid var(--tblr-border)', ...(d.id === selectedId ? { background: 'var(--tblr-primary-lt)' } : {}) }}>
                      <td className="px-3 py-2"><span className="flex items-center gap-2.5 font-semibold min-w-0">
                        <FileIcon name={d.name} /><span className="truncate max-w-[22rem]"><Highlight text={d.name} query={filters.search} /></span>
                        {favs.has(d.id) && <IconStarFilled size={13} aria-label="Favori" style={{ color: '#f2b93b' }} />}
                      </span></td>
                      {view === 'details' && <td className="px-3 py-2 whitespace-nowrap">{projectName(d.project_id) || 'Sans projet'}</td>}
                      <td className="px-3 py-2">{phaseOf(d)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{d.doc_type || '-'}</td>
                      {view === 'details' && <td className="px-3 py-2">{d.indice || '-'}</td>}
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(d.uploaded_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap"><StatutDot statut={statutOf(d)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {visible.length > 0 && view === 'grid' && (
            <div className="grid gap-3 p-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))' }}>
              {visible.map(d => (
                <button key={d.id} type="button" onClick={() => setSelectedId(d.id)} aria-pressed={d.id === selectedId}
                  className="text-left rounded-lg p-3 flex flex-col gap-2 min-w-0"
                  style={{ border: `1px solid ${d.id === selectedId ? 'var(--tblr-primary)' : 'var(--tblr-border)'}`, background: d.id === selectedId ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface)' }}>
                  <span className="grid place-items-center h-16 rounded-md" style={{ background: 'var(--tblr-surface-2)' }}><FileIcon name={d.name} size={34} /></span>
                  <span className="font-semibold text-sm break-words"><Highlight text={d.name} query={filters.search} /></span>
                  <span className="text-xs" style={muted}>{projectName(d.project_id) || 'Sans projet'} · {phaseOf(d)}{d.indice ? ` · ind. ${d.indice}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Détail */}
        <aside aria-label="Détail du document" className="rounded-xl p-4 space-y-3 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-2" style={surface}>
          {!selected ? (
            <p className="text-sm" style={muted}>Sélectionnez un document pour voir ses propriétés, ses versions et son activité.</p>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                <FileIcon name={selected.name} size={32} />
                <h2 className="flex-1 min-w-0 font-semibold break-words" style={{ color: 'var(--tblr-text)' }}>{selected.name}</h2>
                <button type="button" aria-label={favs.has(selected.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={() => toggleFav(selected.id)} className="p-1.5 rounded min-h-9 min-w-9 grid place-items-center">
                  {favs.has(selected.id) ? <IconStarFilled size={18} style={{ color: '#f2b93b' }} /> : <IconStar size={18} style={muted} />}
                </button>
                <button type="button" aria-label="Fermer le détail" onClick={() => setSelectedId(null)} className="p-1.5 rounded min-h-9 min-w-9 grid place-items-center"><IconX size={16} style={muted} /></button>
              </div>
              <div role="tablist" aria-label="Détail" className="flex gap-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                {([['props', 'Propriétés'], ['versions', 'Versions'], ['activity', 'Activité']] as const).map(([k, label]) => (
                  <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className="py-2 text-sm"
                    style={tab === k ? { color: 'var(--tblr-primary)', fontWeight: 600, borderBottom: '2px solid var(--tblr-primary)' } : { color: 'var(--tblr-muted)', borderBottom: '2px solid transparent' }}>{label}</button>
                ))}
              </div>

              {tab === 'props' && (
                <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt style={muted}>Projet</dt>
                  <dd><select aria-label="Projet" className={`${control} w-full`} style={controlStyle} value={selected.project_id || ''} onChange={e => void classify(selected, e.target.value, phaseOf(selected))}>
                    <option value="">Sans projet</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></dd>
                  <dt style={muted}>Phase</dt>
                  <dd><select aria-label="Phase du document" className={`${control} w-full`} style={controlStyle} value={phaseOf(selected)} onChange={e => void classify(selected, selected.project_id || '', e.target.value)}>
                    {PHASES.map(p => <option key={p}>{p}</option>)}</select></dd>
                  <dt style={muted}>Type</dt><dd>{selected.doc_type || '-'}</dd>
                  <dt style={muted}>Indice</dt><dd>{selected.indice || '-'}</dd>
                  <dt style={muted}>Version</dt><dd>{selected.version ?? 1}</dd>
                  <dt style={muted}>Statut</dt><dd><StatutDot statut={statutOf(selected)} /></dd>
                  <dt style={muted}>Émetteur</dt><dd>{selected.emetteur || '-'}</dd>
                  <dt style={muted}>Déposé</dt><dd>{fmtDate(selected.uploaded_at)}<br /><span className="text-xs" style={muted}>{selected.uploaded_by}</span></dd>
                  {selected.description && <><dt style={muted}>Description</dt><dd className="break-words">{selected.description}</dd></>}
                </dl>
              )}
              {tab === 'versions' && (
                versions === null ? <p className="text-sm" style={muted}>Chargement…</p>
                  : versions.length === 0 ? <p className="text-sm" style={muted}>Aucune version antérieure enregistrée.</p>
                    : <ul className="space-y-2 text-sm">{[...versions].sort((a, b) => b.version - a.version).map(v => (
                      <li key={v.id} className="flex items-center justify-between gap-2">
                        <span>Version {v.version}{v.version === selected.version ? ' (courante)' : ''}<br /><span className="text-xs" style={muted}>{v.uploaded_by} · {fmtDate(v.uploaded_at)}</span></span>
                        <button type="button" className="text-xs underline" onClick={() => void openSignedUrl(v.file_url)}>Ouvrir</button>
                      </li>))}</ul>
              )}
              {tab === 'activity' && (
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between gap-2"><span>Déposé par {selected.uploaded_by}</span><span className="text-xs" style={muted}>{fmtDate(selected.uploaded_at)}</span></li>
                  {selected.date_approbation && <li className="flex justify-between gap-2"><span>Approuvé par {selected.approbateur || '-'}</span><span className="text-xs" style={muted}>{fmtDate(selected.date_approbation)}</span></li>}
                  {selected.validation_status && <li>Validation : {selected.validation_status}</li>}
                </ul>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <button type="button" onClick={() => void openSignedUrl(selected.file_url)} className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold min-h-9" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
                  <IconExternalLink size={16} aria-hidden="true" />Ouvrir le document
                </button>
                {selected.project_id && (
                  <Link to={`/projects/${selected.project_id}?tab=DOCS`} className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm min-h-9" style={controlStyle}>
                    Voir dans le projet
                  </Link>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
