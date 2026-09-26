import { useEffect, useRef, useState } from 'react';
import { IconFileExport, IconFileImport } from '@tabler/icons-react';
import { saveAs } from 'file-saver';
import type { Project, Task, TeamMember } from '../../types';
import { apiFetch } from '../../lib/api';
import {
  exportGanttProjectXml,
  exportMsProjectXml,
  importedTasksToCreatePayloads,
  parsePlanningXml,
  type ProjectXmlFormat,
} from '../../lib/projectPlanningXml';

interface PlanningXmlControlsProps {
  projects: Project[];
  tasks: Task[];
  team: TeamMember[];
  onImported: () => Promise<void> | void;
}

function safeFilename(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'planning';
}

export default function PlanningXmlControls({ projects, tasks, team, onImported }: PlanningXmlControlsProps) {
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!projects.length) {
      setProjectId('');
      return;
    }
    if (!projectId || !projects.some(project => project.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  const project = projects.find(item => item.id === projectId);
  const projectTasks = tasks.filter(task => task.project_id === projectId);

  const handleExport = (format: ProjectXmlFormat) => {
    if (!project) return;
    setFeedback(null);
    try {
      const xml = format === 'ganttproject'
        ? exportGanttProjectXml(project, projectTasks, team)
        : exportMsProjectXml(project, projectTasks, team);
      const suffix = format === 'ganttproject' ? 'ganttproject.gan' : 'msproject.xml';
      saveAs(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `${safeFilename(project.name)}-${suffix}`);
      setFeedback({ kind: 'success', text: `${projectTasks.length} tâche(s) exportée(s).` });
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleFile = async (file: File) => {
    if (!project) return;
    setBusy(true);
    setFeedback(null);
    try {
      const parsed = parsePlanningXml(await file.text());
      if (!parsed.tasks.length) throw new Error('Le fichier ne contient aucune tâche importable.');

      const payloads = importedTasksToCreatePayloads(parsed, project.id, team);
      for (const payload of payloads) {
        await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      }

      await onImported();
      setFeedback({
        kind: 'success',
        text: `${payloads.length} tâche(s) importée(s) depuis ${parsed.format === 'ganttproject' ? 'GanttProject' : 'Microsoft Project'}.`,
      });
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={projectId}
        onChange={event => setProjectId(event.target.value)}
        className="px-3 py-2 text-sm rounded-lg"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
        aria-label="Opération pour import ou export de planning"
      >
        {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>

      <input
        ref={inputRef}
        type="file"
        accept=".xml,.gan,application/xml,text/xml"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <button
        type="button"
        disabled={!project || busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium disabled:opacity-50"
        style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
      >
        <IconFileImport size={16} />
        {busy ? 'Import…' : 'Importer XML'}
      </button>

      <button
        type="button"
        disabled={!project}
        onClick={() => handleExport('ganttproject')}
        className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium disabled:opacity-50"
        style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
      >
        <IconFileExport size={16} />
        GanttProject
      </button>

      <button
        type="button"
        disabled={!project}
        onClick={() => handleExport('msproject')}
        className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium disabled:opacity-50"
        style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' }}
      >
        <IconFileExport size={16} />
        MS Project
      </button>

      {feedback && (
        <span className="text-xs" style={{ color: feedback.kind === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-success)' }}>
          {feedback.text}
        </span>
      )}
    </div>
  );
}
