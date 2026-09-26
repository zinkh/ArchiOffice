import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Project, Task, TeamMember } from '../types';

export type ProjectXmlFormat = 'ganttproject' | 'msproject';
