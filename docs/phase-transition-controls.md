# Contrôles des transitions de phases

Le bouton de passage à la phase suivante et le sélecteur de phase ouvrent la même checklist. L’API recalcule les règles au moment de valider : envoyer seulement une phase ne permet plus de contourner les contrôles (sauf initialisation ESQ).

## Utilisation

- Fait : contrôle confirmé par l’utilisateur, avec document facultatif.
- À faire : élément manquant.
- Non nécessaire : justification obligatoire et historisée.
- Non vérifié : confirmation encore attendue, y compris lorsqu’un document est suggéré.

Un contrôle bloquant non conforme interdit le passage. Pour les autres contrôles requis non conformes, l’action « Créer les tâches manquantes puis poursuivre » crée les tâches avant de valider, dans une seule transaction. Un contrôle informatif peut être facultatif ; la criticité et le caractère requis sont indépendants.

La date de tâche est la fin théorique de la phase source, augmentée du décalage configuré (négatif ou nul). Le retard est un nombre de jours calendaires UTC, jamais négatif. Sans date théorique, la création est refusée. Un jalon existant nommé exactement `ESQ` ou `Fin ESQ` (idem pour les autres phases) fournit la date si ce jalon est unique ; la configuration explicite reste prioritaire. Aucun retard artificiel n’est inventé.

Les responsables de projet (`pm`), managers et administrateurs disposent d’un éditeur dans la checklist : contexte ERP/existant/ABF/structure/SPS/CT, dates des phases, ajout/retrait des règles, criticité, responsable par défaut, termes de preuve, conditions « toutes » / « au moins une ». La configuration est propre au projet. Son enregistrement recharge les réponses ; le texte de l’interface l’annonce.

## Scénarios et correspondance avec les phases existantes

Le catalogue initial est dans `server/config/phaseControls.json`, séparé du moteur. Il couvre DIAG→ESQ, ESQ→APS, APS→APD, APD→PC, PRO→DCE, ACT→VISA, VISA→DET et DET→AOR. Le modèle existant ne possède pas de phases séparées « marchés » et « réception » : les marchés sont contrôlés à l’entrée en VISA, et les OPR/essais/DOE/DIUO/PV/réserves/DGD à l’entrée en AOR. Aucun nouvel état métier n’est imposé aux documents ou contrats existants.

Un saut ESQ→APD inclut aussi les contrôles de l’entrée en APS. Un retour vers une phase précédente est historisé, sans contrôles de passage en avant. Lors d’un nouveau passage en avant, une nouvelle checklist est réalisée. Sans historique, la phase de départ est ESQ.

Les attributs existants du projet donnent seulement des indications positives (ERP, réhabilitation, structure, ABF). Un contexte inconnu garde le contrôle visible et signale qu’il faut confirmer son applicabilité. Une condition explicitement fausse exclut le contrôle. La configuration explicite est prioritaire sur la détection.

Les suggestions de preuves recherchent des mots ou expressions dans le nom, la description et le type des documents du projet, pour les phases source/cible ou Général. Les versions périmées et documents rejetés ne sont pas suggérés. La présence d’un fichier n’atteste jamais automatiquement sa conformité, ni sa transmission au CT/SPS. L’utilisateur peut sélectionner un autre document du projet.

## Persistance et API

Appliquer `supabase/migrate_phase_transition_controls.sql` avant de déployer le serveur. L’installation Electron reprend automatiquement cette migration via son mécanisme existant. Aucun appel n’est effectué à une base de production pendant le développement.

- `GET /api/projects/:id/phase-controls?to=APS` : configuration effective, contexte, contrôles et preuves proposées, identifiant de phase courante et empreinte de révision.
- `PUT /api/projects/:id/phase-controls/config` : configuration validée et limitée aux rôles autorisés.
- `POST /api/projects/:id/phase` : phase, `expectedCurrentId`, `revision`, `answers`, `createTasks`.
- `GET /api/projects/:id/phase-history` expose aussi `control_audit` : règles et réponses au moment du passage, justification, documents, utilisateur, échéances et tâches créées.

La configuration utilise un schéma versionné : `version: 1`, `rules`, `context`, `phaseDeadlines`. Chaque règle définit `id`, `title`, `from`, `to`, `required`, `severity`, `when: { all, any }`, `evidenceTerms`, `defaultAssigneeId`, `dueOffsetDays`. Les conditions utilisent une liste fermée de propriétés, sans évaluation de code.

`commit_phase_transition` verrouille le projet et vérifie la phase/configuration attendues ; l’historique, l’audit et les tâches sont atomiques. La fonction n’est exécutable que par le serveur (service_role / propriétaire local), pas les rôles clients via PUBLIC. Les documents et responsables sont limités au cabinet/projet. Une requête concurrente périmée reçoit 409 ; répéter un passage déjà réalisé vers la phase courante ne crée pas de nouvelles tâches.

Les colonnes de configuration et de tâche suivent les mécanismes existants de sauvegarde/synchronisation de leurs tables. L’historique des phases reste, comme avant, hors de la liste de synchronisation cloud↔desktop : cette fonctionnalité ne modifie pas cette limite existante.

## Vérification

`tests/phaseControls.test.ts` teste le moteur ; `tests/phaseControlRoutes.test.ts` teste la validation et l’isolation API. `tests/phase7Batch2.test.ts` couvre le parcours réel dans le serveur. Le test PostgreSQL existant `tests/applySchemaFreshInstall.test.ts` vérifie aussi le rollback d’une tâche invalide, l’écriture complète, le rejet d’un passage périmé et les droits de la fonction (exécuté en CI avec PGHOST).
