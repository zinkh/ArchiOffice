// ── Shared types for @zinkh/archioffice-agents ───────────────────────────────

export type AgentContextScope = 'meetings' | 'contacts' | 'projects' | 'documents' | 'tasks' | 'firm_knowledge';

// Write permissions — separate from context_scopes (read-only) so an agent
// can be given data access without automatically being able to write.
// One scope = one resource = the same create/update/delete surface a human
// has in that section of the app, exposed to the agent via the app's own
// REST API (see server/tools.ts) so behavior always matches the UI exactly.
export type AgentActionScope = string;

export interface AgentResourceDef {
  key: string;
  label: string;
  basePath: string;
  create: boolean;
  update: boolean;
  delete: boolean;
  /** Whether GET basePath returns the full tenant list — needed for the
   * duplicate check on create and for search_records. False for resources
   * whose list endpoint is scoped by a path param instead (e.g. per-project). */
  list: boolean;
  /** Field holding this resource's "name" for duplicate detection and search
   * (e.g. title, name). Omit if there's no natural identity field — the
   * duplicate check and search_records are then skipped for that resource.
   * Contacts are special-cased (company_name, else first_name + last_name). */
  identityField?: string;
  /** Human-readable field hint injected into the agent's system prompt. */
  fields: string;
  /**
   * Colonnes réellement acceptées. Un modèle qui ne connaît pas une ressource
   * invente volontiers un schéma plausible (validity_period, payment_terms,
   * phases...) : ces champs partaient jusqu'ici tels quels vers l'API, qui les
   * rejetait avec une erreur que le modèle ne pouvait pas relier à un champ
   * précis. Ils sont désormais écartés avant l'appel et rapportés, plutôt que
   * de faire échouer toute l'écriture.
   */
  knownFields: string[];
  /** Champs sans lesquels l'appel échouerait côté serveur. */
  required?: string[];
  /**
   * Valeurs canoniques d'un champ à choix fermé. La casse est normalisée avant
   * l'envoi : un modèle qui écrit « draft » là où l'API attend « Draft »
   * respecte le vocabulaire documenté, il ne se trompe que de forme.
   */
  enums?: Record<string, string[]>;
  /**
   * Valeurs posées quand le champ est absent. '@today' et '@today+N' sont
   * résolus à l'exécution en date ISO. Un défaut appliqué est toujours
   * rapporté au modèle, pour qu'il le dise à l'utilisateur.
   */
  defaults?: Record<string, string | number>;
}

export const AGENT_RESOURCES: AgentResourceDef[] = [
  { key: 'contacts', label: 'Contacts', basePath: '/api/contacts', create: true, update: true, delete: true, list: true,
    knownFields: ['company_name', 'first_name', 'last_name', 'email', 'phone', 'category', 'address', 'city', 'zip', 'notes'],
    fields: 'company_name, first_name, last_name, email, phone, category, address, city, zip, notes. ' +
      "Un contact identifie soit une personne (first_name* + last_name*), soit une société/un bureau d'études (company_name* seul, sans personne nommée) — " +
      "l'un des deux est obligatoire, mais jamais les deux ensemble ne sont requis. Pour un contact 'entreprise' (bureau d'études, société), " +
      "renseigne uniquement company_name (+ email/phone/adresse si connus) : ne laisse jamais un ajout de contact bloqué faute d'un prénom/nom de personne que la source ne fournit pas." },
  // Delete only actually succeeds server-side while status is Draft — a
  // proposal that's already been sent can't be deleted, only rejected.
  { key: 'proposals', label: 'Devis', basePath: '/api/proposals', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'client_id', 'amount', 'status', 'description', 'notes', 'reference', 'vat_rate'],
    required: ['title'],
    enums: { status: ['Draft', 'Sent', 'Accepted', 'Rejected'] },
    defaults: { status: 'Draft', amount: 0 },
    fields: 'title*, client_id, amount, status (Draft/Sent/Accepted/Rejected), description, notes, vat_rate' },
  { key: 'projects', label: 'Projets', basePath: '/api/projects', create: true, update: true, delete: true, list: true, identityField: 'name',
    knownFields: ['name', 'client', 'status', 'client_id', 'budget', 'category', 'start_date', 'end_date', 'description', 'address', 'ref_cadastrale'],
    required: ['name', 'client'],
    enums: { status: ['Planning', 'In Progress', 'Completed', 'On Hold'] },
    defaults: { status: 'Planning' },
    fields: 'name*, client*, status (Planning/In Progress/Completed/On Hold), client_id, budget, category, start_date, end_date, description, address, ref_cadastrale (référence cadastrale du terrain). ' +
      "Une mise à jour (update_record) ne touche que les champs fournis : pas besoin de renvoyer name/client pour ne changer qu'un seul champ." },
  { key: 'references', label: 'Références (portfolio, hors projets actifs)', basePath: '/api/references/custom', create: true, update: true, delete: true, list: true, identityField: 'name',
    knownFields: ['name', 'client', 'category', 'end_date', 'surface', 'budget', 'status', 'description', 'location', 'start_date', 'project_manager', 'construction_cost', 'remuneration', 'fee_rate', 'progression'],
    required: ['name'],
    enums: { status: ['Completed', 'In Progress', 'Planning'] },
    defaults: { status: 'Completed' },
    fields: 'name*, client, category, end_date, surface, budget, status (Completed/In Progress/Planning), description, location, start_date, project_manager, construction_cost, remuneration, fee_rate, progression. ' +
      'À utiliser quand l\'utilisateur demande d\'ajouter une "référence" (réalisation passée pour la page Références, sans suivi de tâches/factures) — PAS la ressource "projects", réservée aux projets actifs suivis par le cabinet.' },
  { key: 'tenders', label: "Appels d'offres", basePath: '/api/tenders', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'client', 'submission_deadline', 'status', 'description', 'notes', 'value', 'type', 'ville_execution'],
    required: ['title', 'client', 'submission_deadline'],
    enums: { status: ['Draft', 'Submitted', 'Won', 'Lost'] },
    defaults: { status: 'Draft' },
    fields: "title*, client*, submission_deadline*, status (Draft/Submitted/Won/Lost), description, notes, value, ville_execution" },
  { key: 'invoices', label: 'Factures', basePath: '/api/invoices', create: true, update: true, delete: false, list: true,
    knownFields: ['status', 'title', 'project_id', 'client_id', 'amount', 'due_date', 'issue_date', 'description'],
    enums: { status: ['Draft', 'Sent', 'Paid', 'Overdue'] },
    defaults: { status: 'Draft' },
    fields: 'status (Draft/Sent/Paid/Overdue), title, project_id, client_id, amount, due_date, issue_date, description' },
  { key: 'articles_type', label: "Bibliothèque d'ouvrages", basePath: '/api/price-library', create: true, update: true, delete: true, list: true, identityField: 'designation',
    // La ressource 'specifications' (anciennes fiches CCTP, table et route
    // /api/specifications) a été retirée du système — voir CLAUDE.md, « Le
    // CCTP n'est pas un document séparé » : elle n'était plus le CCTP réel
    // depuis longtemps (write_dpgf_article, capacité docsWrite, est le seul
    // moyen d'écrire un CCTP/DPGF) et avait causé l'incident du 7 septembre
    // 2026 (19 fiches créées pour rien en réponse à des demandes qui
    // visaient en réalité CETTE ressource, articles_type — un agent qui
    // « intègre les articles d'un document à la bibliothèque » crée un
    // enregistrement par article ici, jamais un CCTP par chapitre).
    knownFields: ['designation', 'unite', 'prix_unitaire', 'categorie', 'lot_type', 'description', 'notes', 'origine', 'code'],
    required: ['designation'],
    enums: { origine: ['reference', 'saisie', 'bpu', 'offre', 'import'] },
    defaults: { origine: 'saisie' },
    fields: "désignation*, unité, prix_unitaire, catégorie, lot_type (corps de métier), description, notes, origine (reference/saisie/bpu/offre/import), code" },
  { key: 'tasks', label: 'Tâches', basePath: '/api/tasks', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'description', 'start_date', 'end_date', 'due_date', 'project_id', 'status', 'priority', 'assignee_id', 'progress', 'dependencies'],
    required: ['title'],
    enums: { status: ['todo', 'in_progress', 'review', 'done'], priority: ['low', 'normal', 'high', 'urgent'] },
    // start_date et end_date sont NOT NULL en base : sans valeur, l'insertion
    // échoue avec une erreur Postgres que le modèle ne peut pas interpréter.
    // Une tâche créée aujourd'hui pour dans deux semaines est le défaut
    // raisonnable, et il est rapporté à l'utilisateur.
    //
    // `description` était annoncée ici bien avant d'exister : ni la table ni
    // POST /api/tasks ne la stockaient, le champ était donc silencieusement
    // perdu. migrate_add_task_management.sql l'a ajoutée, avec priority et
    // assignee_id.
    defaults: { status: 'todo', priority: 'normal', start_date: '@today', end_date: '@today+14' },
    fields: 'title*, description, start_date (défaut : aujourd\'hui), end_date (défaut : dans 14 jours), due_date, project_id (laisser vide pour une tâche interne au cabinet), status (todo/in_progress/review/done), priority (low/normal/high/urgent), assignee_id (identifiant d\'un membre de l\'équipe)' },
  { key: 'milestones', label: 'Jalons', basePath: '/api/milestones', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'due_date', 'project_id', 'status'],
    required: ['title', 'due_date'],
    fields: 'title*, due_date*, project_id, status' },
  { key: 'meetings', label: 'Réunions (hors chantier)', basePath: '/api/meetings', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'date', 'type', 'project_id', 'proposal_id', 'tender_id', 'notes'],
    required: ['title', 'date'],
    enums: { type: ['projet', 'visite_candidature', 'visite_proposition'] },
    defaults: { type: 'projet' },
    // Faux jusqu'au 2026-09-23 : ce commentaire prétendait qu'une réunion de
    // type 'projet' avec project_id était LA « réunion de chantier » de
    // l'onglet DET — ce n'est pas vrai, /reunions (cette ressource) et
    // l'onglet DET de la fiche projet (ressource 'site_reports' ci-dessous)
    // sont deux écrans et deux tables distincts (`meetings` vs
    // `site_reports`) qui ne se recoupent jamais. Un agent qui suivait ce
    // commentaire créait donc une réunion « classique » sur /reunions,
    // introuvable dans le DET, à chaque demande utilisateur de « réunion de
    // chantier » — voir CLAUDE.md, « Réunion de chantier vs réunion
    // classique côté agents ». `type` couvre les réunions internes (projet)
    // et les visites de site pour un appel d'offres ou une proposition —
    // jamais une réunion/un compte-rendu de chantier, qui vit dans
    // 'site_reports'.
    fields: "title*, date*, type (projet/visite_candidature/visite_proposition), project_id, notes. " +
      "N'utilise pas cette ressource pour une « réunion de chantier » explicitement nommée (c'est 'site_reports' qu'il faut) ; si l'utilisateur dit juste « réunion » sans préciser, demande-lui laquelle avant de créer quoi que ce soit — voir la règle sur les ressources ambiguës." },
  { key: 'site_reports', label: 'Comptes-rendus de chantier (réunions de chantier, onglet DET)', basePath: '/api/site-reports', create: true, update: false, delete: false, list: false,
    knownFields: ['project_id', 'date', 'meteo', 'temperature', 'effectif_total'],
    required: ['project_id', 'date'],
    defaults: { date: '@today' },
    // C'est LA « réunion de chantier » : le compte-rendu qui apparaît dans
    // l'onglet DET (Direction de l'Exécution des Travaux) de la fiche
    // projet — jamais la ressource 'meetings' ci-dessus, qui alimente une
    // page séparée (/reunions) que le DET ne lit pas. Le numéro de
    // compte-rendu (report_number) est calculé automatiquement à partir des
    // comptes-rendus déjà créés pour ce projet ; ne pas le demander à
    // l'utilisateur. Volontairement create-only : le contenu du
    // compte-rendu (présents, décisions, notes de chantier, photos) se
    // saisit ensuite sur l'écran DET lui-même, comme pour un humain qui crée
    // d'abord le compte-rendu puis le remplit — pas en un seul appel d'agent.
    fields: "project_id* (le projet/l'affaire concerné), date* (défaut : aujourd'hui), meteo, temperature, effectif_total. " +
      "Utilise cette ressource dès que l'utilisateur demande explicitement une « réunion de chantier » ou un « compte-rendu de chantier » ; si le mot « réunion » seul reste ambigu (le projet n'est pas clairement en phase chantier, ou rien ne permet de trancher), demande-lui s'il s'agit d'une réunion de chantier (onglet DET) ou d'une réunion classique ('meetings') avant de créer quoi que ce soit." },
  { key: 'contrats_moe', label: 'Contrats MOE', basePath: '/api/contrats_moe', create: true, update: true, delete: true, list: true, identityField: 'intitule_projet',
    knownFields: ['client_id', 'project_id', 'type_contrat', 'type_moa', 'montant_honoraires', 'intitule_projet', 'status', 'adresse_travaux', 'notes', 'numero'],
    enums: { status: ['Brouillon', 'Envoyé', 'Signé', 'Résilié'] },
    defaults: { status: 'Brouillon' },
    fields: 'intitule_projet, client_id, project_id, type_contrat, type_moa, montant_honoraires, status (Brouillon/Envoyé/Signé/Résilié), adresse_travaux, notes' },
  { key: 'ordres_de_service', label: 'Ordres de service', basePath: '/api/ordres_de_service', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['os_number', 'title', 'date', 'project_id', 'description', 'lot', 'entreprise', 'objet', 'type', 'status'],
    required: ['os_number', 'title', 'date'],
    fields: 'os_number*, title*, date*, project_id, description, lot, entreprise, objet' },
  { key: 'visas', label: 'Visas', basePath: '/api/visas', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'date', 'project_id'],
    required: ['title', 'date'],
    fields: 'title*, date*, project_id' },
  { key: 'receptions', label: 'Réceptions', basePath: '/api/receptions', create: true, update: true, delete: true, list: true,
    knownFields: ['date', 'type', 'project_id', 'has_reserves', 'reserves_count'],
    required: ['date', 'type'],
    fields: 'date*, type*, project_id' },
  { key: 'reserves', label: 'Réserves', basePath: '/api/reserves', create: true, update: true, delete: true, list: true, identityField: 'title',
    knownFields: ['title', 'project_id', 'reception_id', 'batiment', 'local', 'status', 'lots', 'entreprises', 'due_date'],
    required: ['title'],
    defaults: { status: 'A faire' },
    fields: 'title*, project_id, batiment, local, status, lots, entreprises, due_date' },
  // GET /api/marches-entreprises/:projectId is project-scoped, not a tenant-wide list.
  { key: 'marches_entreprises', label: 'Marchés entreprises', basePath: '/api/marches-entreprises', create: true, update: true, delete: true, list: false,
    knownFields: ['project_id', 'entreprise_nom', 'lot_numero', 'lot_titre', 'montant_ht'],
    required: ['project_id', 'entreprise_nom'],
    fields: 'project_id*, entreprise_nom*, lot_numero, lot_titre, montant_ht' },
  { key: 'notes_honoraires', label: "Notes d'honoraires", basePath: '/api/notes_honoraires', create: true, update: true, delete: true, list: true, identityField: 'objet',
    knownFields: ['project_id', 'contrat_id', 'numero', 'date', 'objet', 'montant_ht', 'status', 'tva_rate'],
    defaults: { status: 'Brouillon' },
    fields: 'project_id, contrat_id, numero, date, objet, montant_ht' },
  // GET /api/permits?project_id=... est filtré par projet côté client, mais
  // renvoie bien la liste complète du cabinet sans le paramètre (list: true) —
  // nécessaire pour search_records et la détection de doublons.
  { key: 'permits', label: 'Permis (PC/DP/AT)', basePath: '/api/permits', create: true, update: true, delete: true, list: true, identityField: 'reference',
    knownFields: ['project_id', 'type', 'reference', 'submission_date', 'decision_date', 'status', 'notes'],
    required: ['project_id', 'type'],
    enums: { type: ['PC', 'DP', 'AT'], status: ['en_instruction', 'accorde', 'refuse', 'recours'] },
    defaults: { status: 'en_instruction' },
    fields: 'project_id*, type* (PC/DP/AT), reference (numéro de permis), submission_date, decision_date, status (en_instruction/accorde/refuse/recours), notes. ' +
      "Utilise cette ressource pour le numéro, la date de dépôt/décision et le statut d'un permis — jamais la description du projet, qui n'est pas exploitable ailleurs dans l'application." },
];

// Périmètre d'écriture par défaut d'un métier, appliqué quand un cabinet
// active un agent depuis un template. Il double la colonne action_scopes du
// template lui-même (renseignée par supabase/migrate_add_agent_autonomy.sql) :
// le template reste la source, cette table n'intervient que s'il arrive vide,
// cas d'une base où la migration de backfill n'a pas encore tourné.
export const AGENT_DEFAULT_ACTION_SCOPES: Record<string, string[]> = {
  'secretaire':          ['contacts', 'meetings', 'tasks', 'milestones', 'projects', 'permits'],
  'charge-projet':       ['projects', 'tasks', 'milestones', 'meetings', 'site_reports', 'contacts', 'ordres_de_service', 'visas', 'receptions', 'reserves', 'permits'],
  'pilote-chantier':     ['meetings', 'site_reports', 'tasks', 'ordres_de_service', 'visas', 'receptions', 'reserves', 'marches_entreprises'],
  'economiste':          ['proposals', 'marches_entreprises', 'notes_honoraires', 'articles_type'],
  'comptable':           ['invoices', 'notes_honoraires', 'contrats_moe'],
  'juridique':           ['contrats_moe', 'ordres_de_service', 'tenders'],
  'responsable-hqe':     ['tasks'],
  // Ces quatre métiers n'avaient que 'specifications' (l'ancienne ressource
  // CCTP, retirée du système — voir CLAUDE.md) en défaut : sans elle, aucun
  // périmètre d'écriture par défaut ne leur correspond encore, à régler au
  // cas par cas depuis /agents/:id/edit plutôt que d'improviser un remplaçant.
  'ingenieur-thermique': [],
  'ingenieur-structure': [],
  'ingenieur-fluides':   [],
  'acousticien':         [],
  'paysagiste':          ['tasks'],
  'urbaniste':           ['contacts', 'meetings', 'tasks', 'projects'],
};

// Capacités hors CRUD interne. Chacune a sa propre colonne plutôt qu'une
// entrée dans action_scopes : le risque, la surface exposée et la personne
// qui décide de l'activer ne sont pas les mêmes qu'une écriture en base.
export interface AgentCapabilities {
  actionScopes: string[];
  /** fetch_url — récupération d'une page web publique. */
  webFetch: boolean;
  /** Lecture de la messagerie connectée (Gmail, Outlook ou IMAP). */
  mailRead: boolean;
  /** Envoi de mail. Palier distinct de la lecture, jamais implicite. */
  mailSend: boolean;
  /** read_email_attachment — ouvrir et extraire le contenu d'une pièce
   *  jointe d'un email déjà lu. Palier distinct de la lecture, comme
   *  mailSend/docsWrite : ouvrir une pièce jointe télécharge des octets
   *  externes et peut déclencher un OCR, plus coûteux qu'une lecture de
   *  corps de message, et mérite d'être activé sciemment. */
  mailAttachments: boolean;
  /** Modules cartographiques : adresse, cadastre, PLU, risques, monuments. */
  geo: boolean;
  /** Lecture du CCTP et du DPGF d'un projet. */
  docsRead: boolean;
  /** write_dpgf_article — créer ou modifier un article du CCTP/DPGF d'un
   *  projet (texte technique et/ou ligne chiffrée). Palier distinct de la
   *  lecture, jamais implicite : mêmes principes que mailSend/mailRead.
   *  Sans elle, un agent n'a AUCUN moyen d'écrire un CCTP ou un DPGF —
   *  AGENT_RESOURCES n'a plus de ressource 'specifications' vers laquelle
   *  se replier depuis son retrait du système (voir CLAUDE.md). */
  docsWrite: boolean;
  /** consulter_agent — interroger un collègue (autre agent actif du cabinet)
   *  et recevoir sa réponse dans le même tour. Un seul niveau : un agent
   *  consulté ne peut pas lui-même en consulter un autre (voir routes.ts,
   *  en-tête X-Agent-Delegation). */
  delegate: boolean;
  /** publier_flux_activite — poster dans Notifications & Flux d'activité en
   *  mentionnant une personne du cabinet, pour la prévenir sans passer par
   *  la conversation privée entre l'utilisateur et l'agent. */
  notifyUsers: boolean;
  /** Recherche web en temps réel, via le tool natif du fournisseur IA actif
   *  (google_search chez Gemini, web_search chez Claude) — jamais une de nos
   *  propres déclarations de fonction, donc jamais une entrée de
   *  buildAgentTools()/executeAgentAction() comme les autres capacités
   *  ci-dessus. Reflète uniquement la colonne : si le cabinet fait tourner
   *  ses agents sur Mistral, qui ne l'expose pas hors de son API
   *  Conversations, routes.ts n'active le tool que quand
   *  LlmProvider.supportsWebSearch est vrai — voir mistral.ts. */
  webSearch: boolean;
  /** Bibliothèque de connaissances propre à cet agent (documents.resource_type
   *  = 'agents', voir migrate_agent_knowledge.sql) : réglementation, DTU,
   *  notices déposées par l'architecte via ResourceAttachments sur la fiche
   *  agent. Contrairement aux documents joints à un message, ces documents
   *  sont auto-injectés à chaque tour, comme firm_knowledge — pas de tool à
   *  appeler, pas de condition de context_scopes (voir buildAgentContext). */
  knowledge: boolean;
}

export function capabilitiesFromAgent(agent: {
  action_scopes?: string[] | null;
  web_fetch_enabled?: boolean | null;
  mail_enabled?: boolean | null;
  mail_send_enabled?: boolean | null;
  mail_attachments_enabled?: boolean | null;
  geo_enabled?: boolean | null;
  docs_read_enabled?: boolean | null;
  docs_write_enabled?: boolean | null;
  delegate_enabled?: boolean | null;
  notify_users_enabled?: boolean | null;
  web_search_enabled?: boolean | null;
  knowledge_enabled?: boolean | null;
}): AgentCapabilities {
  return {
    actionScopes: agent.action_scopes || [],
    webFetch: !!agent.web_fetch_enabled,
    mailRead: !!agent.mail_enabled,
    // L'envoi suppose la lecture : un agent qui ne voit pas la boîte n'a
    // aucun contexte pour écrire à quelqu'un en son nom.
    mailSend: !!agent.mail_enabled && !!agent.mail_send_enabled,
    // Même invariant que mailSend : ouvrir une pièce jointe sans pouvoir lire
    // la messagerie n'a pas de sens (elle vient toujours d'un message déjà lu).
    mailAttachments: !!agent.mail_enabled && !!agent.mail_attachments_enabled,
    geo: !!agent.geo_enabled,
    docsRead: !!agent.docs_read_enabled,
    // Même invariant que mailSend : écrire sans lire n'a pas de sens (un
    // agent ne peut pas ajouter un article cohérent à un document qu'il ne
    // consulte pas) et le serveur le refuserait de toute façon (PUT
    // /api/agents/:id applique le même ET).
    docsWrite: !!agent.docs_read_enabled && !!agent.docs_write_enabled,
    delegate: !!agent.delegate_enabled,
    notifyUsers: !!agent.notify_users_enabled,
    webSearch: !!agent.web_search_enabled,
    knowledge: !!agent.knowledge_enabled,
  };
}

export interface Agent {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  role_title: string;
  avatar_initials: string;
  avatar_color: string;
  tone?: string;
  directives?: string;
  system_prompt_override?: string;
  context_scopes: AgentContextScope[];
  action_scopes: AgentActionScope[];
  web_fetch_enabled: boolean;
  mail_enabled: boolean;
  mail_send_enabled: boolean;
  mail_attachments_enabled: boolean;
  geo_enabled: boolean;
  docs_read_enabled: boolean;
  docs_write_enabled: boolean;
  delegate_enabled: boolean;
  notify_users_enabled: boolean;
  web_search_enabled: boolean;
  knowledge_enabled: boolean;
  is_active: boolean;
  is_system_template: boolean;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  conversation_id: string;
  tenant_id: string;
  role: 'user' | 'assistant';
  content: string;
  artifact?: AgentArtifact;
  created_at: string;
}

export interface AgentArtifact {
  type: 'excel' | 'docx' | 'csv' | 'pdf';
  filename: string;
  data: string; // base64
  mimeType: string;
}

export interface AgentTokenUsage {
  id: string;
  tenant_id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  tokens_used: number;
  cost_eur_cents?: number;
  created_at: string;
}

export interface AgentChatResponse {
  reply: string;
  tokens_used: number;
  remaining_balance: number;
  artifact?: AgentArtifact;
  /** Les collègues consultés pendant ce tour (consulter_agent), dans l'ordre
   *  où la consultation a eu lieu. Le client s'en sert pour ouvrir la
   *  conversation du collègue et montrer sa réponse, déjà enregistrée dans
   *  sa propre conversation avec l'utilisateur. */
  consulted?: { id: string; name: string }[];
}

// Internal server-side types
export interface AgentRow {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  role_title: string;
  avatar_initials: string;
  avatar_color: string;
  tone?: string;
  directives?: string;
  system_prompt_override?: string;
  context_scopes: string[];
  action_scopes: string[];
  web_fetch_enabled: boolean;
  mail_enabled: boolean;
  mail_send_enabled: boolean;
  mail_attachments_enabled: boolean;
  geo_enabled: boolean;
  docs_read_enabled: boolean;
  docs_write_enabled: boolean;
  delegate_enabled: boolean;
  notify_users_enabled: boolean;
  web_search_enabled: boolean;
  knowledge_enabled: boolean;
  is_active: boolean;
  is_system_template: boolean;
}

export interface AgentContext {
  tenantName: string;
  currentDate: string;
  currentUserName: string;
  projects: { id: string; name: string; status: string; client: string; start_date: string; end_date: string }[];
  contacts: { id: string; first_name: string; last_name: string; company_name: string; email: string }[];
  upcomingMeetings: { id: string; title: string; date: string; project_id: string }[];
  recentDocuments: { id: string; name: string; project_id: string; phase: string; uploaded_at: string; file_url: string }[];
  tasks: { id: string; title: string; status: string; due_date: string; project_id: string }[];
  documentContents: { id: string; name: string; content: string }[];
  /**
   * Pièces jointes photographiées ou scannées, transmises au modèle comme
   * de vraies images (vision native) plutôt que comme du texte reconstitué
   * par OCR — voir buildAgentContext() dans context.ts. Une photo n'est pas
   * un document scanné à plat : Tesseract (OCR) y produit un texte
   * incohérent qu'un modèle laissé libre "corrige" en une donnée plausible
   * mais fausse, jamais confrontée aux pixels réels. Vide quand le
   * fournisseur actif ne sait pas lire d'image (LlmProvider.supportsVision) ;
   * ces pièces retombent alors sur l'OCR classique dans documentContents.
   */
  documentImages: { id: string; name: string; mimeType: string; data: Buffer }[];
  /**
   * Les autres agents actifs du cabinet (jamais l'agent lui-même), avec ce
   * qu'ils sont autorisés à écrire — pour qu'un agent sache vers qui
   * rediriger une demande qui n'est pas de son ressort au lieu de
   * l'improviser avec le mauvais outil (voir l'incident du 7 septembre 2026 :
   * un agent avait créé des CCTP vides pour une demande de bibliothèque
   * d'ouvrages, faute de savoir qu'un collègue avait le bon outil).
   * Toujours peuplé, sans condition de context_scopes : connaître les
   * collègues du cabinet n'expose aucune donnée métier.
   */
  colleagues: { id: string; name: string; roleTitle: string; resourceLabels: string[] }[];
  /**
   * Les personnes du cabinet (profils utilisateurs), pour qu'un agent
   * mentionne la bonne personne dans le flux d'activité (publier_flux_activite)
   * au lieu d'inventer un nom : la mention n'y fonctionne que sur une
   * correspondance exacte avec `profiles.name` (voir activityFeed.ts). Comme
   * `colleagues`, toujours peuplé : ce sont des noms, pas une donnée métier.
   */
  teamMembers: { id: string; name: string }[];
  firmKnowledge: {
    phaseBenchmarks: { phase: string; avgDurationDays: number; sampleSize: number }[];
    priceCatalog: { designation: string; unite: string; prix_unitaire: number; categorie: string | null }[];
    projectCostHistory: { designation: string; unite: string; avgPrixUnitaireHt: number; occurrences: number }[];
    cctpExcerpts: { title: string; excerpt: string }[];
  };
  /**
   * Bibliothèque de connaissances propre à cet agent (réglementation, DTU,
   * notices déposées via ResourceAttachments sur documents.resource_type =
   * 'agents') — voir capabilities.knowledge et migrate_agent_knowledge.sql.
   * Auto-injecté à chaque tour comme firmKnowledge, jamais via un tool.
   */
  knowledgeDocuments: { title: string; excerpt: string }[];
}
