import { parseGanttProject, exportGanttProjectXml } from './ganttProjectXml';
import { parseMsProject, exportMsProjectXml } from './msProjectXml';
import {
  planningXmlParser,
  importedTasksToCreatePayloads,
  type ParsedPlanningXml,
  type ProjectXmlFormat,
  type ImportedPlanningTask,
} from './projectPlanningXmlShared';

export { exportGanttProjectXml, exportMsProjectXml, importedTasksToCreatePayloads };
export type { ParsedPlanningXml, ProjectXmlFormat, ImportedPlanningTask };

export function parsePlanningXml(xml: string): ParsedPlanningXml {
  let root: any;
  try {
    root = planningXmlParser.parse(xml);
  } catch (error) {
    throw new Error(`XML illisible : ${error instanceof Error ? error.message : String(error)}`);
  }

  if (root?.project) return parseGanttProject(root);
  if (root?.Project) return parseMsProject(root);
  throw new Error('Format XML non reconnu. Formats acceptés : GanttProject et Microsoft Project XML.');
}
