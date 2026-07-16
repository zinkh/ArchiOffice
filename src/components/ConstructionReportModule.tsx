import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Project, SiteReport, SiteReportNote, ProjectLot } from '../types';
import { autoSaveDocument } from '../lib/autoSaveDocument';
import { 
  IconPlus, 
  IconHome, 
  IconNotes, 
  IconChartBar, 
  IconFileExport, 
  IconMail, 
  IconCloud, 
  IconTemperature, 
  IconUsers,
  IconCalendar,
  IconTrash,
  IconCheck,
  IconAlertTriangle,
  IconClock,
  IconChevronRight,
  IconChevronLeft,
  IconPrinter
} from '@tabler/icons-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { PillTabs } from './ui/PillTabs';
import { cn } from '../lib/utils';

interface ConstructionReportModuleProps {
  project: Project;
  lots_list: ProjectLot[];
}

type TabType = 'garde' | 'remarques' | 'stats' | 'pdf' | 'mail';

export default function ConstructionReportModule({ project, lots_list }: ConstructionReportModuleProps) {
  const [activeTab, setActiveTab] = useState<TabType>('garde');
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [notes, setNotes] = useState<SiteReportNote[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newReportDate, setNewReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [fetchedWeather, setFetchedWeather] = useState<{ meteo: string; temperature: number | null } | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const pdfTemplateRef = useRef<HTMLDivElement>(null);

  // Screen chrome — themed via the app's --tblr-* CSS variables (auto light/dark).
  // NOTE: `pdfTemplate` below is intentionally excluded from theming — it is an
  // offscreen html2canvas/jsPDF export target and must always render as a fixed
  // white/black printable document regardless of the app's current theme.
  const styles: Record<string, React.CSSProperties> = {
    container: {
      color: 'var(--tblr-text)',
      background: 'var(--tblr-bg)',
      minHeight: '100%',
    },
    topBar: {
      background: 'var(--tblr-surface)',
      borderBottom: '1px solid var(--tblr-border)',
      minHeight: '52px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      gap: '8px',
      color: 'var(--tblr-text)',
    },
    logoSection: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: 0,
      flex: '1 1 auto',
      overflow: 'hidden',
    },
    projectName: {
      fontSize: '13px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      color: 'var(--tblr-text)',
    },
    clientName: {
      color: 'var(--tblr-muted)',
      fontSize: '11px',
    },
    weekSelector: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--tblr-surface-2)',
      padding: '4px 8px',
      borderRadius: '20px',
      fontSize: '12px',
      flex: '0 1 auto',
      minWidth: 0,
      color: 'var(--tblr-text)',
    },
    btnNew: {
      background: 'var(--tblr-primary)',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      flexShrink: 0,
      whiteSpace: 'nowrap',
    },
    tabsWrapper: {
      padding: '12px 12px',
      overflowX: 'auto',
      WebkitOverflowScrolling: 'touch',
    },
    contentArea: {
      padding: '0 12px 20px 12px',
    },
    card: {
      background: 'var(--tblr-surface)',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: 'var(--tblr-shadow)',
      border: '1px solid var(--tblr-border)',
    },
    grid2: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
    },
    sectionTitle: {
      fontSize: '16px',
      fontWeight: '700',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: 'var(--tblr-text)',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px',
    },
    th: {
      textAlign: 'left',
      padding: '12px',
      borderBottom: '2px solid var(--tblr-border)',
      color: 'var(--tblr-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontSize: '11px',
    },
    td: {
      padding: '12px',
      borderBottom: '1px solid var(--tblr-border)',
      color: 'var(--tblr-text)',
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    },
    modal: {
      background: 'var(--tblr-surface)',
      color: 'var(--tblr-text)',
      padding: '24px',
      borderRadius: '8px',
      width: '400px',
      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
      border: '1px solid var(--tblr-border)',
    },
    // Offscreen PDF export template — deliberately NOT themed, see note above.
    pdfTemplate: {
      position: 'absolute',
      left: '-9999px',
      top: 0,
      width: '800px',
      background: 'white',
      padding: '40px',
      color: '#000',
    }
  };

  const selectedReport = useMemo(() => 
    reports.find(r => r.id === selectedReportId) || null
  , [reports, selectedReportId]);

  const fetchReports = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}/reports`);
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    setReports(data);
    if (data.length > 0 && !selectedReportId) {
      setSelectedReportId(data[0].id);
    }
  }, [project.id, selectedReportId]);

  const fetchNotes = useCallback(async () => {
    if (!selectedReportId) return;
    const res = await fetch(`/api/reports/${selectedReportId}/notes`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) setNotes(data);
  }, [selectedReportId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    if (isModalOpen && project.address) {
      const fetchWeather = async () => {
        setWeatherLoading(true);
        try {
          const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address ?? '')}&date=${newReportDate}`);
          if (res.ok) {
            const data = await res.json();
            setFetchedWeather(data);
          }
        } catch (err) {
          console.error("Failed to fetch weather:", err);
        } finally {
          setWeatherLoading(false);
        }
      };
      fetchWeather();
    }
  }, [isModalOpen, newReportDate, project.address]);

  const handleCreateReport = async () => {
    const report_number = reports.length + 1;
    const res = await fetch(`/api/projects/${project.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        date: newReportDate, 
        report_number,
        meteo: fetchedWeather?.meteo || 'Inconnu',
        temperature: fetchedWeather?.temperature || 0,
        effectif_total: 0
      })
    });
    const newReport = await res.json();
    setReports([newReport, ...reports]);
    setSelectedReportId(newReport.id);
    setIsModalOpen(false);
    setFetchedWeather(null);
  };

  const updateReportField = async (field: keyof SiteReport, value: any) => {
    if (!selectedReport) return;
    const updated = { ...selectedReport, [field]: value };
    setReports(reports.map(r => r.id === selectedReport.id ? updated : r));
    
    await fetch(`/api/reports/${selectedReport.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
  };

  const addNote = async () => {
    if (!selectedReportId) return;
    const res = await fetch(`/api/reports/${selectedReportId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'Général',
        text: 'Nouvelle remarque...',
        status: 'A FAIRE',
        issue_date: new Date().toISOString().split('T')[0],
        note_number: notes.length + 1
      })
    });
    const newNote = await res.json();
    setNotes([...notes, newNote]);
  };

  const updateNote = async (noteId: string, updates: Partial<SiteReportNote>) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const updated = { ...note, ...updates };
    setNotes(notes.map(n => n.id === noteId ? updated : n));
    
    await fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
  };

  const deleteNote = async (noteId: string) => {
    if (!confirm('Supprimer cette remarque ?')) return;
    setNotes(notes.filter(n => n.id !== noteId));
    await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'A FAIRE': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
      case 'EN COURS': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
      case 'LEVÉE': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
      case 'URGENT': return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300';
      default: return 'bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)]';
    }
  };

  const statsData = useMemo(() => {
    const counts: Record<string, number> = { 'A FAIRE': 0, 'EN COURS': 0, 'LEVÉE': 0, 'URGENT': 0 };
    notes.forEach(n => {
      if (counts[n.status]) counts[n.status]++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [notes]);

  const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#dc2626'];

  const generatePdf = async () => {
    if (!pdfTemplateRef.current || !selectedReport) return;
    setIsGeneratingPdf(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(pdfTemplateRef.current, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      const filename = `CR_${selectedReport.report_number}_${project.name}.pdf`;
      pdf.save(filename);
      autoSaveDocument({
        blob: pdf.output('blob'),
        filename,
        name: `CR Chantier N°${selectedReport.report_number} - ${project.name}`,
        projectId: project.id,
        phase: 'DET',
        category: 'Report',
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSendEmail = async () => {
    setIsSendingEmail(true);
    try {
      // Mock email sending
      await new Promise(resolve => setTimeout(resolve, 2000));
      alert('Email envoyé avec succès !');
    } catch (error) {
      console.error('Error sending email:', error);
      alert('Erreur lors de l\'envoi de l\'email.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* TopBar */}
      <div style={styles.topBar}>
        <div style={styles.logoSection}>
          <div style={{ background: 'var(--tblr-primary)', width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontWeight: 'bold', fontSize: '16px' }}>A</span>
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <div style={styles.projectName}>{project.name}</div>
            <div style={styles.clientName}>{project.client}</div>
          </div>
        </div>

        <div style={styles.weekSelector}>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--tblr-muted)', cursor: 'pointer', display: 'flex' }}
            onClick={() => {
              const idx = reports.findIndex(r => r.id === selectedReportId);
              if (idx < reports.length - 1) setSelectedReportId(reports[idx + 1].id);
            }}
          >
            <IconChevronLeft size={20} />
          </button>
          <div style={{ fontSize: '14px', fontWeight: '600' }}>
            CR N°{selectedReport?.report_number || '--'} — {selectedReport?.date || 'Sélectionnez un rapport'}
          </div>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--tblr-muted)', cursor: 'pointer', display: 'flex' }}
            onClick={() => {
              const idx = reports.findIndex(r => r.id === selectedReportId);
              if (idx > 0) setSelectedReportId(reports[idx - 1].id);
            }}
          >
            <IconChevronRight size={20} />
          </button>
        </div>

        <button style={styles.btnNew} onClick={() => setIsModalOpen(true)}>
          <IconPlus size={18} /> Nouveau CR
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabsWrapper}>
        <PillTabs
          activeId={activeTab}
          onChange={id => setActiveTab(id as TabType)}
          tabs={[
            { id: 'garde', label: 'Page de Garde', icon: IconHome },
            { id: 'remarques', label: 'Remarques', icon: IconNotes },
            { id: 'stats', label: 'Statistiques', icon: IconChartBar },
            { id: 'pdf', label: 'Export PDF', icon: IconFileExport },
            { id: 'mail', label: 'Envoi Mail', icon: IconMail },
          ]}
        />
      </div>

      {/* Content */}
      <div style={styles.contentArea}>
        {activeTab === 'garde' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}><IconHome size={20} /> Informations Projet</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--tblr-muted)', fontWeight: '600' }}>Opération</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.name}</div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--tblr-muted)', fontWeight: '600' }}>Maître d'Ouvrage</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.client}</div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--tblr-muted)', fontWeight: '600' }}>Adresse</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.address}</div>
                </div>
                <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--tblr-muted)', fontWeight: '600' }}>Météo</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconCloud size={18} color="var(--tblr-muted)" />
                      <input 
                        style={{ border: 'none', borderBottom: '1px solid var(--tblr-border)', padding: '4px 0', width: '100%', outline: 'none', background: 'transparent', color: 'var(--tblr-text)' }}
                        value={selectedReport?.meteo || ''}
                        onChange={e => updateReportField('meteo', e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: 'var(--tblr-muted)', fontWeight: '600' }}>Température (°C)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconTemperature size={18} color="var(--tblr-muted)" />
                      <input 
                        type="number"
                        style={{ border: 'none', borderBottom: '1px solid var(--tblr-border)', padding: '4px 0', width: '100%', outline: 'none', background: 'transparent', color: 'var(--tblr-text)' }}
                        value={selectedReport?.temperature || 0}
                        onChange={e => updateReportField('temperature', parseInt(e.target.value))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.sectionTitle}><IconUsers size={20} /> Présences</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Société / Lot</th>
                    <th style={styles.th}>Nom</th>
                    <th style={styles.th}>Présence</th>
                  </tr>
                </thead>
                <tbody>
                  {lots_list.map(lot => (
                    <tr key={lot.id}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: '600' }}>{lot.contact_name?.split(' - ')[0]}</div>
                        <div style={{ fontSize: '11px', color: 'var(--tblr-muted)' }}>{lot.lot_title}</div>
                      </td>
                      <td style={styles.td}>{lot.contact_name?.split(' - ')[1] || '-'}</td>
                      <td style={styles.td}>
                        <select style={{ padding: '4px', borderRadius: '4px', border: '1px solid var(--tblr-border)', fontSize: '12px', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}>
                          <option>Présent</option>
                          <option>Absent</option>
                          <option>Excusé</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'remarques' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={styles.sectionTitle}><IconNotes size={20} /> Liste des Remarques</div>
              <button style={styles.btnNew} onClick={addNote}>
                <IconPlus size={16} /> Ajouter une remarque
              </button>
            </div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>N°</th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Lot</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Statut</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notes.map(note => {
                  return (
                    <tr key={note.id}>
                      <td style={{ ...styles.td, fontWeight: 'bold', color: 'var(--tblr-muted)' }}>{note.note_number}</td>
                      <td style={styles.td}>{note.issue_date}</td>
                      <td style={styles.td}>
                        <select 
                          style={{ border: 'none', background: 'transparent', fontWeight: '600', color: 'var(--tblr-text)' }}
                          value={note.lot_concerne || ''}
                          onChange={e => updateNote(note.id, { lot_concerne: e.target.value })}
                        >
                          <option value="">Lot...</option>
                          {lots_list.map(l => <option key={l.id} value={l.lot_title}>{l.lot_title}</option>)}
                        </select>
                      </td>
                      <td style={styles.td}>
                        <input 
                          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', color: 'var(--tblr-text)' }}
                          value={note.text}
                          onChange={e => updateNote(note.id, { text: e.target.value })}
                        />
                      </td>
                      <td style={styles.td}>
                        <select
                          className={cn('px-2 py-1 rounded text-[11px] font-bold uppercase border-none cursor-pointer', getStatusColor(note.status))}
                          value={note.status}
                          onChange={e => updateNote(note.id, { status: e.target.value as any })}
                        >
                          <option value="A FAIRE">A FAIRE</option>
                          <option value="EN COURS">EN COURS</option>
                          <option value="LEVÉE">LEVÉE</option>
                          <option value="URGENT">URGENT</option>
                        </select>
                      </td>
                      <td style={styles.td}>
                        <button 
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tblr-danger)' }}
                          onClick={() => deleteNote(note.id)}
                        >
                          <IconTrash size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'stats' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}><IconChartBar size={20} /> Répartition par Statut</div>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statsData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {statsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div style={styles.card}>
              <div style={styles.sectionTitle}><IconChartBar size={20} /> Avancement par Lot</div>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lots_list.map(l => ({ name: l.lot_title, value: Math.floor(Math.random() * 100) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pdf' && (
          <div style={styles.card}>
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <IconFileExport size={64} color="var(--tblr-primary)" style={{ marginBottom: '20px' }} />
              <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Générer le Compte Rendu</h3>
              <p style={{ color: 'var(--tblr-muted)', marginBottom: '24px' }}>Préparez le document PDF pour diffusion aux entreprises.</p>
              <button 
                style={{ ...styles.btnNew, padding: '12px 24px', fontSize: '15px', margin: '0 auto' }}
                onClick={generatePdf}
                disabled={isGeneratingPdf}
              >
                {isGeneratingPdf ? <IconClock size={20} className="animate-spin" /> : <IconFileExport size={20} />} 
                {isGeneratingPdf ? 'Génération...' : 'Télécharger le PDF'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mail' && (
          <div style={styles.card}>
            <div style={styles.sectionTitle}><IconMail size={20} /> Envoi par Email</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Destinataires</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                  {lots_list.map(l => (
                    <label key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked />
                      {l.contact_name?.split(' - ')[0]} ({l.lot_title})
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Objet</label>
                <input
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
                  defaultValue={`CR Chantier N°${selectedReport?.report_number} - ${project.name}`}
                />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Message</label>
                <textarea
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--tblr-border)', minHeight: '150px', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
                  defaultValue={`Bonjour,\n\nVeuillez trouver ci-joint le compte rendu de chantier N°${selectedReport?.report_number} pour l'opération ${project.name}.\n\nCordialement,\nL'équipe Maîtrise d'Oeuvre`}
                />
              </div>
              <button 
                style={{ ...styles.btnNew, padding: '12px', justifyContent: 'center' }}
                onClick={handleSendEmail}
                disabled={isSendingEmail}
              >
                {isSendingEmail ? <IconClock size={20} className="animate-spin" /> : <IconMail size={20} />}
                {isSendingEmail ? 'Envoi en cours...' : 'Envoyer le CR'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden PDF Template */}
      <div ref={pdfTemplateRef} style={styles.pdfTemplate}>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0f2540', paddingBottom: '20px', marginBottom: '30px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#0f2540', margin: 0 }}>COMPTE RENDU DE CHANTIER</h1>
            <h2 style={{ fontSize: '18px', color: '#64748b', margin: '5px 0' }}>N° {selectedReport?.report_number} — {selectedReport?.date}</h2>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{project.name}</div>
            <div style={{ color: '#64748b' }}>{project.client}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
          <div>
            <h3 style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '5px', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>INFORMATIONS</h3>
            <p style={{ fontSize: '12px', margin: '5px 0' }}><strong>Adresse:</strong> {project.address}</p>
            <p style={{ fontSize: '12px', margin: '5px 0' }}><strong>Météo:</strong> {selectedReport?.meteo}</p>
            <p style={{ fontSize: '12px', margin: '5px 0' }}><strong>Température:</strong> {selectedReport?.temperature}°C</p>
          </div>
          <div>
            <h3 style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '5px', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>PROCHAINE RÉUNION</h3>
            <p style={{ fontSize: '12px', margin: '5px 0' }}><strong>Date:</strong> {selectedReport?.nextMeeting || 'À définir'}</p>
          </div>
        </div>

        <h3 style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '5px', marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>REMARQUES</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>N°</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>Lot</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>Description</th>
              <th style={{ padding: '8px', textAlign: 'left', border: '1px solid #e2e8f0' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {notes.map(note => (
              <tr key={note.id}>
                <td style={{ padding: '8px', border: '1px solid #e2e8f0', fontWeight: 'bold' }}>{note.note_number}</td>
                <td style={{ padding: '8px', border: '1px solid #e2e8f0' }}>{note.lot_concerne}</td>
                <td style={{ padding: '8px', border: '1px solid #e2e8f0' }}>{note.text}</td>
                <td style={{ padding: '8px', border: '1px solid #e2e8f0', fontWeight: 'bold' }}>{note.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Nouveau CR */}
      {isModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>Nouveau Compte Rendu</h3>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Date de la réunion</label>
              <input
                type="date"
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}
                value={newReportDate}
                onChange={e => setNewReportDate(e.target.value)}
              />
            </div>
            
            {project.address && (
              <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--tblr-surface-2)', borderRadius: '8px', border: '1px solid var(--tblr-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '600', color: 'var(--tblr-muted)', marginBottom: '8px' }}>
                  <IconCloud size={16} /> Météo automatique
                </div>
                {weatherLoading ? (
                  <div style={{ fontSize: '12px', color: 'var(--tblr-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="w-3 h-3 border-2 border-[var(--tblr-primary)] border-t-transparent rounded-full animate-spin"></div>
                    Récupération des données...
                  </div>
                ) : fetchedWeather ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '500' }}>{fetchedWeather.meteo}</span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--tblr-primary)' }}>{fetchedWeather.temperature}°C</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--tblr-danger)' }}>Impossible de récupérer la météo</div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button 
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
                onClick={() => setIsModalOpen(false)}
              >
                Annuler
              </button>
              <button style={styles.btnNew} onClick={handleCreateReport}>
                Créer le CR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
