// Real planning component, mocked HTTP in Playwright; no production credentials.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlanningChantierView } from '../../src/components/chantier/PlanningChantierTab';
import type { Project, ProjectLot } from '../../src/types';
import { i18nReady } from '../../src/i18n';
import '../../src/index.css';
const project = { id: new URLSearchParams(location.search).get('project') ?? 'fixture', name: 'École et gymnase', project_code: 'ECOLE' } as Project;
const lots = [{ id: 'go', lot_number: '01', lot_title: 'Gros œuvre', contact_name: 'Martin' }, { id: 'bois', lot_number: '02', lot_title: 'Charpente', contact_name: 'Bois & Cie' }] as ProjectLot[];
await i18nReady;
createRoot(document.getElementById('root')!).render(<main className="p-4"><PlanningChantierView project={project} lots={lots} preferenceScope="test:architecte" settings={{} as any} showToast={console.log} /></main>);
