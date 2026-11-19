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

- **PDF** : applique l’échelle, le calendrier relatif ou réel, les numéros ISO, les couleurs et la visibilité des tâches générales. Tous les lots sont toujours dépliés à l’export ; ce périmètre est annoncé près des réglages et dans le document. L’export individuel par lot reste disponible. Les dépendances figurent dans une liste, avec mention des prédécesseurs hors périmètre et des dates incohérentes ; elles ne sont pas tracées entre pages.
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
- les jours fériés et les congés restent des repères : le décalage compte des jours calendaires (le calcul en jours ouvrés est un chantier à part).

Pas encore fait : annuler le dernier décalage, aperçu visuel des barres décalées pendant le geste, décalage vers l'avant (tirer les successeurs) et délai entre tâches.

## Export PDF : format, plage, axe et légende

- **Format du papier** : A4 (défaut) ou A3 paysage, choisi sous « Affichage et exports > Export PDF ». L'A3 garde la même mise en page, avec caractères et lignes agrandis d'un quart et une colonne de libellés proportionnelle. Ce choix et la plage ne sont pas enregistrés : ils ne modifient ni l'écran ni le planning partagé.
- **Plage de dates** : « Du ... au ... », chaque borne facultative. Seules les tâches qui rencontrent la plage sont imprimées, les barres qui dépassent sont tronquées au bord, et la numérotation S1 / M1 reste celle du planning complet (la première colonne peut donc être S4). Le périmètre est rappelé dans le résumé (« Période imprimée »). Une plage sans tâche donne un document court qui le dit ; une plage inversée est refusée avant l'export.
- **Axe** : un bandeau au-dessus des périodes donne le mois (semaines) ou l'année (mois), avec un libellé raccourci quand la place manque. Une semaine appartient au mois de son jeudi, comme la numérotation ISO. Aucun bandeau en calendrier relatif. Un trait plus marqué sépare chaque début de mois ou d'année. L'axe est redessiné en tête de chaque page.
- **Aujourd'hui** : le trait vertical porte une étiquette dans l'en-tête de l'axe, quand la date est dans la période imprimée.
- **Pages suivantes** : un titre de lot n'est jamais laissé seul en bas de page (il emporte son entreprise et sa première tâche) ; quand la liste d'un lot continue sur la page suivante, une ligne « Lot 03 Couverture (suite) » est reprise sous l'axe.
- **Légende** : elle ne cite que ce qui figure sur le document : prévu, réalisé (si l'avancement est affiché), jalon, tâche en retard, jour férié, congé ou fermeture, trait « Aujourd'hui ».
- Pas encore fait : tracé des dépendances entre tâches (elles restent listées), repli par lot (tout est déplié), nombre de semaines par page, indice de diffusion du document.

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
