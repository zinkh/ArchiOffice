# Enregistrer une réunion et préparer ses notes

Dans **Réunions**, ouvrir une réunion : le panneau **Enregistrer la réunion** se trouve au-dessus des notes. Dans **Projet → DET → Comptes rendus**, ouvrir un compte rendu : le même panneau précède les rubriques.

1. Informer les participants, puis sélectionner **Démarrer l’enregistrement** et autoriser le microphone du téléphone ou de l’ordinateur.
2. Garder la page ouverte et l’écran allumé. L’enregistrement est découpé automatiquement en séquences de cinq minutes, ou plus tôt si leur taille atteint 8 Mio. Chaque séquence est un fichier audio indépendant ; la capture continue entre les séquences avec le même microphone.
3. Sélectionner **Arrêter**, puis réécouter l’audio si nécessaire. Chaque séquence peut être téléchargée.
4. Sélectionner **Transcrire et préparer les notes**. Une connexion, le plan Enterprise actif, des crédits IA et un fournisseur de transcription configuré sont nécessaires. La configuration et la facturation existantes du cabinet s’appliquent : `/api/agents/transcribe` pour la transcription, puis `/api/meeting-notes/generate` pour la rédaction.
5. Corriger la transcription ou les notes proposées. Les rubriques distinguent sujets, décisions, actions et points à confirmer. La préparation ne crée pas de tâche et n’envoie pas de compte rendu.
6. Sélectionner **Ajouter aux notes de réunion** ou **Ajouter aux rubriques du compte rendu**. Les notes classiques sont complétées sans effacer le texte existant ; une rubrique « Notes de réunion » est ajoutée au compte rendu DET. Les circuits d’enregistrement et de synchronisation hors ligne existants sont réutilisés.

L’audio et le brouillon restent dans le navigateur de cet appareil, séparés par utilisateur, cabinet, type et identifiant de réunion. Ils ne sont pas une pièce jointe audio synchronisée entre les appareils. Ils sont transmis au fournisseur IA seulement à la demande de conversion. Le bouton **Supprimer le brouillon audio** supprime cette copie locale, sans toucher aux notes déjà ajoutées.

En cas d’erreur, réessayer la conversion reprend à la première séquence non transcrite ; les séquences déjà traitées restent disponibles. Si la rédaction échoue après la transcription, celle-ci peut être ajoutée seule ou utilisée pour relancer la préparation. Quitter la réunion arrête le microphone et conserve le brouillon pour cette réunion. Une fermeture forcée, une mise en veille ou les restrictions du navigateur mobile peuvent interrompre la capture ; réécouter les séquences récupérées avant conversion. Une erreur de stockage local est affichée et invite à télécharger l’audio.

## Vérifications

- `tests/meetingRecorder.test.ts` : découpage, assemblage des conteneurs, taille, arrêt pendant rotation, permissions tardives, interruption, formats MP4/WebM.
- `tests/meetingRecordingPanel.test.ts` : restauration, reprise sans retranscrire les séquences réussies, insertion explicite, erreurs de sauvegarde, changement de réunion, accès selon le plan.
- `tests/meetingNotesAi.test.ts` : validation, plan actif, isolation du cabinet, réserve/règlement/remboursement des crédits et génération sans outils d’agent.
- `e2e/meeting-recording.spec.ts` : microphone simulé Chromium mais MediaRecorder et IndexedDB réels, rechargement, conversion et ajout dans les deux contextes, formats ordinateur/mobile. Le fournisseur IA est simulé ; ces tests ne mesurent pas la qualité de reconnaissance d’une réunion réelle.

Aucune migration Supabase n’est nécessaire. Les notes utilisent les tables existantes ; le brouillon audio utilise une base IndexedDB locale dédiée.
