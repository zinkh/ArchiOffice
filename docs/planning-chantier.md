# Planning des entreprises (Chantier > DET > Planning)

Ce planning appartient à l’affaire et reste indépendant des tâches internes du cabinet.

## Affichage

« Affichage et exports » permet de choisir les semaines ou les mois, les dates calendaires ou relatives, les numéros ISO et la visibilité des tâches générales. Chaque groupe se replie ; les deux actions globales sont disponibles. Les préférences sont locales à l’appareil, indexées par cabinet, utilisateur et affaire. Aucun réglage d’affichage ne modifie le planning partagé.

S1 et M1 commencent au premier jour du planning complet, y compris si cette tâche est masquée. Les semaines relatives durent sept jours à partir de cette date, sans alignement implicite au lundi. Les mois relatifs conservent le jour de référence, rabattu au dernier jour des mois courts (31 janvier → 28/29 février → 31 mars). Les semaines calendaires utilisent le lundi et l’année ISO, qui peut différer de l’année civile. Tous les calculs des dates AAAA-MM-JJ utilisent UTC. Les dates des interventions restent réelles en base.

## Couleurs et dépendances

La lecture du planning récupère la table des couleurs des réserves AOR de cette affaire, calculée par `reserveCouleurs.ts`. La première entreprise responsable prime, sinon l’intitulé du lot ; normalisation identique à l’AOR. Pour plusieurs titulaires rapprochés d’un lot, le premier nom du résumé ` / ` sert de responsable de couleur. Les responsables absents de l’AOR utilisent la même palette, calculée sur tous les lots du planning. Les tâches générales sont grises. L’AOR conserve son attribution existante : ajouter une entreprise aux réserves peut modifier les couleurs par ordre alphabétique, comme auparavant. Les réserves GPA ont leur propre population et peuvent donc avoir une table différente.

Les prédécesseurs sont sélectionnés dans la fiche d’une tâche (tous lots et jalons). Ils sont stockés dans `dependencies?: string[]` du JSON existant, comme pour le modèle des tâches internes. Le seul type est fin à début, sans décalage : la fin étant inclusive, le successeur commence au plus tôt le lendemain. À l’ajout d’un prédécesseur, la tâche est placée au lendemain de la fin la plus tardive de tous ses prédécesseurs, en conservant sa durée. Les dates restent ensuite librement modifiables ; retirer un lien ou modifier un prédécesseur ne déclenche aucun recalcul en cascade, sauf si le réglage « Décaler les successeurs » est activé (voir plus bas ; il est désactivé par défaut). Une alerte explicite signale les dates incohérentes sans imposer de correction. Le serveur refuse les cycles et les liens vers soi-même avant écriture. L’assainissement partagé retire les références disparues après suppression ou remplacement IA. Les anciens plannings sans ce champ restent valides.

Les liaisons visibles sont tracées sur le diagramme (pointillés en cas de conflit). La liste textuelle de toutes les liaisons reste accessible ; le résumé compte celles dont une tâche est masquée ou repliée. L’avancement et l’état sont également écrits en texte.

## Exports et compatibilité

- **PDF** : applique l’échelle, le calendrier relatif ou réel, les numéros ISO, les couleurs et la visibilité des tâches générales. Tous les lots sont toujours dépliés à l’export ; ce périmètre est annoncé près des réglages et dans le document. L’export individuel par lot reste disponible. Les dépendances figurent dans une liste, avec mention des délais, des prédécesseurs hors périmètre et des dates incohérentes ; elles sont aussi tracées en flèches quand les deux tâches sont sur la même page (voir « Export PDF : dépendances, synthèse, retard et indice »).
- **Microsoft Project XML** et **GanttProject XML (.gan)** : exportent le planning complet, indépendamment du repli et des filtres, avec les dates réelles. L’adaptateur `planningChantierXml.ts` appelle les exporteurs existants ; il ajoute des groupes récapitulatifs par lot et pour les tâches générales. Les identifiants numériques sont uniques dans chaque fichier, et toutes les références utilisent la même table. Une tâche ordinaire d’un jour reste distincte d’un jalon. Les liens fin à début, noms, dates et pourcentages sont conservés.
- Les exporteurs communs acceptent des métadonnées hiérarchiques et une option de calendrier de sept jours. Cette option est activée pour le chantier, dont les durées sont calendaires ; les exports des tâches internes gardent leurs valeurs par défaut. Le XML MS Project contient un calendrier explicite et des tâches manuelles pour conserver les dates. Le calendrier GanttProject suit la structure de l’exemple officiel `bardsoftware/ganttproject/ganttproject-builder/HouseBuildingSample.gan`.
- Les tests relisent les deux fichiers par `parsePlanningXml`, vérifient dates, avancements, jalons, dépendances et hiérarchie. L’import générique existant importe les groupes comme des tâches ordinaires ; il n’offre pas encore de reconstruction des lots dans le planning chantier. Il n’existe pas d’import chantier dans cette livraison.
- MS Project et GanttProject ne sont pas installés dans l’environnement de validation : l’ouverture et les éventuelles décisions de recalcul propres à ces applications restent à vérifier. Les couleurs sont exportées dans GanttProject ; le format MS Project employé ne porte pas de couleur des barres. Les hypothèses IA ne sont pas des tâches et ne sont pas exportées en XML.

## Décalage automatique des successeurs

Réglage « Décaler les successeurs » sous « Affichage et exports », **désactivé par défaut** : sans lui, rien ne change par rapport à avant (aucun recalcul en cascade, simple alerte de dates incohérentes). Il est local à l'appareil, par cabinet, personne et affaire, comme les autres préférences ; il n'ajoute aucun champ au planning partagé et ne demande aucune migration.

Quand il est actif, un changement de dates déclenche `decalerSuccesseurs` (`src/lib/planningChantier.ts`, pure et testée) :

- il s'applique à un déplacement ou une poignée sur le diagramme, aux flèches du clavier, à l'enregistrement de la fiche d'une tâche dont les dates ont changé, et à la création d'un lien (la tâche cible est placée après son prédécesseur, puis ses propres successeurs suivent) ;
- seuls les successeurs directs et indirects de la tâche modifiée sont examinés : un conflit existant ailleurs n'est jamais touché ;
- un successeur est **reculé** uniquement si son début précède le lendemain de la fin la plus tardive de ses prédécesseurs (fin inclusive), et il garde sa durée ; un jalon reste sur un jour ;
- un successeur n'est **jamais avancé** : rapprocher un prédécesseur ne ramène pas ses successeurs, qui gardent leur marge ;
- une tâche **terminée** (100 %) n'est jamais déplacée : elle est signalée (« tâche(s) terminée(s) non déplacée(s) ») et l'alerte de dates incohérentes reste ;
- les tâches décalées passent en `manuel`, comme après toute modification de dates, et sont enregistrées dans la même écriture que la tâche modifiée ;
- pendant un geste, le message d'aperçu annonce le nombre de successeurs qui seront décalés ; seul le relâché enregistre, Échap annule tout ;
- le décalage compte des jours calendaires, ou des jours ouvrés quand le calcul en jours ouvrés est actif (voir plus bas) ; les délais des liens sont respectés ;
- le message qui annonce le décalage rappelle que Ctrl+Z l'annule (voir « Annuler et rétablir »).

**Aperçu visuel** : pendant le glisser, chaque successeur que le relâché décalerait montre un **fantôme** en pointillés (couleur du lot, fond translucide) à sa future position, avec le décalage en jours (« +12 j »). La barre réelle reste en place jusqu'au relâché ; le fantôme disparaît au relâché, à Échap ou en cas d'interruption, et rien n'est écrit tant que le geste n'est pas validé. Le calcul de l'aperçu est celui du relâché (`decalerSuccesseurs`, délais et jours ouvrés compris). Sans le réglage « Décaler les successeurs », aucun fantôme.

### Rapprocher aussi les successeurs

Case « Rapprocher aussi quand une tâche avance » sous « Décaler les successeurs » (local à l'appareil, désactivée par défaut, inactive tant que le décalage ne l'est pas). Quand une tâche **avance**, ses successeurs avancent de la même quantité **en gardant leur marge**, au lieu de rester en place.

- On compare la contrainte d'avant et d'après l'action : début minimal permis par les prédécesseurs (fin + délai du lien, jours ouvrés compris). Si elle s'est relâchée, le successeur est placé sur la nouvelle contrainte plus la marge qu'il avait (jours travaillés si le calendrier l'est) ; une tâche collée à son prédécesseur reste collée.
- **Jamais avant le minimum permis** : avec un autre prédécesseur plus contraignant, rien ne bouge. Une tâche **déjà en conflit** avant l'action et une tâche **terminée** (100 %, signalée) ne sont pas touchées. Pousser ce qui entre en conflit reste prioritaire et ne dépend pas de la case.
- Même chemin que le décalage vers l'arrière : gestes, clavier, fiche de la tâche ; aperçu par fantômes (« -6 j ») ; annulation d'un seul coup ; tâches déplacées en `manuel`. La création d'un lien ne rapproche pas.
- Logique : `decalerSuccesseurs(taches, modifiees, ouvre, { avant, rapprocher })` ; `avant` est le planning d'avant l'action.

## Jalons de mission

Les jalons de mission sont les lignes de la table `milestones` de l'affaire (un jalon par mission incluse du contrat MOE : ESQ, APS, ..., DET, AOR, avec son échéance). Un **jalon du planning** peut y renvoyer : champ `jalonMission` (identifiant du jalon de mission) dans le JSON existant du planning, sans migration, conservé par `sanitizePlanning` pour un jalon seulement. **C'est une référence, jamais une synchronisation** : aucune date n'est modifiée sans geste explicite.

- **Fiche d'un jalon** : liste « Jalon de mission lié » (les jalons de l'affaire, lus par `GET /api/milestones?project_id=`). Quand les dates diffèrent, l'écart est écrit (« La mission « AOR » est au 2027-01-22, 4 jour(s) plus tard que ce jalon ») avec deux actions : « Reprendre la date de la mission » (le jalon du planning prend la date, à enregistrer avec la fiche) et « Mettre à jour le jalon de mission » (écrit la date de la fiche sur la mission par `PUT /api/milestones/:id`, corps complet avec la seule échéance changée, comme le fait la fiche affaire ; geste isolé de l'enregistrement du planning). Lier ou délier ne touche jamais la mission.
- **Diagramme** : un losange vide, de la couleur du lot, marque la date de la mission quand elle diffère de celle du jalon et tombe sur l'axe affiché ; une ligne sous la barre de réglages énumère les écarts. Une mission supprimée (lien orphelin) est simplement ignorée.
- **PDF** : l'intitulé du jalon est complété (« Réception (mission AOR 01/02) », sans date quand elles coïncident), un anneau vide marque la date de la mission quand elle diffère, la légende l'explique.
- Un jalon de mission **terminé** est signalé dans la liste. La date d'un jalon de mission modifiée depuis la fiche affaire n'est relue qu'à l'ouverture de l'onglet Planning.
- Logique pure : `src/lib/planningJalonsMission.ts` (`jalonsMissionDepuisApi`, `ecartJalonMission`, `jalonMissionAvecDate`).

## Annuler et rétablir

Deux boutons à côté de « Tâche » (flèches), et Ctrl+Z (Cmd+Z) pour annuler, Ctrl+Maj+Z ou Ctrl+Y pour rétablir. L'historique réutilise `src/lib/croquis/history.ts` (générique, pur) : **un pas par action de l'utilisateur**, donc un déplacement qui a décalé trois successeurs s'annule d'un seul coup. Sont annulables : déplacements et redimensionnements, fiche de tâche (création, modification, suppression), liens, génération IA, changements du calendrier partagé (congés, région, jours ouvrés). 50 pas au plus.

- L'état restauré est enregistré comme n'importe quelle modification (enregistrement automatique de 1,2 s) : annuler est donc partagé avec les autres utilisateurs de l'affaire, comme l'action d'origine.
- L'historique est local à l'écran ouvert et repart de zéro à chaque lecture du planning ; il n'est pas conservé après un rechargement et on n'annule jamais au-delà de ce qui a été lu. Un planning relu après la modification d'un autre utilisateur n'est pas fusionné : annuler remet l'état d'avant votre action.
- Une nouvelle action après une annulation efface ce qui pouvait être rétabli.
- Le raccourci est ignoré dans un champ de saisie (l'annulation du champ reste la sienne) et tant qu'une fenêtre (fiche de tâche, génération IA) est ouverte.

## Délais entre les tâches

Chaque lien fin à début peut porter un **délai** (séchage, approvisionnement...) : `delais` sur la tâche successeur, `{ identifiant du prédécesseur: jours }`, entier de 1 à 365, dans le JSON existant (aucune migration). Il se saisit dans la fiche de la tâche, à côté de chaque prédécesseur coché ; retirer le prédécesseur retire son délai, et `sanitizePlanning` (client et serveur) écarte tout délai sans lien, nul, négatif ou illisible.

- La tâche peut commencer au plus tôt `délai` jours pleins après la fin de son prédécesseur (délai 0 : le lendemain). Avec plusieurs prédécesseurs, le plus contraignant l'emporte.
- Le critère d'incohérence (alerte « dates incohérentes », liste de dépendances du PDF, trait pointillé) est le même partout : la tâche chevauche son prédécesseur, ou laisse moins de `délai` jours entre les deux.
- Le placement à l'ajout d'un prédécesseur, la création d'un lien par geste et le décalage des successeurs appliquent le délai. Modifier un délai dans la fiche ne déplace la tâche que si l'écart ne suffit plus (jamais en arrière).
- PDF : la liste des dépendances indique le délai et son unité. Exports XML : le délai devient le décalage du lien (`LinkLag` pour Microsoft Project, en dixièmes de minute sur une journée de 8 h ; `difference` pour GanttProject). Comme les dates exportées sont fixes et que le calendrier exporté a sept jours, en calcul en jours ouvrés le décalage écrit est l'écart calendaire réel entre les deux tâches.

## Calcul en jours ouvrés

Case « Calcul en jours ouvrés » dans les options du calendrier (`calendrier.joursOuvres`, dans le champ `calendrier` déjà conservé par le serveur) : **partagée avec l'affaire**, désactivée par défaut, sans migration. Un jour ouvré est un jour du lundi au vendredi, hors jours fériés de la région choisie et hors toute période saisie (congés, fermetures, jours fériés locaux), quel que soit l'affichage de ces repères (masquer des bandes ne change jamais un calcul).

- Activer la case ne déplace **aucune date** enregistrée. Elle change la façon de calculer les placements, les délais, les décalages de successeurs et les durées affichées dans la fiche (« Durée : 7 jour(s) ouvré(s), soit 9 jour(s) calendaires »).
- Une tâche déplacée garde sa **durée en jours ouvrés** ; elle commence toujours un jour ouvré ; un jalon reste sur un jour. Les gestes sur le diagramme restent en jours calendaires : la date relâchée est celle choisie.
- L'alerte d'incohérence est indulgente : une tâche qui démarre un samedi juste après un prédécesseur fini le vendredi n'est pas signalée (il n'y a aucun jour ouvré entre les deux).
- Les exports XML gardent leur calendrier de sept jours et des dates fixes, voir ci-dessus pour les décalages.
- Fonctions pures (`planningChantier.ts` : `avancerOuvres`, `joursOuvresEntre`, `dureeOuvree`, `deplacerTacheAu`, `debutMinimalLien`) paramétrées par un prédicat `EstOuvre` ; `creerEstOuvre` (`planningChantierCalendrier.ts`) construit le prédicat du chantier. Sans la case, le prédicat est « tous les jours » et le comportement historique est strictement conservé.

## Barre « Affichage et exports »

Réorganisée pour prendre moins de place : l'en-tête tient sur une ligne (titre, annuler/rétablir, Tâche, Exporter PDF, IA), la ligne de réglages fermée rappelle l'essentiel (échelle, dates relatives, jours ouvrés, décalage des successeurs), et le panneau ouvert est en quatre colonnes (Affichage, Dimensions, Calendrier, Export) sur grand écran, deux sur tablette, une sur téléphone, avec les cases côte à côte quand la largeur le permet. Les périodes de congés restent dans le panneau (pleine largeur), l'aide et les gestes sont repliés, et les deux lignes d'information (liens, repères du calendrier) partagent la même ligne. Les contrôles sont compacts au pointeur fin et gardent 44 px au doigt. Mesure sur le gabarit de test (Chromium, même planning de quatre tâches) : hauteur au-dessus du diagramme de 307 à 181 px réglages fermés et de 872 à 602 px ouverts sur un écran de bureau de 1280 px ; 430 à 322 px fermés et 1811 à 1635 px ouverts sur un Pixel 7.

## Export PDF : format, plage, axe et légende

- **Format du papier** : A4 (défaut) ou A3 paysage, choisi sous « Affichage et exports > Export PDF ». L'A3 garde la même mise en page, avec caractères et lignes agrandis d'un quart et une colonne de libellés proportionnelle. Ce choix et la plage ne sont pas enregistrés : ils ne modifient ni l'écran ni le planning partagé.
- **Plage de dates** : « Du ... au ... », chaque borne facultative. Seules les tâches qui rencontrent la plage sont imprimées, les barres qui dépassent sont tronquées au bord, et la numérotation S1 / M1 reste celle du planning complet (la première colonne peut donc être S4). Le périmètre est rappelé dans le résumé (« Période imprimée »). Une plage sans tâche donne un document court qui le dit ; une plage inversée est refusée avant l'export.
- **Axe** : un bandeau au-dessus des périodes donne le mois (semaines) ou l'année (mois), avec un libellé raccourci quand la place manque. Une semaine appartient au mois de son jeudi, comme la numérotation ISO. Aucun bandeau en calendrier relatif. Un trait plus marqué sépare chaque début de mois ou d'année. L'axe est redessiné en tête de chaque page.
- **Aujourd'hui** : le trait vertical porte une étiquette dans l'en-tête de l'axe, quand la date est dans la période imprimée.
- **Pages suivantes** : un titre de lot n'est jamais laissé seul en bas de page (il emporte son entreprise et sa première tâche) ; quand la liste d'un lot continue sur la page suivante, une ligne « Lot 03 Couverture (suite) » est reprise sous l'axe.
- **Légende** : elle ne cite que ce qui figure sur le document : prévu, réalisé (si l'avancement est affiché), jalon, tâche en retard, jour férié, congé ou fermeture, trait « Aujourd'hui ».
- **Nombre de périodes par page** (réglage « Par page » : tout sur une page, 8, 12, 16, 26 ou 52 semaines ou mois selon l'échelle) : l'axe est découpé en **tranches** imprimées l'une après l'autre. Même largeur de colonne sur toutes les tranches (l'échelle ne change pas d'une page à l'autre, la dernière tranche est simplement plus courte) ; colonne des libellés et axe répétés avec une étiquette « Tranche 2/3 : 2027-S09 à 2027-S16 » ; seules les lignes qui rencontrent la tranche y figurent (une tâche longue est donc répétée sur chaque tranche qu'elle traverse). Les flèches de dépendance sont tracées dans une tranche seulement quand les deux tâches y sont ; les listes (dépendances, calendrier, hypothèses) et la légende ne sont imprimées qu'une fois, à la suite de la dernière tranche. Le résumé le dit (« Axe découpé en 3 tranches de 12 semaines par page »). Sans effet quand tout tient déjà sur une tranche. Non enregistré, comme les autres réglages d'export.

## Export PDF : dépendances, synthèse, retard et indice

- **Dépendances tracées** : une flèche fin à début relie deux tâches dessinées sur la **même page** (le trait ne traverse pas un saut de page) ; en pointillés quand le lien est en conflit (même critère que l'écran : chevauchement ou délai non respecté, jours ouvrés compris). Un lien entre deux pages n'est pas tracé mais reste dans la liste des dépendances sous le diagramme, avec son délai. La légende ne cite les flèches que si le document en porte. Pas de flèche en synthèse.
- **Synthèse par lot** (réglage « Contenu > Synthèse par lot ») : une ligne par lot (nom, entreprise, nombre de tâches, dates, barre du lot avec son avancement) au lieu de toutes les tâches ; tient en une page pour une réunion de chantier ou le maître d'ouvrage. Le nom du fichier porte `_synthese`. L'export d'un lot seul (bouton « PDF » du lot) reste détaillé : c'est ce qui se remet à l'entreprise.
- **Retard en couleur** : une tâche en retard porte « [Retard] » en rouge gras devant son intitulé et un soulignement rouge sous sa barre (cercle rouge pour un jalon) ; la légende l'explique. La couleur sert ici une donnée, le reste du document reste dans les nuances de gris de la charte.
- **Indice de diffusion** : champ libre (lettres, chiffres, tiret, 12 caractères) imprimé dans le résumé (« Indice B ») et ajouté au nom du fichier (`_indB`). Il n'est pas enregistré : à ressaisir à chaque export.

## Base de données

Aucune migration nouvelle : `project_chantier_planning.data` est déjà un JSONB sans liste blanche SQL de champs internes. `sanitizePlanning`, utilisé par GET, PUT et les opérations client, conserve désormais les dépendances valides. La migration initiale `migrate_chantier_planning.sql` reste le prérequis pour les anciennes instances non équipées ; aucune migration n’est appliquée par cette modification.

## Validation

Les tests unitaires couvrent les semaines ISO, les changements d’année, le passage à l’heure d’été, les mois courts, les préférences malformées, les cycles, les suppressions, la génération IA, les couleurs et les exports XML/PDF. Les tests serveur vérifient PUT puis GET, le JSON enregistré, le rejet des cycles et la portée de la table AOR. La fixture Playwright monte le vrai composant avec HTTP intercepté, sur Chromium ordinateur et Pixel 7, sans compte ni données de production.

## Fichiers concernés

- `src/components/chantier/PlanningChantierTab.tsx`, `PlanningTacheDialog.tsx` : commandes, préférences, dépendances et rendu.
- `src/lib/planningChantier.ts`, `reserveCouleurs.ts` : dates, validation et couleurs partagées ; `server/routes/planningChantier.ts` : persistance et table AOR.
- `src/lib/planningChantierXml.ts`, `projectPlanningXmlShared.ts`, `ganttProjectXml.ts`, `msProjectXml.ts` : adaptateur et extensions des exporteurs communs.
- `src/lib/planningChantierPdf.ts` : périmètre et rendu PDF.
- `src/locales/fr.ts`, `src/locales/en.ts` : traductions des nouveaux réglages et dépendances.
- `src/lib/__tests__/planningChantierEvolution.test.ts`, `planningChantierPdf.test.ts`, `tests/planningChantier.test.ts` : tests ciblés.
- `e2e/chantier-planning.spec.ts`, `e2e/fixtures/chantier-planning.{html,tsx}`, `e2e/vite.config.ts`, `playwright.config.ts` : vérification navigateur et précompilation des fixtures.
- `docs/api-routes.md`, `.claude/rules/chantier-det-rdt.md` et ce document : inventaire et conventions actualisés.

## Manipulation directe du diagramme

- Glisser le centre d’une barre décale ses deux dates en conservant sa durée. Les deux poignées changent uniquement le début ou la fin, avec une durée minimale d’un jour. Un jalon se déplace sans durée supplémentaire. L’aperçu donne les dates exactes ; seul le relâché enregistre. Échap, une interruption système ou la perte de focus annulent. Une tâche IA dont les dates changent devient manuelle, comme depuis sa fiche.
- Les gestes utilisent `startPressDrag`, déjà partagé par les plannings de l’application. Son contrôleur d’annulation permet au nouveau composant de nettoyer un geste au démontage ou au changement d’affaire. Le déplacement tactile commence par un appui long ; un balayage avant cet appui laisse défiler la page. Les poignées étroites sont masquées sur téléphone et pointeur tactile : la fiche et les commandes clavier permettent de saisir les dates précisément.
- Tirer le bouton de liaison d’une barre et relâcher sur une autre tâche crée une dépendance fin à début. La source est le prédécesseur, la cible le successeur. Le même bouton permet une sélection en deux clics, également au clavier. Les liens vers soi, doublons, références absentes et cycles sont refusés. Les dates des autres tâches ne sont jamais recalculées.
- Au clavier, les flèches gauche/droite sur une barre la déplacent d’un jour ; Maj porte le déplacement à sept jours. Les poignées utilisent les mêmes touches pour leur borne. Le séparateur de la colonne des libellés accepte le glissement et les flèches (huit pixels par pas).
- Les réglages de largeur portent séparément sur les libellés (140 à 560 px) et sur les périodes (28 à 240 px). « Ajuster à la largeur » répartit toutes les périodes dans la région disponible ; les libellés trop serrés de l’axe sont espacés pour rester lisibles. À très petite échelle, désactiver l’ajustement ou augmenter la largeur des périodes permet une édition plus précise. Les petites barres conservent une cible minimale ; leur largeur visuelle n’est alors pas une mesure exacte de durée.
- « Afficher l’avancement » masque ou affiche les pourcentages et la partie réalisée des barres, sans changer les données ni les exports XML. Les états et retards restent visibles. Le PDF reprend ce choix et la largeur des libellés, bornée pour préserver le diagramme ; toutes les périodes du PDF tiennent toujours sur la largeur de page. Le zoom des périodes est réservé à l’écran.
- Ces nouveaux réglages suivent la même préférence locale par cabinet, personne et affaire. Les anciens réglages sont complétés par les valeurs par défaut. Aucun nouveau champ serveur, aucune migration et aucune dépendance ajoutée.

Fichiers de cette extension : `PlanningChantierTab.tsx`, `PlanningBarre.tsx`, `usePlanningPressDrag.ts`, `planningChantier.ts`, `planningChantierPdf.ts`, `pressDrag.ts`, `src/index.css`, traductions FR/EN, tests purs des gestes et du cycle de vie du pointeur, tests PDF et scénario navigateur de chantier. Les tests couvrent aussi les axes mensuels de longueur variable, l’année ISO et l’annulation sans écriture.

## Jours fériés et congés du chantier

Les réglages proposent les jours fériés de France métropolitaine, d’Alsace-Moselle ou aucun calendrier automatique. Les dates mobiles sont calculées en UTC. Le Vendredi saint doit être vérifié selon la commune ; les autres calendriers ou jours locaux peuvent être saisis manuellement.

Les périodes de congés/fermeture et les jours fériés personnalisés ont un nom et des dates inclusives. Ce calendrier est partagé dans cette affaire, enregistré dans le champ facultatif `calendrier` du JSON existant et conservé par la validation serveur. Il est indépendant des congés RH et ne modifie jamais les dates des interventions. Aucune migration Supabase n’est nécessaire.

Chaque utilisateur peut masquer séparément jours fériés et congés sur son appareil, pour cette affaire. Les bandes bleues et les hachures traversent le diagramme ; une liste accessible donne leurs noms et dates réelles, même en calendrier relatif. Le PDF reprend cette visibilité, les repères et leur liste. Les exports XML conservent leur calendrier de sept jours pour préserver les dates : ces repères visuels ne deviennent pas des contraintes de travail dans les applications externes.

Les poignées de redimensionnement apparaissent au survol ou au focus clavier. Le bouton de liaison reste discret au repos et retrouve son contraste au survol/focus ; sa cible tactile est conservée. Les gestes et commandes clavier restent identiques.

L’ordre vertical des tâches au sein de chaque lot est l’ordre enregistré dans le planning, conservé au rechargement et dans le PDF/XML. Modifier les dates ou ajouter un prédécesseur ne retrie pas les lignes. La fiche montre immédiatement les dates proposées à la sélection d’un prédécesseur ; annuler la fiche abandonne aussi ce placement. Les gestes de liaison appliquent le même placement au relâché, annoncé par le message accessible. Les déplacements manuels restent possibles, même avec un conflit de dates signalé.
