---
paths:
  - "src/pages/ProjectDetail.tsx"
  - "src/pages/Projects.tsx"
  - "src/pages/Dashboard.tsx"
  - "src/pages/ManagerDashboard.tsx"
  - "src/components/ProjectOverview.tsx"
  - "src/components/ProjectTabBar.tsx"
  - "src/components/projectDetail/**"
  - "src/components/dashboard/**"
  - "src/hooks/useProjectAutosave.ts"
  - "src/lib/projectTabs.ts"
  - "src/lib/motion.ts"
  - "src/lib/dashboard*.ts"
  - "src/index.css"
---

# Interface : fiche affaire, tableaux de bord, mouvement

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Projets ouverts récemment et jalons de mission

**Classement par défaut de `/projects`** : les affaires ouvertes le plus
récemment PAR LA PERSONNE CONNECTÉE en tête. `project_recent_views` (même
migration que ci-dessus, une ligne par couple personne × projet) est écrite
par `GET /api/projects/:id/full` (`recordProjectOpened`, meilleur effort) et
relue par `GET /api/projects` sous `last_opened_at` (`attachLastOpenedAt`,
`server/projectRecentViews.ts`). Stocké côté serveur et non dans le
navigateur pour que le classement suive la personne d'un poste à l'autre.
Un tri explicite du sélecteur remplace ce classement ; sans historique, la
liste garde l'ordre de l'API.

**Jalons en double.** `ProjectDetail.tsx` synchronise les jalons du projet
avec les missions du contrat MOE lié (un jalon par mission incluse, apparié
par titre). L'effet se déclenchait dès l'arrivée du contrat, alors que la
liste des jalons n'était pas encore lue en base — il recréait donc tous les
jalons de mission à chaque ouverture de la fiche. Il attend désormais
`milestonesLoaded`, garde en mémoire les créations en cours
(`milestoneCreationsInFlight`) et supprime les doublons laissés par l'ancien
comportement (pour une même mission, seul le jalon coché ou à défaut le plus
ancien est conservé). À ne pas défaire : un effet qui lit `milestones` sans
attendre qu'ils soient chargés recrée le bug.

**Stepper de mission sans historique de phase.** Sans ligne dans
`project_phase_history`, la fiche affiche déjà « Phase ESQ » : le stepper de
l'en-tête (et celui de la fiche complète) prend la première phase affichée
comme phase en cours plutôt que de ne rien marquer.

### Fiche affaire : enregistrement automatique et facture d'une note

**Plus de bouton Enregistrer.** La fiche (aperçu, fiche complète, champs
HONOS) s'enregistre seule, comme les notes, avenants, jalons et la
consultation ACT : `useProjectAutosave` (`src/hooks/useProjectAutosave.ts`)
envoie la fiche 1,2 s après la dernière frappe, chaîne les écritures (c'est la
fiche du moment de l'envoi qui part, une frappe pendant un envoi en déclenche
un autre), réessaie 5 s après un échec et envoie la fiche en attente au départ
de l'écran ou à la fermeture de l'onglet (`pagehide`, `keepalive` sous 64 Ko).
`isProjectDirty()` (`src/lib/projectDirty.ts`, testé) compare la fiche
affichée à la dernière version chargée ou enregistrée (`savedProject`) ; rien
ne part avant la lecture de la fiche. L'en-tête montre « Enregistrement… » puis
« Enregistré », ou « Échec de l'enregistrement » avec « Réessayer »
(`AutosaveIndicator.tsx`). Une fiche dont le nom a été vidé n'est pas envoyée
(`canAutosaveProject`). Ctrl+S envoie tout de suite. `useUnsavedChangesGuard`
ne prévient plus avant de quitter qu'en cas d'échec ou de nom manquant. Sous
`BrowserRouter`, `useBlocker` n'existe pas : un `navigate()` programmatique
doit passer par `confirmDiscard()`. Les montants repris du contrat lié
(`remuneration`, `construction_cost`) ne comptent pas comme une saisie.

**L'enregistrement n'envoie jamais les listes rattachées**
(`projectSavePayload` retire `lots_list`, `cotraitants_list`,
`stakeholders_list`, `categories_list`), et `PUT /api/projects/:id` ne
remplace une liste que si le corps la porte (`replaceList`,
`server/routes/projects.ts`, `tests/projectUpdateLists.test.ts`). Une ligne
déjà existante y garde son identifiant et ses autres colonnes. Avant ce
correctif, chaque enregistrement de la fiche recréait les lots avec un nouvel
identifiant et sans leurs montants (`base_amount`...), ce qui détachait les
visas (`lot_id`), les marchés et le DPGF (`projectLotId`).

Générer la facture brouillon d'une note se confirme montant HT et TTC sous les
yeux, et se conclut par un toast « Ouvrir la facture » (`/invoices?open=<id>`)
; « Facture créée » est un lien. `saveNote` garde le formulaire ouvert tant que
le serveur n'a pas confirmé. Les `alert()` de la fiche sont des toasts
(`useToastWithUndo`).

### Fiche affaire : onglets regroupés et onglet dans l'adresse

Les dix onglets de la fiche (INFOS, TACHES, HONOS, PRO, ACT, VISA, DET, RDT,
AOR, CORRESPONDANCE) gardent leurs identifiants et leur contenu, mais la barre
(`ProjectTabBar.tsx`, logique pure dans `src/lib/projectTabs.ts`, testée) les
présente en sept familles au plus : Infos, Tâches, Honoraires, Études (PRO),
Consultation (ACT), Chantier, Correspondance. Les quatre missions de chantier
passent en second niveau sous « Chantier », sigle MOP et nom complet ; revenir
sur une famille rouvre la mission qu'on y consultait. Une famille sans onglet
visible disparaît (hors mission chantier, cinq entrées). `PillTabs` porte
désormais les rôles ARIA d'onglets et la navigation aux flèches.

L'onglet ouvert vit dans `?tab=` (sauf INFOS, le défaut), écrit en
`replace` pour ne pas empiler l'historique : il survit au rechargement et au
retour depuis un autre écran. L'état initial est lu dans l'adresse dès le
premier rendu (sinon l'écriture de l'onglet par défaut effacerait le
paramètre avant sa lecture) ; un identifiant inconnu retombe sur INFOS. Les
liens existants (`?tab=TACHES`, liens d'agent `?tab=&open=`) restent valides.
Le stepper de phases de l'en-tête est nommé (« Phases de mission ») : une
pastille affiche le journal de sa phase (voir ci-dessous), le bouton « Passer
en {phase suivante} » à sa droite fait avancer la phase réelle après
confirmation.

Finitions de la même fiche, à conserver : les fenêtres (VISA, accusé de
réception d'OS, suppression de l'affaire) partagent le même voile
`bg-black/50`, portent `role="dialog"` et se ferment à Échap
(`useEscapeKey`, sauf pendant un enregistrement ou une suppression) ; les
actions révélées au survol (`opacity-0 group-hover:opacity-100`) restent
visibles au doigt (`pointer-coarse:`) et au clavier (`focus-within:`) ; les
lignes de groupe VISA et DOE se déplient par un vrai bouton (`aria-expanded`) ;
les jalons de l'aperçu sont des cases (`role="checkbox"`). Les couleurs de
l'aperçu et du badge MAF passent par les jetons `--tblr-*`, jamais par des hex
figés qui ignorent le thème sombre.

**Plus aucun `window.confirm()` dans la fiche.** Deux régimes :

- **Suppression annulable** (note d'honoraires, avenant, OS, permis) :
  `deleteWithUndo()` retire l'élément tout de suite et affiche « Annuler »
  pendant 6 s ; la requête `DELETE` ne part qu'ensuite
  (`UndoableDeleteQueue`, `src/lib/undoableDelete.ts`, testée ;
  `useUndoableDelete`). Une seule suppression en attente : en lancer une
  autre envoie la première. Quitter l'écran ou fermer l'onglet (`pagehide`,
  requête en `keepalive`) envoie la suppression en attente, jamais ne
  l'oublie. Un refus du serveur remet l'élément à sa place, avec un message.
- **Confirmation dans l'application** (`useConfirmDialog`,
  `src/components/ui/ConfirmDialog.tsx`, `role="alertdialog"`, Échap, focus
  tenu, focus initial sur « Annuler » pour une suppression) : jalons (que la
  synchronisation avec le contrat recrée, d'où pas d'annulation différée),
  RFI, visas, PV, réserves, documents DOE et plans, dont la suppression
  emporte souvent un fichier. La facture d'une note s'y confirme aussi, avec
  un récapitulatif HT, TVA et TTC.

### Fiche affaire : textes et libellés

Tous les textes de la fiche (`ProjectDetail.tsx`, `ProjectOverview.tsx`)
passent par i18next (`projectdetail_*`, `project_overview_*`), sauf le contenu
des PDF générés (OS, avenant, PV de réception) : ce sont des pièces
contractuelles françaises remises au maître d'ouvrage, volontairement non
traduites. Quatre règles à garder :

- **Une valeur stockée en français reste stockée telle quelle**, seul son
  affichage se traduit : statuts de note (`NOTE_STATUS_KEYS`), de réserve
  (`reserveStatusKey`, `src/components/pro/reserveShared.tsx`), d'affaire
  (`projects_status_*`), d'autorisation d'urbanisme (`project_permit_status_*`).
  Les noms de phase de la mission ont une seule source (`mission_phase_<CODE>`,
  vocabulaire de la loi MOP : APD = avant-projet définitif).
- **Un même cycle de statuts n'a pas les mêmes mots partout** :
  `osStatusBadge(status, 'os' | 'avenant')`, un OS approuvé a son accusé de
  réception, un avenant est accepté. Visas et DOE disent l'avis du maître
  d'œuvre (favorable, avec observations, défavorable), jamais « validé ».
- **Chaque champ a un libellé relié** (`htmlFor`/`id`, `FormField` le fait
  seul avec `useId`), chaque bouton icône un `aria-label` qui nomme son objet.
- **« Honoraires » dans le plan d'actions de l'aperçu mène à l'onglet HONOS**
  (notes d'honoraires de l'agence), toujours actif. Il menait aux « factures
  entreprises » de RDT et n'était actif qu'en mission chantier. RDT ne porte
  plus aucune facture de l'agence : voir « Situations de travaux et
  certificats de paiement ». Les montants de l'aperçu et de la fiche complète
  sont en lecture seule dès qu'un contrat est rattaché, comme dans HONOS.

### Fiche affaire sur téléphone et tablette

Vérifiée en 390, 820 et 1366 px. Règles à garder :

- **En-tête** : retour, titre (tronqué), supprimer et état d'enregistrement
  sur une seule ligne ; le stepper de phases prend toute la ligne suivante.
- **Barres défilantes** (familles d'onglets, missions de chantier, stepper) :
  `useHorizontalScrollHints` ramène l'élément actif dans le champ (en réglant
  `scrollLeft`, jamais `scrollIntoView`, qui ferait défiler la page) et pose
  `data-fade-start`/`data-fade-end` ; la classe `.scroll-fade-x` estompe le bord
  où du contenu est caché. Sans cela, la famille « Chantier » ouverte restait
  hors de l'écran.
- **`CardHeader`** passe l'action sous le titre quand la largeur manque (le
  titre garde 14rem) au lieu de tronquer le titre à trois lettres.
- **`StatTile`** : montant en `text-lg` sous 640 px, pour qu'un « 48 000,00 € »
  tienne dans une demi-largeur de téléphone.
- **Message vide d'un tableau plus large que l'écran** : `.table-empty-message`
  (collant à gauche) au lieu d'un texte centré sur toute la largeur, donc coupé.
- **RDT** : liste de situations touchable sous 768 px, tableau au-delà (référence
  et cumul admis à partir de 1024 px) ; la saisie ligne à ligne ne défile dans son
  cadre qu'au bureau (pas de défilement dans le défilement sur téléphone).
- **`<html lang>`** suit la langue de l'interface (`src/i18n.ts`) : il valait
  `en` en permanence, d'où une lecture d'écran et une césure anglaises.
- Un jalon sans date n'est plus pris pour la prochaine échéance (« Invalid Date »).

### Journal de l'opération (notes de phase)

Les observations de la fiche étaient deux champs (`etudes_notes`,
`chantier_notes`) partagés par toutes les phases : la note d'APS était écrasée
par celle de l'APD. `project_phase_notes` (`supabase/migrate_project_phase_notes.sql`,
hors `SYNC_TABLES`) porte une entrée datée par évènement : phase MOP, type
(`observation`, `programme`, `budget`, `decision_moa`, `attention`), auteur,
et pour un budget l'estimation des travaux avant ET après (écart en € et en %
calculé, `budgetDelta`, `src/lib/phaseJournal.ts`, testé). Routes
`server/routes/projectPhaseNotes.ts` (`GET/POST /api/projects/:id/phase-notes`,
`PUT/DELETE /api/phase-notes/:noteId`, `tests/projectPhaseNotes.test.ts`) ;
une instance sans la table lit un journal vide et refuse l'écriture en 503,
sans casser la fiche.

`PhaseJournal.tsx` remplace le champ Observations en tête de la colonne C de
l'aperçu ; Objet et Programme restent des champs de l'affaire, sous le
journal. Le stepper de l'en-tête porte un compteur par phase, rouge quand une
note de la phase est un dépassement de budget ; une pastille ouvre le journal
de sa phase, « Passer en … » (confirmé) appelle `POST /api/projects/:id/phase`.
`missionPhases` (`ProjectDetail.tsx`) est la seule liste des phases de la
mission, partagée par les deux steppers et le journal.

La migration reprend les anciennes observations en entrées `legacy-etudes-<id>`
/ `legacy-chantier-<id>` (identifiants déterministes, rejouable) sur la
dernière phase connue de la famille ; les colonnes ne sont pas supprimées.
Tant qu'aucune entrée `legacy-` n'est lue, l'aperçu montre ces anciennes
observations en lecture seule : une instance non migrée ne les perd pas de vue.

### Tableaux de bord : un bloc opérationnel, deux périmètres

`src/components/dashboard/OperationalKpis.tsx` (calcul pur dans
`src/lib/dashboardOps.ts`, testé) porte les KPI de suivi : permis actifs,
échéances à 30 jours, tâches en cours, réunions de la semaine, RFI en attente,
réserves OPR et GPA. Chaque carte signale ses retards (« Aucun retard » sinon).
Seul le **périmètre** diffère :

- **Administrateur** (`Dashboard.tsx`) : `scopeProjectIds={null}`, toute
  l'agence. Les cartes « Affaires en cours » et « Échéances » existent déjà dans
  sa grille, donc `omit={['projects', 'deadlines']}`. Il est aussi le seul à
  voir le commercial (devis en attente, appels d'offres).
- **Manager** (`ManagerDashboard.tsx`) : les affaires de son équipe uniquement.
  Sa finance tient en trois cartes (encaissé, reste à encaisser, factures en
  retard) calculées avec les mêmes helpers que l'administrateur
  (`dashboardMetrics.ts`) ; le budget estimé n'a plus de carte, il figure déjà
  sur le graphique honoraires consommés vs prévus.

Une date absente ou illisible n'est jamais comptée comme un retard.

**Panneau d'accueil commun** (`RoleHero.tsx`, contenu pur dans
`src/lib/dashboardHero.ts`, testé) : la même carte « Bonjour {prénom} » pour
tous, mais un message par profil. L'administrateur lit l'encaissé du mois et
les factures en retard de l'agence ; le manager les mêmes chiffres pour son
équipe ; un collaborateur (`pm`, `user`) ce qui l'attend sur SES affaires
(points en retard, affaires en cours, réunions de la semaine) et **jamais de
chiffre de facturation**. Pour le manager et le collaborateur, le panneau
attend les chiffres du suivi (`OperationalKpis` `onKpis`) : afficher « rien en
retard » avant leur lecture serait faux. `ResponsibleDashboard` (collaborateur)
utilise désormais le même `OperationalKpis`, limité à ses affaires.

### Mouvement, gestes et préférences d'accessibilité

Les animations suivent les principes d'interface fluide d'Apple, sans toucher
à l'identité Tabler (couleurs, bordures, rayons) : seul le mouvement change.

- **Ressort par défaut, jamais une durée fixe.** `src/main.tsx` enveloppe
  l'application dans `<MotionConfig reducedMotion="user" transition={DEFAULT_SPRING}>`.
  Les réglages partagés (`DEFAULT_SPRING`, `PANEL_SPRING`, `FLICK_SPRING`,
  `projectMomentum()`) vivent dans `src/lib/motion.ts` : `bounce: 0` par
  défaut, un léger rebond seulement quand un geste a lancé l'élément.
- **« Réduire les animations » est respecté** : Motion ne garde alors que les
  fondus (`reducedMotion="user"`), et `src/index.css` coupe `animate-pulse` et
  l'enfoncement des boutons. `prefers-reduced-transparency` retire les flous,
  `prefers-contrast: more` renforce bordures et textes secondaires.
- **Les modales naissent de leur déclencheur.** `launchOriginRef`
  (`src/lib/launchOrigin.ts`) pose le `transform-origin` d'une modale sur le
  dernier point d'appui. Une nouvelle modale animée en `scale` le reçoit par
  `ref={launchOriginRef}` (référence stable, calculée une fois au montage).
- **Retour à l'appui, survol réservé à la souris.** `.btn:active` s'enfonce en
  50 ms ; les `:hover` de `.btn-*` sont sous `@media (hover: hover)`, comme la
  variante `hover:` de Tailwind 4, pour ne pas rester affichés sur tablette.
- **Panneaux qu'on referme d'un geste** : le menu mobile
  (`src/components/MobileNavDrawer.tsx`) et, sur téléphone, la fiche de
  réserve (`ReserveDetail.tsx`, glissée par son en-tête). Le panneau suit le
  doigt 1:1, résiste au-delà de sa butée, et la décision au relâché se prend
  sur le point d'arrivée PROJETÉ (`projectMomentum`), pas sur la position du
  doigt ; le ressort de retour repart de la vitesse du geste.
- **Hauteurs d'écran en `dvh`**, jamais `100vh`/`h-screen` pour une mise en
  page : sur Safari iOS, `100vh` inclut la barre d'adresse et coupe le bas.
- **Glisser-déposer au pointeur, jamais en HTML5 natif** (`draggable`,
  `onDragStart`...), qui ne suit pas le doigt sur téléphone. Kanban et
  calendrier passent par `useDragToZone` (`src/hooks/useDragToZone.ts`), le
  planning (Gantt) par `useBarDrag` ; les deux s'appuient sur
  `startPressDrag` (`src/lib/pressDrag.ts`) : à la souris le glisser démarre
  après quelques pixels, au doigt après un appui de 220 ms (un doigt qui bouge
  avant fait défiler la page), Échap annule, et le clic qui suit un glisser
  est avalé. Une copie soulevée suit le pointeur 1:1 depuis le point saisi ;
  au relâché, `onDrop` doit mettre à jour l'état **de façon optimiste et
  synchrone** (il est appelé dans un `flushSync`) pour que la copie puisse
  rejoindre la nouvelle place de l'élément. `project: true` (Kanban) choisit
  la colonne sur le point projeté du geste ; pas sur une grille serrée comme
  les jours d'un mois. Une tâche déposée va en bas de sa colonne : l'ordre à
  l'intérieur d'une colonne n'est pas enregistré.
- **Pas d'apparition en cascade sur les pages de travail** (liste des
  affaires, équipe, notifications) : elle rejouait à chaque visite d'une page
  consultée des dizaines de fois par jour. Réservée aux moments rares
  (page d'accueil publique). Les ajouts discrets restent : arrivée d'un
  nouveau message dans le chat des agents (seulement s'il date de moins de
  4 s, jamais l'historique rechargé), étapes de l'accueil qui glissent dans
  le sens du parcours, libellés « Enregistré » en fondu (`SwapText`,
  `src/components/ui/SwapText.tsx`).
- **Couche plateforme mobile** (`index.html`, `src/index.css`, bloc
  « Téléphone et tablette ») : `viewport-fit=cover` (sans lui, tous les
  `env(safe-area-inset-*)` valent 0 : la barre de raccourcis mobile passait
  sous l'indicateur d'accueil), en-tête et menu mobile rembourrés par les
  insets ; champs à 16 px sous `(pointer: coarse)` pour qu'iOS ne zoome pas
  (jamais `maximum-scale=1`) ; `overscroll-behavior: none` sur la racine ;
  `touch-action: manipulation` et `user-select: none` sur les contrôles seuls ;
  hauteurs en `dvh` (modales) ou `svh` (pages de connexion). `theme-color` suit
  le thème APPLIQUÉ (`theme-provider.tsx`), posé par classe et non par le
  réglage système.
- **Typographie : 11 px minimum, tailles en `rem`.** Les tailles arbitraires
  s'écrivent `text-[0.6875rem]` et non `text-[11px]`, pour suivre la taille de
  texte choisie dans le navigateur (le corps est à `0.875rem`) ; 10 px n'est
  toléré que dans une pastille de taille fixe (initiales dans un cercle
  `w-5 h-5`). `--tracking-wider` est ramené à 0,03 em dans `@theme`, et `h1`/
  `h2` sont légèrement resserrés. Les majuscules et couleurs Tabler restent.
