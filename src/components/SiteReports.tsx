import { useState, useEffect } from 'react';
import { SiteReport, SiteReportNote, ProjectLot, Project } from '../types';
import { IconPlus, IconFileText, IconCheck, IconEdit, IconFileDownload, IconTrash, IconCalendar, IconGripVertical } from '@tabler/icons-react';
import ObservationsTable from './ObservationsTable';
import jsPDF from 'jspdf';
import { autoSaveDocument } from '../lib/autoSaveDocument';

interface SiteReportsProps {
  project: Project;
  lots_list: ProjectLot[];
}

export default function SiteReports({ project, lots_list }: SiteReportsProps) {
  const [view, setView] = useState<'cr' | 'observations'>('cr');
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<SiteReport | null>(null);
  const [notes, setNotes] = useState<SiteReportNote[]>([]);
  const [newNote, setNewNote] = useState({ category: '', responsible_company: '', text: '' });
  const [editingNote, setEditingNote] = useState<SiteReportNote | null>(null);
  const [categories, setCategories] = useState(['Sécurité', 'Qualité', 'Planning', 'Autre']);

  const [pageFormat, setPageFormat] = useState<'portrait' | 'landscape'>('portrait');
  const [stakeholders, setStakeholders] = useState<{ name: string; role: string }[]>([]);
  const [companies, setCompanies] = useState<{ name: string; trade: string }[]>([]);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [nextMeeting, setNextMeeting] = useState('');

  // Update local state when selectedReport changes
  useEffect(() => {
    if (selectedReport) {
      setPageFormat(selectedReport.pageFormat || 'portrait');
      setStakeholders(selectedReport.stakeholders || []);
      setCompanies(selectedReport.companies || []);
      setMeetingNotes(selectedReport.meetingNotes || '');
      setNextMeeting(selectedReport.nextMeeting || '');
    }
  }, [selectedReport]);

  const saveReportCustomizations = async () => {
    if (!selectedReport) return null;
    const res = await fetch(`/api/reports/${selectedReport.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...selectedReport, pageFormat, stakeholders, companies, meetingNotes, nextMeeting })
    });
    
    if (!res.ok) {
        console.error('Failed to save report:', await res.text());
        return null;
    }

    const updatedReport = await res.json();
    setReports(reports.map(r => r.id === updatedReport.id ? updatedReport : r));
    return updatedReport;
  };

  const updateReportCustomizations = async () => {
    const updatedReport = await saveReportCustomizations();
    if (updatedReport) setSelectedReport(updatedReport);
  };

  const handleReportSelection = async (report: SiteReport) => {
    if (selectedReport) {
      const success = await saveReportCustomizations();
      if (!success) {
        alert("Failed to save current report customizations. Please try again.");
        return;
      }
    }
    setSelectedReport(report);
  };

  const exportToPDF = async () => {
    const input = document.getElementById('pdf-template');
    if (!input) return;

    // Temporarily show the template for capture
    input.style.display = 'block';
    
    // Hide icons before generation to prevent html2canvas errors
    const icons = input.querySelectorAll('svg');
    icons.forEach(icon => icon.style.display = 'none');

    try {
      const pdf = new jsPDF(pageFormat === 'portrait' ? 'p' : 'l', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      
      await pdf.html(input, {
        x: 0,
        y: 0,
        width: pdfWidth,
        windowWidth: 794, // ~210mm at 96dpi
        margin: [10, 0, 10, 0],
        autoPaging: true
      });
      
      const filename = `Compte_Rendu_Chantier_${selectedReport?.report_number || 'export'}.pdf`;
      pdf.save(filename);
      autoSaveDocument({
        blob: pdf.output('blob'),
        filename,
        name: `CR Chantier N°${selectedReport?.report_number || 'export'} - ${project.name}`,
        projectId: project.id,
        phase: 'DET',
        category: 'Report',
      });
    } catch (err) {
      console.error('PDF Generation Error:', err);
      alert('Erreur lors de la génération du PDF.');
    } finally {
      // Restore icons and hide template
      icons.forEach(icon => icon.style.display = '');
      input.style.display = 'none';
    }
  };

  useEffect(() => {
    fetch(`/api/projects/${project.id}/reports`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => { if (Array.isArray(data)) setReports(data); })
      .catch(err => console.error(err));
  }, [project.id]);

  useEffect(() => {
    let active = true;
    if (selectedReport) {
      fetch(`/api/reports/${selectedReport.id}/notes`)
        .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then(data => { if (active && Array.isArray(data)) setNotes(data); })
        .catch(err => console.error(err));
    }
    return () => { active = false; };
  }, [selectedReport]);

  const createReport = () => {
    const report_number = reports.length + 1;
    fetch(`/api/projects/${project.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: new Date().toISOString().split('T')[0], report_number })
    })
    .then(res => res.json())
    .then(newReport => {
      setReports([newReport, ...reports]);
      setSelectedReport(newReport);
    });
  };

  const markAsDone = (noteId: string) => {
    fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ realization_date: new Date().toISOString().split('T')[0], status: 'done' })
    })
    .then(() => {
      setNotes(notes.map(n => n.id === noteId ? { ...n, status: 'done', realization_date: new Date().toISOString().split('T')[0] } : n));
    });
  };

  const deleteNote = (noteId: string) => {
    if (!confirm('Supprimer cette observation ?')) return;
    fetch(`/api/notes/${noteId}`, { method: 'DELETE' })
      .then(() => {
        setNotes(notes.filter(n => n.id !== noteId));
      });
  };

  const updateNoteField = (noteId: string, field: keyof SiteReportNote, value: any) => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
    const updatedNote = { ...note, [field]: value };
    
    // Optimistic update
    setNotes(notes.map(n => n.id === noteId ? updatedNote : n));
    
    fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedNote)
    });
  };

  const createNote = () => {
    if (!selectedReport || !newNote.category) return;
    
    const note_number = notes.length + 1;
    fetch(`/api/reports/${selectedReport.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...newNote, 
        note_number, 
        issue_date: selectedReport.date // Inherit date from report
      })
    })
    .then(res => res.json())
    .then(newNoteData => {
      setNotes([...notes, { id: newNoteData.id, report_id: selectedReport.id, ...newNote, note_number, issue_date: selectedReport.date, status: 'open' }]);
      setNewNote({ category: '', responsible_company: '', text: '' });
    });
  };

  const updateNote = (note: SiteReportNote) => {
    fetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note)
    })
    .then(() => {
      setNotes(notes.map(n => n.id === note.id ? note : n));
      setEditingNote(null);
    });
  };

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView('cr')}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${view === 'cr' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
        >
          CR de chantier
        </button>
        <button
          onClick={() => setView('observations')}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${view === 'observations' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
        >
          Base Observations
        </button>
      </div>

      {view === 'observations' && (
        <ObservationsTable projectId={project.id} lots={lots_list} currentReportId={selectedReport?.id} />
      )}

      {view === 'cr' && <>
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-center gap-3">
        <h3 className="text-lg font-bold dark:text-white">Comptes Rendus de Chantier</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportToPDF} className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white px-3 py-2 rounded-xl text-sm font-semibold transition-all">
            <IconFileDownload size={16} />
            <span>Export PDF</span>
          </button>
          <div className="flex gap-2">
            <input
              id="new-category-input"
              placeholder="Nouvelle catégorie"
              className="p-2 border rounded-lg text-sm dark:bg-zinc-800 dark:border-zinc-700 dark:text-white w-36 sm:w-auto"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const input = e.currentTarget;
                  if (input.value.trim()) {
                    setCategories([...categories, input.value]);
                    input.value = '';
                  }
                }
              }}
            />
            <button
              onClick={() => {
                const input = document.getElementById('new-category-input') as HTMLInputElement;
                if (input && input.value.trim()) {
                  setCategories([...categories, input.value]);
                  input.value = '';
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-sm font-bold transition-all"
            >
              +
            </button>
          </div>
          <button onClick={createReport} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-xl text-sm font-semibold transition-all">
            <IconPlus size={16} />
            <span>Nouveau CR</span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {reports.map(report => (
          <button 
            key={report.id} 
            onClick={() => handleReportSelection(report)}
            className={`p-4 rounded border ${selectedReport?.id === report.id ? 'bg-blue-50 border-blue-500 dark:bg-blue-900/20 dark:border-blue-700' : 'bg-white border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700'} transition-colors`}
          >
            <IconFileText className="mx-auto mb-2" />
            <div className="font-bold text-sm dark:text-white">CR N°{report.report_number}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{report.date}</div>
          </button>
        ))}
      </div>
      {selectedReport && (
        <div id="printable-report" className="mt-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded border border-zinc-200 dark:border-zinc-700">
          <div className="hidden print:block mb-6 border-b pb-4">
            <h2 className="text-2xl font-bold dark:text-white">{project.name}</h2>
            <p className="text-zinc-600 dark:text-zinc-400">{project.client}</p>
            <p className="text-zinc-600 dark:text-zinc-400">{project.address}</p>
          </div>
          <h4 className="text-lg font-bold mb-4 dark:text-white">CR N°{selectedReport.report_number} - {selectedReport.date}</h4>

          {meetingNotes && (
            <div className="mb-6">
              <h5 className="font-bold underline mb-2 dark:text-white">Notes de réunion :</h5>
              <p className="text-sm dark:text-zinc-300">{meetingNotes}</p>
            </div>
          )}
          
          <div className="bg-zinc-50 dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 mb-6 print:hidden">
            <h5 className="font-bold mb-3 dark:text-white">Personnalisation PDF</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Format de page</label>
                <select className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" value={pageFormat} onChange={e => setPageFormat(e.target.value as 'portrait' | 'landscape')}>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Paysage</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Intervenants (page de garde)</label>
              <div className="space-y-2 mb-2">
                {stakeholders.map((s, i) => (
                  <div key={`stakeholder-${i}`} className="flex gap-2">
                    <input
                      className="flex-1 p-2 border rounded text-sm dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                      placeholder="Nom"
                      value={s.name}
                      onChange={e => {
                        const newS = [...stakeholders];
                        newS[i].name = e.target.value;
                        setStakeholders(newS);
                      }}
                    />
                    <input
                      className="flex-1 p-2 border rounded text-sm dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                      placeholder="Rôle"
                      value={s.role}
                      onChange={e => {
                        const newS = [...stakeholders];
                        newS[i].role = e.target.value;
                        setStakeholders(newS);
                      }}
                    />
                    <button onClick={() => setStakeholders(stakeholders.filter((_, idx) => idx !== i))} className="text-red-500 p-2">×</button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setStakeholders([...stakeholders, { name: '', role: '' }])}
                className="text-xs bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded dark:text-white"
              >
                + Ajouter un intervenant
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Entreprises (page 2)</label>
              <div className="space-y-2 mb-2">
                {companies.map((c, i) => (
                  <div key={`company-${i}`} className="flex gap-2">
                    <input
                      className="flex-1 p-2 border rounded text-sm dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                      placeholder="Nom de l'entreprise"
                      value={c.name}
                      onChange={e => {
                        const newC = [...companies];
                        newC[i].name = e.target.value;
                        setCompanies(newC);
                      }}
                    />
                    <input
                      className="flex-1 p-2 border rounded text-sm dark:bg-zinc-700 dark:border-zinc-600 dark:text-white"
                      placeholder="Lot"
                      value={c.trade}
                      onChange={e => {
                        const newC = [...companies];
                        newC[i].trade = e.target.value;
                        setCompanies(newC);
                      }}
                    />
                    <button onClick={() => setCompanies(companies.filter((_, idx) => idx !== i))} className="text-red-500 p-2">×</button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setCompanies([...companies, { name: '', trade: '' }])}
                className="text-xs bg-zinc-200 dark:bg-zinc-700 px-2 py-1 rounded dark:text-white"
              >
                + Ajouter une entreprise
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Prochaine réunion</label>
              <input type="text" className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" value={nextMeeting} onChange={e => setNextMeeting(e.target.value)} placeholder="ex : Mardi 18/05/21 à 9h00 sur site" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-bold mb-1 dark:text-zinc-300">Notes de réunion</label>
              <textarea className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)} />
            </div>
            <button onClick={updateReportCustomizations} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold dark:bg-blue-700">Enregistrer</button>
          </div>


          {/* Desktop Table View (Notion Style) */}
          <div className="hidden md:block overflow-x-auto border rounded-xl border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                  <th className="p-2 text-left w-10"></th>
                  <th className="p-2 text-left w-12 text-zinc-400 font-medium">#</th>
                  <th className="p-2 text-left w-32 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">Category</th>
                  <th className="p-2 text-left w-48 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">Company</th>
                  <th className="p-2 text-left text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">Observation / Action</th>
                  <th className="p-2 text-left w-32 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">Due Date</th>
                  <th className="p-2 text-left w-28 text-zinc-500 font-semibold uppercase text-[10px] tracking-wider">Status</th>
                  <th className="p-2 text-center w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {notes.length > 0 ? (
                  notes.map(note => (
                    <tr key={note.id} className="group hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="p-2 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 cursor-grab active:cursor-grabbing">
                        <IconGripVertical size={16} />
                      </td>
                      <td className="p-2 text-zinc-400 font-mono text-xs dark:text-zinc-500">{note.note_number}</td>
                      <td className="p-1">
                        <select 
                          className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer dark:text-white"
                          value={note.category}
                          onChange={e => {
                            if (e.target.value === 'add-new') {
                              const newCat = prompt("Entrez le nom de la nouvelle catégorie :");
                              if (newCat && newCat.trim()) {
                                setCategories([...categories, newCat.trim()]);
                                updateNoteField(note.id, 'category', newCat.trim());
                              }
                            } else {
                              updateNoteField(note.id, 'category', e.target.value);
                            }
                          }}
                        >
                          {categories.map((cat, index) => <option key={`category-${cat}-${index}`} value={cat}>{cat}</option>)}
                          <option value="add-new">+ Ajouter une catégorie</option>
                        </select>
                      </td>
                      <td className="p-1">
                        <select 
                          className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer truncate dark:text-white"
                          value={note.responsible_company || ''}
                          onChange={e => updateNoteField(note.id, 'responsible_company', e.target.value)}
                        >
                          <option value="">Select Company</option>
                          {lots_list.map((lot, index) => <option key={`lot-${lot.id}-${index}`} value={lot.contact_name}>{lot.contact_name}</option>)}
                        </select>
                      </td>
                      <td className="p-1">
                        <input 
                          type="text"
                          className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors dark:text-white"
                          value={note.text}
                          onChange={e => updateNoteField(note.id, 'text', e.target.value)}
                          placeholder="Type observation..."
                        />
                      </td>
                      <td className="p-1">
                        <div className="relative group/date">
                          <input 
                            type="date"
                            className="w-full p-1.5 bg-transparent border-none focus:ring-1 focus:ring-blue-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs dark:text-white"
                            value={note.due_date || ''}
                            onChange={e => updateNoteField(note.id, 'due_date', e.target.value)}
                          />
                        </div>
                      </td>
                      <td className="p-2">
                        <select 
                          className={`w-full p-1 rounded text-[10px] font-bold uppercase tracking-wider border-none focus:ring-0 cursor-pointer transition-colors ${
                            note.status === 'done' 
                              ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50' 
                              : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:hover:bg-yellow-900/50'
                          }`}
                          value={note.status}
                          onChange={e => updateNoteField(note.id, 'status', e.target.value)}
                        >
                          <option value="open">Open</option>
                          <option value="done">Done</option>
                        </select>
                      </td>
                      <td className="p-2 text-center">
                        <button 
                          onClick={() => deleteNote(note.id)} 
                          className="text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-all opacity-0 group-hover:opacity-100"
                          title="Delete Note"
                        >
                          <IconTrash size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr key="no-notes">
                    <td colSpan={8} className="p-12 text-center text-zinc-400 italic bg-zinc-50/30 dark:bg-zinc-800/30">
                      <div className="flex flex-col items-center gap-2">
                        <IconFileText size={32} className="opacity-20" />
                        <span>No notes for this report. Click below to add one.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button 
              onClick={() => {
                setNewNote({ category: categories[0], responsible_company: '', text: '' });
                createNote();
              }}
              className="w-full p-3 text-left text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all flex items-center gap-2 text-sm border-t border-zinc-100 dark:border-zinc-700 group"
            >
              <IconPlus size={16} className="text-zinc-400 group-hover:text-blue-500 transition-colors" />
              <span>New Row</span>
            </button>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {notes.map(note => (
              <div key={note.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Note #{note.note_number}</span>
                    <h5 className="font-bold text-zinc-900 dark:text-white">{note.category}</h5>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                    note.status === 'done' 
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' 
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                  }`}>
                    {note.status}
                  </span>
                </div>
                
                <div className="text-sm">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Company</span>
                  <span className="font-medium dark:text-zinc-300">{note.responsible_company || '-'}</span>
                </div>
                <div className="text-sm">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 block">Text</span>
                  <span className="font-medium dark:text-zinc-300">{note.text}</span>
                </div>

                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700 flex justify-end gap-2">
                  <button 
                    onClick={() => deleteNote(note.id)} 
                    className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <IconTrash size={16} /> Delete
                  </button>
                  {note.status === 'open' && (
                    <button 
                      onClick={() => markAsDone(note.id)} 
                      className="flex items-center gap-2 text-sm font-bold text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <IconCheck size={16} /> Mark as Done
                    </button>
                  )}
                  <button 
                    onClick={() => setEditingNote(note)} 
                    className="flex items-center gap-2 text-sm font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <IconEdit size={16} /> Edit
                  </button>
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="p-8 text-center text-zinc-500 dark:text-zinc-400 italic bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-700">
                No notes for this report.
              </div>
            )}
          </div>
        </div>
      )}
      {editingNote && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl w-full max-w-md">
            <h5 className="font-bold mb-4 dark:text-white">Edit Note</h5>
            <div className="space-y-4">
              <select 
                className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" 
                value={editingNote.category} 
                onChange={e => setEditingNote({...editingNote, category: e.target.value})} 
              >
                {categories.map((cat, index) => <option key={`category-${cat}-${index}`} value={cat}>{cat}</option>)}
              </select>
              <select 
                className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" 
                value={editingNote.responsible_company} 
                onChange={e => setEditingNote({...editingNote, responsible_company: e.target.value})} 
              >
                {lots_list.map((lot, index) => <option key={`lot-${lot.id}-${index}`} value={lot.contact_name}>{lot.contact_name}</option>)}
              </select>
              <div>
                <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-1">Due Date</label>
                <input 
                  type="date"
                  className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" 
                  value={editingNote.due_date || ''} 
                  onChange={e => setEditingNote({...editingNote, due_date: e.target.value})} 
                />
              </div>
              <select 
                className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" 
                value={editingNote.status} 
                onChange={e => setEditingNote({...editingNote, status: e.target.value as 'open' | 'done'})} 
              >
                <option value="open">Open</option>
                <option value="done">Done</option>
              </select>
              <textarea 
                className="w-full p-2 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white" 
                value={editingNote.text} 
                onChange={e => setEditingNote({...editingNote, text: e.target.value})} 
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingNote(null)} className="px-4 py-2 rounded text-sm dark:text-zinc-300 dark:hover:text-white">Cancel</button>
                <button onClick={() => updateNote(editingNote)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold dark:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* PDF Export Template (Hidden) */}
      <div 
        id="pdf-template" 
        style={{ 
          display: 'none', 
          width: '794px', // Standard A4 width at 96dpi
          backgroundColor: 'white',
          color: '#333',
          fontFamily: 'Arial, sans-serif',
          lineHeight: '1.4',
          boxSizing: 'border-box'
        }}
      >
        {/* PAGE 1: COVER PAGE */}
        <div style={{ height: '1123px', padding: '80px 19px 80px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderBottom: '1px solid #eee', boxSizing: 'border-box' }}>
          <div style={{ borderBottom: '4px solid black', paddingBottom: '40px' }}>
            <p style={{ fontSize: '14pt', fontWeight: 'bold', margin: '0 0 10px 0', color: '#666' }}>{project.project_code}</p>
            <h1 style={{ fontSize: '32pt', fontWeight: '900', margin: 0, lineHeight: 1.1 }}>{project.name}</h1>
            <p style={{ fontSize: '16pt', marginTop: '10px' }}>{project.address}</p>
          </div>

          <div style={{ margin: '60px 0' }}>
            <h2 style={{ fontSize: '24pt', fontWeight: 'bold', marginBottom: '10px' }}>COMPTE RENDU DE CHANTIER N°{selectedReport?.report_number?.toString().padStart(2, '0')}</h2>
            <p style={{ fontSize: '18pt', color: '#666' }}>Date de la réunion : {selectedReport?.date}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
            <div>
              <h3 style={{ fontSize: '10pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#888', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>Maîtrise d'Ouvrage</h3>
              <p style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>{project.client}</p>
            </div>
            <div>
              <h3 style={{ fontSize: '10pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#888', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>Maîtrise d'Œuvre</h3>
              <p style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>KHALDOUN SEKTAOUI X ARCHITECTURE</p>
            </div>
          </div>

          {stakeholders.length > 0 && (
            <div style={{ marginTop: '40px' }}>
              <h3 style={{ fontSize: '10pt', fontWeight: 'bold', textTransform: 'uppercase', color: '#888', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '5px' }}>Intervenants</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {stakeholders.map((s, i) => (
                  <div key={`stakeholder-${i}`} style={{ fontSize: '10pt' }}>
                    <span style={{ fontWeight: 'bold' }}>{s.name}</span> — <span style={{ color: '#666' }}>{s.role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: '10pt', color: '#999' }}>
              <p>Document établi par K. SEKTAOUI</p>
              <p>Date d'édition : {new Date().toLocaleDateString('fr-FR')}</p>
            </div>
            <div style={{ width: '150px', height: '60px', border: '1px dashed #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8pt', color: '#ccc' }}>
              Cachet / Signature
            </div>
          </div>
        </div>

        {/* PAGE 2: COMPANIES LIST */}
        {companies.length > 0 && (
          <div style={{ height: '1123px', padding: '60px 19px 60px 30px', borderBottom: '1px solid #eee', boxSizing: 'border-box' }}>
            <h2 style={{ backgroundColor: '#f2f2f2', padding: '10px', borderLeft: '5px solid #666', fontSize: '1.5em', marginBottom: '30px' }}>Liste des Entreprises</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#eee' }}>
                  <th style={{ border: '1px solid #ccc', padding: '12px', textAlign: 'left' }}>Entreprise</th>
                  <th style={{ border: '1px solid #ccc', padding: '12px', textAlign: 'left' }}>Corps d'état / Lot</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c, i) => (
                  <tr key={`company-${i}`}>
                    <td style={{ border: '1px solid #ccc', padding: '12px', fontWeight: 'bold' }}>{c.name}</td>
                    <td style={{ border: '1px solid #ccc', padding: '12px' }}>{c.trade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGE 3: REPORT CONTENT */}
        <div style={{ padding: '40px 19px 40px 20px', boxSizing: 'border-box' }}>
          {/* Header */}
          <header style={{ borderBottom: '2px solid #000', paddingBottom: '10px', marginBottom: '20px' }}>
            <p style={{ margin: '5px 0' }}><strong>Projet :</strong> {project.project_code} {project.name}</p>
            <h1 style={{ fontSize: '1.5em', margin: '5px 0', fontWeight: 'bold' }}>COMPTE RENDU DE REUNION DE CHANTIER N°{selectedReport?.report_number?.toString().padStart(2, '0')}</h1>
            <p style={{ margin: '5px 0' }}><strong>Date de la réunion :</strong> {selectedReport?.date}</p>
            <p style={{ margin: '5px 0' }}><strong>Prochaine réunion :</strong> {nextMeeting || '-'}</p>
          </header>

        {/* Info Section */}
        <section style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ width: '48%' }}>
            <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '0 0 10px 0' }}>Maîtrise d'Ouvrage</h2>
            <p style={{ margin: '5px 0' }}><strong>{project.client}</strong></p>
            <p style={{ margin: '5px 0', fontSize: '0.9em' }}>{project.address}</p>
          </div>
          <div style={{ width: '48%' }}>
            <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '0 0 10px 0' }}>Maîtrise d'Œuvre / OPC</h2>
            <p style={{ margin: '5px 0' }}><strong>KHALDOUN SEKTAOUI X ARCHITECTURE</strong></p>
            <p style={{ margin: '5px 0', fontSize: '0.9em' }}>Responsable DET : M. Khaldoun SEKTAOUI</p>
          </div>
        </section>

        {/* Entreprises et Présences */}
        <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '20px 0 10px 0' }}>Entreprises et Présences</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.9em' }}>
          <thead>
            <tr style={{ backgroundColor: '#eee' }}>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', width: '60px' }}>N° Lot</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Désignation</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Entreprise</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Représentant</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center', width: '80px' }}>Présence</th>
            </tr>
          </thead>
          <tbody>
            {lots_list.map((lot, index) => (
              <tr key={`pdf-lot-${lot.id}-${index}`}>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{lot.lot_number}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{lot.lot_title}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{lot.contact_name?.split(' - ')[0] || '-'}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{lot.contact_name?.split(' - ')[1] || '-'}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center', color: 'green', fontWeight: 'bold' }}>P</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Planning et Objectifs */}
        <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '20px 0 10px 0' }}>Planning et Objectifs</h2>
        <p style={{ margin: '5px 0', fontSize: '0.9em' }}><strong>Dates clés prévues :</strong></p>
        <ul style={{ fontSize: '0.9em', margin: '5px 0 20px 20px', padding: 0 }}>
          <li>Début du chantier : {project.start_date}</li>
          <li>Fin prévue : {project.end_date}</li>
        </ul>

        {/* Meeting Notes */}
        {meetingNotes && (
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '20px 0 10px 0' }}>Notes de réunion</h2>
            <div style={{ fontSize: '0.9em', lineHeight: '1.6', whiteSpace: 'pre-wrap', padding: '5px 10px' }}>{meetingNotes}</div>
          </div>
        )}

        {/* Suivi des actions */}
        <h2 style={{ backgroundColor: '#f2f2f2', padding: '5px', borderLeft: '5px solid #666', fontSize: '1.2em', margin: '20px 0 10px 0' }}>Suivi des actions</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px', fontSize: '0.9em' }}>
          <thead>
            <tr style={{ backgroundColor: '#eee' }}>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left' }}>Actions</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', width: '80px' }}>Lot</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'left', width: '100px' }}>Échéance</th>
              <th style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center', width: '100px' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note, index) => (
              <tr key={`pdf-note-${note.id}-${index}`}>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{note.text}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{lots_list.find(l => l.contact_name === note.responsible_company)?.lot_number || '-'}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px' }}>{note.due_date || '-'}</td>
                <td style={{ border: '1px solid #ccc', padding: '8px', textAlign: 'center' }}>
                  <span style={{ 
                    color: note.status === 'done' ? 'green' : '#b06000', 
                    fontWeight: 'bold',
                    fontSize: '0.8em'
                  }}>
                    {note.status === 'done' ? 'RÉSOLU' : 'EN COURS'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer */}
        <footer style={{ marginTop: '40px', borderTop: '1px solid #ccc', paddingTop: '10px', fontSize: '0.8em', textAlign: 'center', color: '#666' }}>
          <p><em>Document établi par K. SEKTAOUI le {new Date().toLocaleDateString('fr-FR')}.</em></p>
          <p>KHALDOUN SEKTAOUI X ARCHITECTURE - 14 rue Colonel Moll - 54500 LAXOU</p>
        </footer>
        </div>
      </div>
      </>}
    </div>
  );
}
