# Planning des entreprises (Chantier > DET > Planning)

Ce planning appartient à l’affaire et reste indépendant des tâches internes du cabinet.

## Affichage

« Affichage et exports » permet de choisir les semaines ou les mois, les dates calendaires ou relatives, les numéros ISO et la visibilité des tâches générales. Chaque groupe se replie ; les deux actions globales sont disponibles. Les préférences sont locales à l’appareil, indexées par cabinet, utilisateur et affaire. Aucun réglage d’affichage ne modifie le planning partagé.

S1 et M1 commencent au premier jour du planning complet, y compris si cette tâche est masquée. Les semaines relatives durent sept jours à partir de cette date, sans alignement implicite au lundi. Les mois relatifs conservent le jour de référence, rabattu au dernier jour des mois courts (31 janvier → 28/29 février → 31 mars). Les semaines calendaires utilisent le lundi et l’année ISO, qui peut différer de l’année civile. Tous les calculs des dates AAAA-MM-JJ utilisent UTC. Les dates des interventions restent réelles en base.

## Couleurs et dépendances

La lecture du planning récupère la table des couleurs des réserves AOR de cette affaire, calculée par `reserveCouleurs.ts`. La première entreprise responsable prime, sinon l’intitulé du lot ; normalisation identique à l’AOR. Pour plusieurs titulaires rapprochés d’un lot, le premier nom du résumé ` / ` sert de responsable de couleur. Les responsables absents de l’AOR utilisent la même palette, calculée sur tous les lots du planning. Les tâches générales sont grises. L’AOR conserve son attribution existante : ajouter une entreprise aux réserves peut modifier les couleurs par ordre alphabétique, comme auparavant. Les réserves GPA ont leur propre population et peuvent donc avoir une table différente.

Les prédécesseurs sont sélectionnés dans la fiche d’une tâche (tous lots et jalons). Ils sont stockés dans `dependencies?: string[]` du JSON existant, comme pour le modèle des tâches internes. Le seul type est fin à début, sans décalage : la fin étant inclusive, le successeur commence au plus tôt le lendemain. Une alerte explicite signale les dates incohérentes, sans modifier les dates. Le serveur refuse les cycles et les liens vers soi-même avant écriture. L’assainissement partagé retire les références disparues après suppression ou remplacement IA. Les anciens plannings sans ce champ restent valides.

Les liaisons visibles sont tracées sur le diagramme (pointillés en cas de conflit). La liste textuelle de toutes les liaisons reste accessible ; le résumé compte celles dont une tâche est masquée ou repliée. L’avancement et l’état sont également écrits en texte.

## Exports et compatibilité

- **PDF** : applique l’échelle, le calendrier relatif ou réel, les numéros ISO, les couleurs et la visibilité des tâches générales. Tous les lots sont toujours dépliés à l’export ; ce périmètre est annoncé près des réglages et dans le document. L’export individuel par lot reste disponible. Les dépendances figurent dans une liste, avec mention des prédécesseurs hors périmètre et des dates incohérentes ; elles ne sont pas tracées entre pages.
- **Microsoft Project XML** et **GanttProject XML (.gan)** : exportent le planning complet, indépendamment du repli et des filtres, avec les dates réelles. L’adaptateur `planningChantierXml.ts` appelle les exporteurs existants ; il ajoute des groupes récapitulatifs par lot et pour les tâches générales. Les identifiants numériques sont uniques dans chaque fichier, et toutes les références utilisent la même table. Une tâche ordinaire d’un jour reste distincte d’un jalon. Les liens fin à début, noms, dates et pourcentages sont conservés.
- Les exporteurs communs acceptent des métadonnées hiérarchiques et une option de calendrier de sept jours. Cette option est activée pour le chantier, dont les durées sont calendaires ; les exports des tâches internes gardent leurs valeurs par défaut. Le XML MS Project contient un calendrier explicite et des tâches manuelles pour conserver les dates. Le calendrier GanttProject suit la structure de l’exemple officiel `bardsoftware/ganttproject/ganttproject-builder/HouseBuildingSample.gan`.
- Les tests relisent les deux fichiers par `parsePlanningXml`, vérifient dates, avancements, jalons, dépendances et hiérarchie. L’import générique existant importe les groupes comme des tâches ordinaires ; il n’offre pas encore de reconstruction des lots dans le planning chantier. Il n’existe pas d’import chantier dans cette livraison.
- MS Project et GanttProject ne sont pas installés dans l’environnement de validation : l’ouverture et les éventuelles décisions de recalcul propres à ces applications restent à vérifier. Les couleurs sont exportées dans GanttProject ; le format MS Project employé ne porte pas de couleur des barres. Les hypothèses IA ne sont pas des tâches et ne sont pas exportées en XML.

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
