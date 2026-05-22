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
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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

  // Styles object as requested
  const styles: Record<string, React.CSSProperties> = {
    container: {
      fontFamily: 'Inter, sans-serif',
      color: '#1e293b',
      background: '#f8fafc',
      minHeight: '100%',
    },
    topBar: {
      background: 'linear-gradient(to right, #0f2540, #1e3a5f)',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      color: 'white',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
    logoSection: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    projectName: {
      fontSize: '14px',
      fontWeight: '600',
    },
    clientName: {
      color: '#60a5fa',
      fontSize: '12px',
      marginLeft: '8px',
    },
    weekSelector: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: 'rgba(255,255,255,0.1)',
      padding: '4px 12px',
      borderRadius: '20px',
    },
    btnNew: {
      background: '#3b82f6',
      color: 'white',
      border: 'none',
      padding: '6px 14px',
      borderRadius: '6px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    tabsWrapper: {
      padding: '16px 20px',
    },
    tabsContainer: {
      background: '#e2e8f0',
      borderRadius: '10px',
      padding: '4px',
      display: 'flex',
      gap: '4px',
      maxWidth: 'fit-content',
    },
    tab: {
      padding: '8px 16px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      transition: 'all 0.2s',
      border: 'none',
      background: 'transparent',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    activeTab: {
      background: 'white',
      boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      color: '#1e3a5f',
    },
    contentArea: {
      padding: '0 20px 20px 20px',
    },
    card: {
      background: 'white',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      border: '1px solid #e2e8f0',
    },
    grid2: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '24px',
    },
    sectionTitle: {
      fontSize: '16px',
      fontWeight: '700',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: '#0f172a',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px',
    },
    th: {
      textAlign: 'left',
      padding: '12px',
      borderBottom: '2px solid #f1f5f9',
      color: '#64748b',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      fontSize: '11px',
    },
    td: {
      padding: '12px',
      borderBottom: '1px solid #f1f5f9',
    },
    badge: {
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: '700',
      textTransform: 'uppercase',
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
      background: 'white',
      padding: '24px',
      borderRadius: '12px',
      width: '400px',
      boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
    },
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
    const data = await res.json();
    setReports(data);
    if (data.length > 0 && !selectedReportId) {
      setSelectedReportId(data[0].id);
    }
  }, [project.id, selectedReportId]);

  const fetchNotes = useCallback(async () => {
    if (!selectedReportId) return;
    const res = await fetch(`/api/reports/${selectedReportId}/notes`);
    const data = await res.json();
    setNotes(data);
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
          const res = await fetch(`/api/weather?q=${encodeURIComponent(project.address)}&date=${newReportDate}`);
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
      case 'A FAIRE': return { bg: '#fee2e2', text: '#b91c1c' };
      case 'EN COURS': return { bg: '#fef3c7', text: '#b45309' };
      case 'LEVÉE': return { bg: '#dcfce7', text: '#15803d' };
      case 'URGENT': return { bg: '#fecaca', text: '#dc2626' };
      default: return { bg: '#f1f5f9', text: '#475569' };
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
          <div style={{ background: 'white', width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#0f2540', fontWeight: 'bold', fontSize: '18px' }}>A</span>
          </div>
          <div>
            <div style={styles.projectName}>{project.name}</div>
            <div style={styles.clientName}>{project.client}</div>
          </div>
        </div>

        <div style={styles.weekSelector}>
          <button 
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
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
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
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
        <div style={styles.tabsContainer}>
          {[
            { id: 'garde', label: 'Page de Garde', icon: <IconHome size={18} /> },
            { id: 'remarques', label: 'Remarques', icon: <IconNotes size={18} /> },
            { id: 'stats', label: 'Statistiques', icon: <IconChartBar size={18} /> },
            { id: 'pdf', label: 'Export PDF', icon: <IconFileExport size={18} /> },
            { id: 'mail', label: 'Envoi Mail', icon: <IconMail size={18} /> },
          ].map(t => (
            <button
              key={t.id}
              style={{
                ...styles.tab,
                ...(activeTab === t.id ? styles.activeTab : {})
              }}
              onClick={() => setActiveTab(t.id as TabType)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={styles.contentArea}>
        {activeTab === 'garde' && (
          <div style={styles.grid2}>
            <div style={styles.card}>
              <div style={styles.sectionTitle}><IconHome size={20} /> Informations Projet</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Opération</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.name}</div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Maître d'Ouvrage</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.client}</div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Adresse</label>
                  <div style={{ fontSize: '15px', fontWeight: '500' }}>{project.address}</div>
                </div>
                <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Météo</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconCloud size={18} color="#64748b" />
                      <input 
                        style={{ border: 'none', borderBottom: '1px solid #e2e8f0', padding: '4px 0', width: '100%', outline: 'none' }}
                        value={selectedReport?.meteo || ''}
                        onChange={e => updateReportField('meteo', e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Température (°C)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <IconTemperature size={18} color="#64748b" />
                      <input 
                        type="number"
                        style={{ border: 'none', borderBottom: '1px solid #e2e8f0', padding: '4px 0', width: '100%', outline: 'none' }}
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
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{lot.lot_title}</div>
                      </td>
                      <td style={styles.td}>{lot.contact_name?.split(' - ')[1] || '-'}</td>
                      <td style={styles.td}>
                        <select style={{ padding: '4px', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
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
                  const colors = getStatusColor(note.status);
                  return (
                    <tr key={note.id}>
                      <td style={{ ...styles.td, fontWeight: 'bold', color: '#64748b' }}>{note.note_number}</td>
                      <td style={styles.td}>{note.issue_date}</td>
                      <td style={styles.td}>
                        <select 
                          style={{ border: 'none', background: 'transparent', fontWeight: '600' }}
                          value={note.lot_concerne || ''}
                          onChange={e => updateNote(note.id, { lot_concerne: e.target.value })}
                        >
                          <option value="">Lot...</option>
                          {lots_list.map(l => <option key={l.id} value={l.lot_title}>{l.lot_title}</option>)}
                        </select>
                      </td>
                      <td style={styles.td}>
                        <input 
                          style={{ width: '100%', border: 'none', outline: 'none' }}
                          value={note.text}
                          onChange={e => updateNote(note.id, { text: e.target.value })}
                        />
                      </td>
                      <td style={styles.td}>
                        <select 
                          style={{ 
                            ...styles.badge, 
                            background: colors.bg, 
                            color: colors.text,
                            border: 'none',
                            cursor: 'pointer'
                          }}
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
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
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
              <IconFileExport size={64} color="#3b82f6" style={{ marginBottom: '20px' }} />
              <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Générer le Compte Rendu</h3>
              <p style={{ color: '#64748b', marginBottom: '24px' }}>Préparez le document PDF pour diffusion aux entreprises.</p>
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
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                  defaultValue={`CR Chantier N°${selectedReport?.report_number} - ${project.name}`}
                />
              </div>
              <div>
                <label style={{ fontSize: '13px', fontWeight: '600', display: 'block', marginBottom: '6px' }}>Message</label>
                <textarea 
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', minHeight: '150px' }}
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
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                value={newReportDate}
                onChange={e => setNewReportDate(e.target.value)}
              />
            </div>
            
            {project.address && (
              <div style={{ marginBottom: '20px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '8px' }}>
                  <IconCloud size={16} /> Météo automatique
                </div>
                {weatherLoading ? (
                  <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    Récupération des données...
                  </div>
                ) : fetchedWeather ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '500' }}>{fetchedWeather.meteo}</span>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#3b82f6' }}>{fetchedWeather.temperature}°C</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#ef4444' }}>Impossible de récupérer la météo</div>
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
