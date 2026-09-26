import { describe, expect, it } from 'vitest';
import type { Project, Task, TeamMember } from '../src/types';
import {
  exportGanttProjectXml,
  exportMsProjectXml,
  parsePlanningXml,
} from '../src/lib/projectPlanningXml';

const project = {
  id: 'project-1',
  name: 'Réhabilitation laboratoire',
  client: 'MOA',
  status: 'In Progress',
  budget: 0,
  start_date: '2026-09-01',
  end_date: '2026-09-30',
  description: '',
} as Project;

const team = [{
  id: 'user-1',
  name: 'Khal Doun',
  role: 'Architecte',
  email: 'k@example.test',
  system_role: 'pm',
}] as TeamMember[];

const tasks: Task[] = [
  {
    id: 'task-1',
    project_id: project.id,
    title: 'APS',
    description: 'Études préliminaires',
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    progress: 100,
    dependencies: [],
    status: 'done',
    priority: 'normal',
    assignee_id: 'user-1',
  },
  {
    id: 'task-2',
    project_id: project.id,
    title: 'APD',
    start_date: '2026-09-06',
    end_date: '2026-09-12',
    progress: 40,
    dependencies: ['task-1'],
    status: 'in_progress',
    priority: 'high',
    assignee_id: 'user-1',
  },
];

describe('planning XML interoperability', () => {
  it('parses nested GanttProject tasks, dependencies and allocations', () => {
    const xml = `<?xml version="1.0"?>
      <project name="Projet test">
        <tasks>
          <task id="1" name="APS" start="2026-09-01" duration="5" complete="100">
            <depend id="2" type="2" difference="0"/>
            <task id="2" name="APD" start="2026-09-06" duration="7" complete="40"/>
          </task>
        </tasks>
        <resources><resource id="3" name="Khal Doun"/></resources>
        <allocations><allocation task-id="2" resource-id="3" load="100"/></allocations>
      </project>`;

    const parsed = parsePlanningXml(xml);
    expect(parsed.format).toBe('ganttproject');
    expect(parsed.projectName).toBe('Projet test');
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[1]).toMatchObject({
      sourceId: '2',
      title: 'APD',
      start_date: '2026-09-06',
      end_date: '2026-09-12',
      progress: 40,
      dependencies: ['1'],
      resourceNames: ['Khal Doun'],
    });
  });

  it('parses Microsoft Project tasks, predecessors and assignments', () => {
    const xml = `<?xml version="1.0"?>
      <Project xmlns="http://schemas.microsoft.com/project">
        <Name>Projet MS</Name>
        <Tasks>
          <Task><UID>1</UID><ID>1</ID><Name>APS</Name><Start>2026-09-01T08:00:00</Start><Finish>2026-09-05T17:00:00</Finish><PercentComplete>100</PercentComplete></Task>
          <Task><UID>2</UID><ID>2</ID><Name>APD</Name><Start>2026-09-06T08:00:00</Start><Finish>2026-09-12T17:00:00</Finish><PercentComplete>40</PercentComplete><PredecessorLink><PredecessorUID>1</PredecessorUID></PredecessorLink></Task>
        </Tasks>
        <Resources><Resource><UID>7</UID><Name>Khal Doun</Name></Resource></Resources>
        <Assignments><Assignment><TaskUID>2</TaskUID><ResourceUID>7</ResourceUID></Assignment></Assignments>
      </Project>`;

    const parsed = parsePlanningXml(xml);
    expect(parsed.format).toBe('msproject');
    expect(parsed.projectName).toBe('Projet MS');
    expect(parsed.tasks[1].dependencies).toEqual(['1']);
    expect(parsed.tasks[1].resourceNames).toEqual(['Khal Doun']);
  });

  it('round-trips ArchiOffice tasks through GanttProject XML', () => {
    const parsed = parsePlanningXml(exportGanttProjectXml(project, tasks, team));
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[1].dependencies).toEqual(['1']);
    expect(parsed.tasks[1].progress).toBe(40);
    expect(parsed.tasks[1].resourceNames).toEqual(['Khal Doun']);
  });

  it('round-trips ArchiOffice tasks through Microsoft Project XML', () => {
    const parsed = parsePlanningXml(exportMsProjectXml(project, tasks, team));
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[1].dependencies).toEqual(['1']);
    expect(parsed.tasks[1].progress).toBe(40);
    expect(parsed.tasks[1].resourceNames).toEqual(['Khal Doun']);
  });
});
