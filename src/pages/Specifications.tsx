import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  IconPlus,
  IconDeviceFloppy,
  IconTrash,
  IconFileCode,
  IconArrowUpRight,
  IconFileTypePdf,
  IconFileTypeDoc,
  IconFileTypeXls
} from '@tabler/icons-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { Specification, SpecSection, Project } from '../types';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import MarkdownEditor from '../components/MarkdownEditor';
import { fetchJson } from '../lib/api';

export default function Specifications() {
  const { t } = useTranslation();
  const { specId } = useParams<{ specId: string }>();
  const [specs, setSpecs] = useState<Specification[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSpec, setActiveSpec] = useState<Specification | null>(null);
  const [sections, setSections] = useState<SpecSection[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isNewSpecModalOpen, setIsNewSpecModalOpen] = useState(false);
  const [newSpecTitle, setNewSpecTitle] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  useEffect(() => {
    fetchSpecs();
    fetchProjects();
  }, []);

  useEffect(() => {
    if (specId && specs.length > 0) {
      const spec = specs.find(s => s.id === specId);
      if (spec) {
        handleSelectSpec(spec);
      }
    }
  }, [specId, specs]);

  const fetchSpecs = () => {
    fetchJson('/api/specifications')
      .then(setSpecs)
      .catch(err => console.error(err));
  };

  const fetchProjects = () => {
    fetchJson('/api/projects')
      .then(setProjects)
      .catch(err => console.error(err));
  };

  const handleSelectSpec = (spec: Specification) => {
    setActiveSpec(spec);
    try {
      setSections(JSON.parse(spec.content));
    } catch (e) {
      setSections([]);
    }
  };

  const handleAddItem = (sectionId: string) => {
    setSections(prev => prev.map(section => {
      if (section.id === sectionId) {
        return {
          ...section,
          items: [
            ...section.items,
            { id: `item-${Date.now()}`, code: 'NEW', description: 'New Item', material: '-', notes: '-' }
          ]
        };
      }
      return section;
    }));
  };

  const handleAddSection = () => {
    setSections(prev => [
      ...prev,
      { id: `section-${Date.now()}`, title: 'New Section', items: [] }
    ]);
  };

  const handleSave = async () => {
    if (!activeSpec) return;
    setIsSaving(true);
    try {
      const isNew = !specs.some(s => s.id === activeSpec.id);
      const method = isNew ? 'POST' : 'PUT';
      const url = isNew ? '/api/specifications' : `/api/specifications/${activeSpec.id}`;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...activeSpec,
          content: JSON.stringify(sections)
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (isNew) {
          setSpecs(prev => [{ ...activeSpec, last_updated: data.last_updated }, ...prev]);
        } else {
          setSpecs(prev => prev.map(s => s.id === activeSpec.id ? { ...activeSpec, last_updated: data.last_updated } : s));
        }
        setActiveSpec(prev => prev ? { ...prev, last_updated: data.last_updated } : null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!activeSpec || !confirm('Are you sure you want to delete this specification?')) return;
    try {
      const res = await fetch(`/api/specifications/${activeSpec.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSpecs(prev => prev.filter(s => s.id !== activeSpec.id));
        setActiveSpec(null);
        setSections([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleNewSpec = async () => {
    if (!newSpecTitle || !selectedProjectId) return;

    const template = specs.find(s => s.id === selectedTemplateId);

    const newSpec: Specification = {
      id: `spec-${Date.now()}`,
      project_id: selectedProjectId,
      title: newSpecTitle,
      content: template ? template.content : JSON.stringify([{ id: 's1', title: 'General Provisions', items: [] }]),
      last_updated: new Date().toISOString()
    };

    try {
      const res = await fetch('/api/specifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSpec)
      });

      if (res.ok) {
        const data = await res.json();
        const savedSpec = { ...newSpec, last_updated: data.last_updated };
        setSpecs(prev => [savedSpec, ...prev]);
        handleSelectSpec(savedSpec);
        setIsNewSpecModalOpen(false);
        setNewSpecTitle('');
        setSelectedProjectId('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const exportToPDF = async () => {
    if (!activeSpec) return;
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const project = projects.find(p => p.id === activeSpec.project_id);

    let y = 20;
    doc.setFontSize(22);
    doc.text(activeSpec.title, 20, y);
    y += 10;

    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Project: ${project?.name || 'Unknown'}`, 20, y);
    y += 7;
    doc.text(`Date: ${new Date(activeSpec.last_updated).toLocaleDateString()}`, 20, y);
    y += 15;

    doc.setTextColor(0);
    sections.forEach((section, sIdx) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`${sIdx + 1}. ${section.title}`, 20, y);
      y += 10;

      section.items.forEach((item) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${item.code}: ${item.description}`, 25, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(`Material: ${item.material}`, 30, y);
        y += 5;
        if (item.notes) {
          doc.text(`Notes: ${item.notes}`, 30, y);
          y += 7;
        } else {
          y += 2;
        }
      });
      y += 5;
    });

    doc.save(`${activeSpec.title}.pdf`);
  };

  const exportToDOCX = () => {
    if (!activeSpec) return;
    const data = {
      projet: { nom: projects.find(p => p.id === activeSpec.project_id)?.name || 'Unknown' },
      lots: [{ numero: '1', intitule: activeSpec.title, ouvrages: sections.flatMap(s => s.items.map(i => ({ designation: i.description, quantite: 0, unite: '-', prix_unitaire: 0, total_ht: 0 }))) }]
    };
    import('../services/documentService').then(service => service.generateWordDoc(data));
  };

  const exportToExcel = () => {
    if (!activeSpec) return;
    const data = {
      projet: { nom: projects.find(p => p.id === activeSpec.project_id)?.name || 'Unknown' },
      lots: [{ numero: '1', intitule: activeSpec.title, ouvrages: sections.flatMap(s => s.items.map(i => ({ designation: i.description, quantite: 0, unite: '-', prix_unitaire: 0, total_ht: 0 }))) }]
    };
    import('../services/documentService').then(service => service.generateExcelDoc(data));
  };

  return (
    <div className="h-full min-h-[calc(100vh-160px)] flex flex-col md:flex-row gap-4 max-w-7xl mx-auto">
      <div className="w-full md:w-80 flex flex-col gap-4 shrink-0">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('specifications')}</h2>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('spec_library')}</p>
        </header>

        <div
          className="flex-1 rounded-lg p-2 overflow-y-auto"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
        >
          <div className="space-y-1">
            {specs.map((spec) => {
              const project = projects.find(p => p.id === spec.project_id);
              const isActive = activeSpec?.id === spec.id;
              return (
                <button
                  key={spec.id}
                  onClick={() => handleSelectSpec(spec)}
                  className="w-full text-left px-4 py-3 rounded-lg transition-all flex items-center justify-between group"
                  style={isActive
                    ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }
                    : { color: 'var(--tblr-muted)' }
                  }
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <IconFileCode
                      className="w-4 h-4 shrink-0"
                      style={{ color: isActive ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}
                    />
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium truncate">{spec.title}</p>
                      <p className="text-[10px] opacity-60 truncate">{project?.name || 'Unknown Project'}</p>
                    </div>
                  </div>
                  <IconArrowUpRight className={cn("w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0", isActive && "opacity-100")} />
                </button>
              );
            })}
            <button
              onClick={() => setIsNewSpecModalOpen(true)}
              className="w-full py-2 rounded-lg text-xs font-medium hover:border-blue-300 transition-all uppercase tracking-wide mt-2 flex items-center justify-center gap-2"
              style={{ border: '1px dashed var(--tblr-border)', color: 'var(--tblr-muted)' }}
            >
              <IconPlus size={14} />
              {t('add_project')}
            </button>
          </div>
        </div>
      </div>

      <div
        className="flex-1 rounded-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        {activeSpec ? (
          <>
            <div
              className="p-6 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <input
                    className="text-xl font-bold tracking-tight bg-transparent border-none outline-none focus:ring-0 p-0"
                    style={{ color: 'var(--tblr-text)' }}
                    value={activeSpec.title || ''}
                    onChange={e => setActiveSpec({ ...activeSpec, title: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="is_template"
                    checked={activeSpec.is_template || false}
                    onChange={e => setActiveSpec({ ...activeSpec, is_template: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                    style={{ borderColor: 'var(--tblr-border)' }}
                  />
                  <label htmlFor="is_template" className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('specs_save_as_template')}</label>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>
                  {t('revision_date')}: {new Date(activeSpec.last_updated).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center rounded-lg p-1 mr-2"
                  style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
                >
                  <button
                    onClick={exportToPDF}
                    className="p-1.5 rounded-md transition-all hover:text-red-500"
                    style={{ color: 'var(--tblr-muted)' }}
                    title="Export PDF"
                  >
                    <IconFileTypePdf size={18} />
                  </button>
                  <button
                    onClick={exportToDOCX}
                    className="p-1.5 rounded-md transition-all hover:text-blue-500"
                    style={{ color: 'var(--tblr-muted)' }}
                    title="Export DOCX"
                  >
                    <IconFileTypeDoc size={18} />
                  </button>
                  <button
                    onClick={exportToExcel}
                    className="p-1.5 rounded-md transition-all hover:text-green-500"
                    style={{ color: 'var(--tblr-muted)' }}
                    title="Export XLSX"
                  >
                    <IconFileTypeXls size={18} />
                  </button>
                </div>
                <button
                  onClick={handleDelete}
                  className="p-2 transition-colors hover:text-red-500"
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  <IconTrash size={20} />
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <IconDeviceFloppy size={18} />
                  )}
                  {t('commit_changes')}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-12">
              {sections.map((section, sIdx) => (
                <div key={section.id} className="space-y-6">
                  <div className="flex items-center gap-4 pb-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--tblr-primary)' }}>0{sIdx + 1}</span>
                    <input
                      type="text"
                      value={section.title || ''}
                      onChange={e => {
                        const newTitle = e.target.value;
                        setSections(prev => prev.map(s => s.id === section.id ? { ...s, title: newTitle } : s));
                      }}
                      className="text-lg font-bold bg-transparent border-none outline-none focus:ring-0 w-full tracking-tight"
                      style={{ color: 'var(--tblr-text)' }}
                      placeholder={t('section_title')}
                    />
                  </div>
                  <div className="space-y-3">
                    {section.items.map((item, iIdx) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-12 gap-4 p-4 rounded-lg group transition-colors hover:border-blue-200"
                        style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}
                      >
                        <div className="col-span-2">
                          <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('code')}</label>
                          <input className="w-full bg-transparent border-none outline-none text-sm font-mono" style={{ color: 'var(--tblr-primary)' }} value={item.code || ''} readOnly />
                        </div>
                        <div className="col-span-4">
                          <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('description')}</label>
                          <MarkdownEditor
                            value={item.description || ''}
                            onChange={value => {
                              setSections(prev => prev.map(s => s.id === section.id ? { ...s, items: s.items.map(it => it.id === item.id ? { ...it, description: value } : it) } : s));
                            }}
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('material')}</label>
                          <input className="w-full bg-transparent border-none outline-none text-sm" style={{ color: 'var(--tblr-text)' }} value={item.material || ''} onChange={e => {
                              const val = e.target.value;
                              setSections(prev => prev.map(s => s.id === section.id ? { ...s, items: s.items.map(it => it.id === item.id ? { ...it, material: val } : it) } : s));
                          }} />
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('notes')}</label>
                          <MarkdownEditor
                            value={item.notes || ''}
                            onChange={value => {
                              setSections(prev => prev.map(s => s.id === section.id ? { ...s, items: s.items.map(it => it.id === item.id ? { ...it, notes: value } : it) } : s));
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => handleAddItem(section.id)}
                      className="w-full py-2 rounded-lg text-xs font-medium transition-all uppercase tracking-wide flex items-center justify-center gap-2 hover:border-blue-300"
                      style={{ border: '1px dashed var(--tblr-border)', color: 'var(--tblr-muted)' }}
                    >
                      <IconPlus size={14} />
                      {t('add_item')}
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={handleAddSection}
                className="w-full py-4 rounded-lg font-medium text-sm uppercase tracking-wide flex items-center justify-center gap-2 hover:border-blue-200 transition-all"
                style={{ border: '2px dashed var(--tblr-border)', color: 'var(--tblr-muted)' }}
              >
                <IconPlus size={18} />
                {t('init_section')}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-6" style={{ color: 'var(--tblr-muted)' }}>
            <div className="w-20 h-20 rounded-lg flex items-center justify-center" style={{ background: 'var(--tblr-surface-2)' }}>
              <IconFileCode size={40} className="opacity-20" />
            </div>
            <p className="text-sm font-medium uppercase tracking-widest">{t('select_spec')}</p>
          </div>
        )}
      </div>
      <AnimatePresence>
        {isNewSpecModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-lg shadow-xl w-full max-w-md overflow-hidden"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
            >
              <div
                className="p-6 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--tblr-border)' }}
              >
                <h3 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{t('specs_new_title')}</h3>
                <button
                  onClick={() => setIsNewSpecModalOpen(false)}
                  style={{ color: 'var(--tblr-muted)' }}
                >
                  <IconArrowUpRight className="rotate-45" size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('specs_template_optional')}</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    onChange={e => setSelectedTemplateId(e.target.value)}
                  >
                    <option value="">{t('specs_select_template')}</option>
                    {specs.filter(s => s.is_template).map(s => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('specs_title_label')}</label>
                  <input
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    placeholder={t('specs_title_example')}
                    value={newSpecTitle}
                    onChange={e => setNewSpecTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('specs_project_label')}</label>
                  <select
                    className="w-full px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20"
                    style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                  >
                    <option value="">{t('specs_select_project')}</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div
                className="p-6 flex gap-3"
                style={{ background: 'var(--tblr-surface-2)' }}
              >
                <button
                  onClick={() => setIsNewSpecModalOpen(false)}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  {t('btn_cancel')}
                </button>
                <button
                  onClick={handleNewSpec}
                  disabled={!newSpecTitle || !selectedProjectId}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                  style={{ background: 'var(--tblr-primary)', color: '#fff' }}
                >
                  {t('btn_create')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
