# ArchiOffice Drive — audit et cadrage
Date : 29 octobre 2026. Révision examinée : ff69494f85f44c2951327414e62ea0d4b66f759a.

## Portée et méthode
Audit statique du code et du contrat existant. Aucun essai Windows/macOS, serveur fournisseur ou base distante ; aucune migration appliquée. La présence de code ou de tests ne vaut pas validation en production. Ce document complète docs/desktop-sync-contract.md ; en cas de divergence, les exigences nouvelles ci-dessous doivent être reportées au contrat lors de leur implémentation.

## Décision produit
**ArchiOffice Drive est réservé aux utilisateurs payants.**
Le modèle de facturation actuel est celui du cabinet (tenant), pas un paiement individuel par membre. Traduction proposée : membres autorisés d'un cabinet avec abonnement payant actif ; Starter, Pro et Entreprise sous contrat actif. Essai gratuit, essai expiré, cabinet local sans droit cloud vérifié : Drive non activable. Le prix catalogue nul d'Entreprise signifie « sur devis » et ne permet pas de déterminer son éligibilité.

Cette règle concerne le service Drive : montage natif, hydratation, synchronisation et connecteurs via Drive. Ne pas retirer par inadvertance les fonctions documentaires existantes aux offres actuelles.

Le contrôle reste à implémenter ; ce cadrage ne l'active pas.

## Existant vérifié
| Domaine | Éléments du dépôt | Conclusion |
| --- | --- | --- |
| Electron | electron/main.cjs, preload.cjs, fileAccess.cjs | Base Postgres/PostgREST et serveur locaux ; ouverture et révélation des fichiers. Sur Windows, fermer toutes les fenêtres quitte l'application ; before-quit arrête serveur et pile locale. |
| Installation | electron-builder.yml, .github/workflows/build-windows.yml | Distribution Windows NSIS et mises à jour prévues. Aucun pipeline macOS dans les workflows examinés ; packaging macOS à concevoir. |
| API Drive | server/routes/desktopSync.ts | /api/desktop/v1 existe : appareils, racines, nœuds, versions, contenu, changements, verrous, uploads, gestes documentaires. |
| Identité et sécurité | server/desktop/deviceTokens.ts, middleware de server.ts | Jetons ds_at_ hachés, révocables, limités au préfixe desktop ; adhésion au cabinet sélectionné vérifiée. Pas de contrôle payant spécifique dans les routes examinées. |
| Classement | server/desktop/nodes.ts, server/routes/documents.ts | Document identifié indépendamment du chemin ; arborescence projet/phase et À classer. Métadonnées métier déjà présentes. Les vues multiples par client/type/statut restent à composer. |
| Versions | server/desktop/uploads.ts | Version technique séparée de l'indice ; contrôle de version et mise à jour conditionnelle. Les routes documentaires historiques suivent un autre parcours : harmonisation à vérifier. |
| Reprise | server/desktop/uploads.ts | Morceaux sur disque, état de réception et empreinte ; relecture finale en Buffer, plafond 200 Mo par défaut. La valeur cible 2 Go du contrat n'est pas la capacité actuelle. |
| Changements et suppression | server/desktop/changes.ts, migrate_desktop_sync.sql, contrat | Journal avec curseur et corbeille prévus/implémentés côté serveur. Déploiement distant et purge automatique à vérifier ; ne pas les annoncer opérationnels. |
| Stockage externe | server/externalStorage/provider.ts, providers/webdav.ts | Adaptateurs Google Drive, Dropbox, WebDAV Nextcloud/kDrive déjà présents. WebDAV utilise un chemin comme identifiant ; pas de suivi externe des déplacements ni de flux de changements dans l'interface fournisseur examinée. |
| CAO | uploads.ts, contrat existant | Règle actuelle : stockage externe requis pour la CAO en cloud ; exemption locale. La cible « stockage ArchiOffice pour tous formats » exige donc une décision explicite avant modification. |
| Natif | arbre du dépôt, contrat section 17 | Aucun client CFAPI/File Provider identifié ; restent à développer et à tester sur les OS concernés. |

## Risques prioritaires
1. **Perte locale après révocation** : le contrat demande un effacement, en contradiction avec la préservation des modifications du cadrage. Avant le pilote, séparer cache propre et modifications non envoyées. Arrêter les accès réseau ; préserver les modifications dans une zone de récupération protégée, avec politique de rétention définie. Ne pas promettre une révocation instantanée sur un poste déconnecté.
2. **Paiement et poste hors connexion** : getTenantPlan dans server.ts considère l'expiration de l'essai, pas une preuve exhaustive de validité d'un abonnement payant. La présence de tenants.plan ne suffit pas ; auditer renouvellement, annulation, impayé et contrat Entreprise. Ne pas confondre échec d'un changement de formule et expiration de l'abonnement en cours.
3. **Cohérence des écritures** : completeUpload enchaîne stockage, mise à jour du document, insertion d'historique et finalisation de session. Des résultats d'écritures d'historique/finalisation ne sont pas contrôlés. Tester panne entre étapes et double complete simultané avant d'affirmer une idempotence de bout en bout.
4. **Pagination serveur** : listChildren charge les éléments du dossier avant tri/découpage ; pagination de réponse ne signifie pas coût borné en base. Mesurer sur 20 000 fichiers et optimiser avant généralisation.
5. **Références CAO** : noms dédupliqués et chemins dépendants du classement peuvent changer. L'emplacement principal doit être stabilisé ; une modification de métadonnée ne doit pas déplacer implicitement un fichier lié.
6. **Connecteur WebDAV** : déplacement externe peut casser la référence, PUT entier en mémoire, vérification de taille au mieux. Ce connecteur de stockage existant n'est pas une synchronisation bidirectionnelle complète.
7. **Gros fichiers et déploiement** : limiter à la capacité mesurée tant que toute la chaîne n'accepte pas les flux ; contrôler persistance du disque temporaire et routage si plusieurs instances servent les morceaux.

## Architecture retenue
Conserver Electron pour l'interface métier, les recherches, les propriétés et les versions. Ajouter un agent autonome par session utilisateur, avec file persistante et cache indexé par cabinet/document/version ; assurer sa survie à la fermeture de fenêtre, son démarrage à l'ouverture de session et ses mises à jour compatibles avec l'API.

Partager protocole, transferts, états et résolution des conflits ; isoler les composants Windows CFAPI et macOS File Provider. L'installation est unique, mais les cycles de vie des composants sont distincts. Le choix de langage et de packaging reste à valider par prototypes.

Une racine principale par cabinet ; les vues client/projet/type/phase/statut dans Electron pointent vers les mêmes identifiants et ouvrent le même emplacement de travail. Les vues natives supplémentaires restent expérimentales. Aucun emboîtement de racines avec les clients Nextcloud/kDrive.

## Contrôle payant à réaliser
Créer un droit explicite archioffice_drive, résolu côté serveur depuis la facturation autoritative, le cabinet actif et l'adhésion de l'utilisateur. Ne pas déduire le droit de price_monthly, d'un bouton caché, d'un champ local éditable ou de la seule durée du jeton d'appareil.

- Vérifier à l'activation et à chaque accès Drive au cabinet ; recontrôler au début, à la reprise et à la finalisation d'un upload.
- Filtrer /roots selon les cabinets éligibles. L'appareil reste attaché à la personne ; un cabinet gratuit ne doit pas profiter du droit d'un autre cabinet.
- Rendre une erreur stable 402 DRIVE_SUBSCRIPTION_REQUIRED pour l'absence de droit payant. Conserver les erreurs 401/403 pour session/révocation/adhésion.
- Garder accessibles la gestion/révocation de ses appareils et les opérations nécessaires de libération de verrou même après perte du droit.
- Les liens signés déjà émis restent utilisables jusqu'à leur échéance : définir une durée adaptée et ne pas annoncer une coupure immédiate sans mécanisme supplémentaire.
- Fournir à l'agent une autorisation hors connexion signée et bornée. Première activation en ligne obligatoire. Durée de grâce à décider ; à l'expiration, geler les nouvelles opérations Drive, préserver les travaux locaux et permettre leur récupération.
- En cas d'annulation, maintenir le droit jusqu'au terme payé ; à la fin, suspendre Drive sans supprimer les documents serveur ni les modifications locales.
- Afficher « ArchiOffice Drive — abonnement payant requis » dans le parcours d'activation ; éviter de bloquer les écrans Documents actuels.

## Lots adaptés à l'existant
| Ordre | Livrable | Validation attendue |
| --- | --- | --- |
| 1 | Droit payant serveur, réponse de capacité, parcours d'activation, politique hors connexion et révocation ; harmonisation du contrat | Essai refusé, payant admis, perte du droit et multi-cabinet testés ; aucune suppression de travail local |
| 2 | Fiabilisation API existante : écritures/version/historique/session, flux, temporaire, pagination, corbeille | Pannes injectées, concurrence réelle, reprise, empreintes et charge mesurée |
| 3 | Prototype agent + CFAPI Windows et File Provider macOS | Ouvrir/enregistrer/reprendre un fichier, fermeture Electron, redémarrage, signature et installation sur chaque OS |
| 4 | Vues métier Electron et classification configurable | Un document trouvé par client/projet/type ; aucun doublon ni déplacement implicite |
| 5 | Extension d'un connecteur pilote existant | Capacité fournisseur mesurée : identité stable, déplacements externes, versions, conflits et droits ; limitations affichées |
| 6 | Pilote cabinet sur un jeu métier | DWG liés, fichiers temporaires, dépendances hors connexion, gros fichiers et modifications simultanées |

Ne pas recréer le modèle ou le connecteur WebDAV existants. Le calendrier de 4–7 mois reste une hypothèse jusqu'aux prototypes, au dimensionnement d'équipe et aux essais fournisseurs. Les validations de collaboration Revit/Archicad font l'objet d'un périmètre dédié.

## Tests d'acceptation complémentaires
- Essai actif et expiré : activation et octets Drive refusés ; Documents actuels conservés.
- Starter/Pro actifs et Entreprise sous contrat : accès selon droits ; contrat Entreprise expiré refusé.
- Jeton ancien, changement d'offre pendant upload, téléchargement par lien déjà signé : comportement défini et vérifié.
- Membre de deux cabinets, un payant et un gratuit : isolation du droit.
- Annulation programmée : maintien jusqu'au terme payé ; suspension ensuite.
- Droit inconnu ou panne de facturation : aucune activation nouvelle ; politique hors connexion bornée.
- Révocation/fin d'abonnement hors connexion avec fichier modifié : récupération sans perte, sans nouvel envoi non autorisé.
- Double finalisation simultanée et panne après stockage : une version cohérente et historique complet, ou erreur récupérable.

## Limites de cet audit
Tests du dépôt identifiés mais non exécutés. État des migrations distantes, certificats Apple/Microsoft, capacités des hébergeurs et usages réels du cabinet non vérifiés. Ces points sont des conditions de passage au pilote, pas des fonctionnalités déjà livrées.
