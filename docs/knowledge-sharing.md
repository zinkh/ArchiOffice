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
