// Lien direct vers la fiche d'un enregistrement créé/modifié par un agent, à
// renvoyer au modèle pour qu'il le donne à l'utilisateur (« accéder
// rapidement » à ce qu'il vient de créer, plutôt qu'un identifiant brut sans
// usage) — voir le champ `record_url` posé par tools.ts.
//
// Les 19 ressources d'AGENT_RESOURCES (types.ts) ne s'ouvrent pas toutes de
// la même façon côté écran : certaines ont une vraie route par id
// (/projects/:id), la plupart n'ont qu'une page de liste qui ouvre une modale
// au clic sur une ligne (pas de route par id), et sept vivent comme onglets
// de ProjectDetail.tsx sans route propre du tout. Ce fichier centralise cette
// correspondance plutôt que de la laisser à la charge de chaque appelant.
//
// Deux conventions d'URL couvrent tout, en s'appuyant sur ce que chaque page
// sait déjà faire (voir le commentaire propre à chaque page pour l'état
// qu'elle lit) :
// - `?open=<id>` sur la page de liste du cabinet, quand elle n'a pas de route
//   par id — la page lit ce paramètre une fois ses données chargées et
//   déclenche exactement la même fonction qu'un clic sur la ligne.
// - `?tab=<ONGLET>&open=<resourceKey>:<id>` sur /projects/:projectId pour les
//   sept ressources qui vivent dans un onglet de la fiche projet.
export function buildRecordPath(resourceKey: string, record: Record<string, unknown> | undefined | null): string | null {
  const id = record?.id != null ? String(record.id) : '';
  if (!id) return null;
  const projectId = record?.project_id != null ? String(record.project_id) : '';

  switch (resourceKey) {
    case 'projects':
      return `/projects/${encodeURIComponent(id)}`;
    case 'tenders':
      return `/tenders/${encodeURIComponent(id)}`;
    // 'articles_type' (Bibliothèque d'ouvrages) est servi par la même route
    // par id que l'ancien CCTP, /specifications/:specId — voir Specifications.tsx.
    case 'articles_type':
      return `/specifications/${encodeURIComponent(id)}`;
    case 'contacts':
      return `/contacts?open=${encodeURIComponent(id)}`;
    case 'proposals':
      return `/proposals?open=${encodeURIComponent(id)}`;
    case 'invoices':
      return `/invoices?open=${encodeURIComponent(id)}`;
    case 'references':
      return `/references?open=${encodeURIComponent(id)}`;
    // Un seul canal pour les tâches : le Gantt, plus riche que le Kanban et
    // déjà câblé sur un clic de ligne qui ouvre la même modale.
    case 'tasks':
      return `/gantt?open=${encodeURIComponent(id)}`;
    // Reunions.tsx n'affiche jamais « toutes les réunions » : il faut
    // d'abord sélectionner le projet/devis/appel d'offres parent avant que
    // la liste des réunions (et donc celle-ci) ne se charge — voir `parent`
    // lu par Reunions.tsx, en plus de `open`.
    case 'meetings': {
      const proposalId = record?.proposal_id != null ? String(record.proposal_id) : '';
      const tenderId = record?.tender_id != null ? String(record.tender_id) : '';
      const parent = projectId ? `project:${projectId}` : proposalId ? `proposal:${proposalId}` : tenderId ? `tender:${tenderId}` : '';
      return parent ? `/reunions?parent=${encodeURIComponent(parent)}&open=${encodeURIComponent(id)}` : null;
    }
    case 'contrats_moe':
      return `/contrats?open=${encodeURIComponent(id)}`;
    case 'ordres_de_service':
      return `/ordres-de-service?open=${encodeURIComponent(id)}`;

    // Les sept ressources ci-dessous n'ont pas de page propre : elles vivent
    // dans un onglet de la fiche projet (ProjectDetail.tsx). Sans project_id,
    // il n'y a nulle part où envoyer le lien.
    case 'visas':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=VISA&open=visas:${encodeURIComponent(id)}` : null;
    case 'receptions':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=AOR&open=receptions:${encodeURIComponent(id)}` : null;
    case 'reserves':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=AOR&open=reserves:${encodeURIComponent(id)}` : null;
    // milestones, permits, marches_entreprises et notes_honoraires n'ont pas
    // de modale ou de fiche par enregistrement à ouvrir avec un état déjà
    // accessible en dehors du bloc JSX qui les affiche (voir la recherche
    // menée avant cette implémentation ; notes_honoraires en particulier vit
    // dans le calcul le plus fragile de tout ProjectDetail.tsx — pas un
    // endroit où ajouter un effet secondaire pour ce seul confort). Le lien
    // pose l'utilisateur sur le bon onglet du bon projet, ce qui reste un net
    // gain sur « chercher où c'est », même sans surligner la ligne précise.
    case 'milestones':
    case 'permits':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=INFOS` : null;
    case 'marches_entreprises':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=DET` : null;
    case 'notes_honoraires':
      return projectId ? `/projects/${encodeURIComponent(projectId)}?tab=HONOS` : null;

    default:
      return null;
  }
}

// APP_URL est déjà l'unique source d'URL absolue dans tout le reste du
// backend (server.ts, superpdp.ts, mailer.ts...) — un lien relatif suffirait
// pour un clic dans l'app, mais l'agent le restitue souvent dans un texte
// libre (chat, mail composé via un futur outil) où une URL absolue est la
// seule qui reste cliquable hors contexte.
export function buildRecordUrl(resourceKey: string, record: Record<string, unknown> | undefined | null): string | null {
  const path = buildRecordPath(resourceKey, record);
  if (!path) return null;
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}
