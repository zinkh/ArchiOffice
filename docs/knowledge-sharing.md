# Mémoire documentaire commune — étape 1 (pilote sécurisé)

Les fichiers importés restent dans `documents`, cloisonnés par `tenant_id` dans
le stockage propre au cabinet. Il n'y a **pas** d'indexation externe automatique.

Dans **Documents > Mémoire technique collective**, un administrateur peut :

1. activer une autorisation **distincte** des CGU, désactivée par défaut ;
2. sélectionner un PDF, DOCX, TXT ou XLS/XLSX de son cabinet ;
3. obtenir une extraction locale et une première version nettoyée ;
4. corriger le contenu et attester la vérification des droits et de la non-réidentification ;
5. valider un extrait ou le supprimer ; désactiver l'autorisation efface les contributions.

Les seuls contenus enregistrés dans `knowledge_contributions` sont les **extraits**
préparés pour revue. Aucun contenu n'est envoyé à Mistral ni publié à d'autres
tenants : `publication_active=false` est contractuel pour cette étape.

## Limites volontairement bloquantes

- Le masquage par regex est insuffisant pour assurer l'anonymisation. Des noms
  propres, plans, contraintes géographiques et tableaux peuvent réidentifier
  un chantier. La revue humaine reste obligatoire.
- Pour les PDF scannés, OCR **local** via l'extracteur existant ; il peut ne
  pas reconnaître le texte. On refuse alors la préparation plutôt que de
  transmettre des fichiers bruts à un fournisseur externe.
- Un consentement donné par un administrateur du cabinet ne remplace pas les
  droits contractuels des entreprises ou des personnes dont les documents
  portent les informations.
- Avant l'activation d'une bibliothèque partagée sur Mistral : DPA validé,
  test du traitement de suppression, permissions inter-cabinets, audit du
  flux d'anonymisation (Presidio ou équivalent hébergé en UE), politique de
  conservation, indexation privée par projet et tâches persistantes.
- La révocation efface les contributions de cette étape ; comme rien n'est
  encore publié à un fournisseur, aucune suppression externe n'est nécessaire.

Migration : `supabase/migrate_knowledge_sharing_review.sql`. Ne pas déployer
l'interface avant d'avoir appliqué la migration et vérifié RLS.

## Partage automatique (étape 3)

Le cabinet peut choisir des **types de documents** (CCTP, Note technique, DPGF, BPU, DQE,
Rapport : liste blanche, jamais un contrat, un devis, un ordre de service, un compte
rendu ou un plan) dont les nouveaux documents sont partagés sans validation manuelle.
C'est une **seconde autorisation**, distincte de la contribution anonymisée : elle
couvre l'analyse du texte par Mistral avant toute relecture humaine. Elle est
enregistrée avec son auteur et sa date, retombe à « désactivé » si la contribution est
retirée, et ne reprend jamais seule.

Chemin d'un document (`server/knowledge/autoContribution.ts`), en tâche de fond, toutes les
minutes, et seulement si `MISTRAL_KNOWLEDGE_PUBLISH_ENABLED=true` :

1. **Mise en file** au dépôt (`POST /api/documents`) si le type est choisi ; jamais un
   fichier hors du stockage du cabinet ni de plus de 15 Mo. « Traiter aussi les documents
   déjà présents » est un geste explicite, jamais fait à l'activation.
2. **Lecture** du texte (même extracteur que le partage manuel, jamais le parseur Nomic).
3. **Valeurs du cabinet** (`tenantIdentifiers.ts`) : contacts, clients, affaires, adresses,
   équipe, agence, lues dans SA base et masquées localement (casse, accents et espaces
   ignorés, valeurs de moins de 4 caractères et mots du métier exclus). Une lecture qui
   échoue interrompt le traitement : jamais de liste incomplète sans que personne le sache.
4. **Règles** (`anonymize.ts`) : e-mails, téléphones, SIRET, adresses (abréviations
   comprises), codes postaux, communes, parcelles, permis, coordonnées GPS, montants,
   « M. Dupont », « X SAS », lignes étiquetées (« Maître d'ouvrage : ... » jusqu'à la fin
   de la phrase).
5. **Relecture IA** (`aiReview.ts`, `MISTRAL_KNOWLEDGE_REVIEW_MODEL`, `mistral-large-latest`
   par défaut) du texte déjà masqué, par lots. Le modèle ne réécrit rien : il désigne des
   passages exacts que le code masque lui-même ; un passage absent du texte est ignoré, une
   réponse illisible fait échouer le lot (nouvel essai, jamais d'envoi sans relecture).
   Le coût est porté par le compte Mistral de l'opérateur et n'est pas refacturé.
6. **Tri par paragraphe** : un paragraphe est retenu (non envoyé) si l'IA signale un risque
   d'identifiants non désignés ou si un nom propre probable ou un numéro long subsiste.
   Sous 200 caractères partageables, tout est retenu.
7. **Envoi** de l'extrait propre, avec le mécanisme de réservation, de rapprochement et de
   suppression de `publishContribution.ts`, dans la limite de 25 envois par cabinet et par 24 h.

L'écran (Documents > Mémoire technique collective) montre le parcours, demande les deux
autorisations avec leur portée, et tient un **journal** : état de chaque document en toutes
lettres, bilan (paragraphes envoyés, retenus, éléments masqués par catégorie), texte exact
transmis avec les passages masqués en évidence, paragraphes retenus et leur raison, retrait
en un clic.

Migration : `supabase/migrate_knowledge_zzz_auto_sharing.sql` (réglage du cabinet, origine,
mode de relecture, paragraphes retenus, rapport d'analyse, nouveaux états `queued`,
`analyzing`, `held`). Le code reste compatible avec une base où elle n'est pas passée : le
partage automatique y est simplement désactivé.

**Limites** : aucune détection n'est parfaite ; une IA et des règles ne garantissent pas
l'anonymat, d'où le tri par paragraphe et le retrait en un clic. La suppression d'un texte
dans la bibliothèque n'efface pas ce qui en aurait déjà été déduit chez le fournisseur.
Les clients, entreprises et personnes cités n'ont pas consenti à ce partage : le cabinet
en répond. Le contrat de traitement des données avec Mistral doit couvrir la relecture
d'un texte non validé.
