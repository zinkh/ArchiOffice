---
target: la page reunions de chantier
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 1
target_identity: "file:/home/user/ArchiOffice/src/pages/Reunions.tsx"
target_fingerprint: "sha256:7007464d581e7a9421cf0baacb3b08cc693da565d4f7f1d825622cd1540b87e5"
target_path: /home/user/ArchiOffice/src/pages/Reunions.tsx
timestamp: 2026-11-18T16-58-00Z
slug: src-pages-reunions-tsx
---
Method: dual-agent (A : revue de design, B : detecteur)

# Critique de src/pages/Reunions.tsx

Score 20/40 (Acceptable). Heuristiques : 1=2, 2=3, 3=2, 4=2, 5=2, 6=3, 7=1, 8=2, 9=2, 10=1.

## Verdict de specificite
Interchangeable (trois colonnes liste / sous-liste / detail), sauf la robustesse hors ligne, vrai parti pris mais invisible. Detecteur : 14 avertissements (12 design-system-color, 2 design-system-font-size). Reels : jaunes en dur #fff3bf, #e67700, #ffe066 (l.223, 330, 376), text-[0.5625rem] (l.1102, 1191). Faux positifs : valeurs de repli de var(--tblr-warning) (l.1344, 1417, CroquisPanel.tsx:219, SignedImage.tsx:83). Pas de verification navigateur (session Supabase requise).

## Points forts
1. Hors ligne exemplaire (brouillon synchrone, id de file stable, badges en attente).
2. Reflexes tactiles par endroits (PhotoSourcePicker, pointer-coarse:min-h-11 l.1539).
3. CollapsiblePanel, MeetingRecordingPanel, CroquisPanel : reference d'accessibilite.

## Problemes prioritaires
- [P0] Suppressions et commandes invisibles ou trop petites au toucher (l.1354 a 1362, photos l.1584 a 1600, intervenants l.241, 242, 254). Correctif : visibilite permanente sous pointer-coarse, cibles 44 px, aria-label, useConfirmDialog, suppression annulable. Commandes : adapt, harden.
- [P0] Navigation principale inutilisable au clavier et au lecteur d'ecran (div onClick l.1324 a 1327, champs sans label, focus ring-1 bleu hors charte, modales sans role). Commandes : harden, audit.
- [P1] Etat d'enregistrement et hors ligne invisibles (l.1498 statique, echecs avales l.800, erreurs de liste .catch vide l.508 a 528). Commandes : clarify, delight.
- [P2] Hierarchie plate : intervenants et dictee avant les notes, cinq h2 identiques, hr superflus. Commandes : layout, shape.
- [P2] Ecart avec la charte : rounded-xl, hex en dur, 9 px, deux bleus, survols JavaScript, survol rouge sur PDF. Commandes : quieter, polish.

## Personas
Alex : aucun raccourci, aucun modele, recherche limitee aux parents.
Casey : trois niveaux de navigation, Retour 12 px hors pouce, actions au survol, formulaire contact a 7 champs.
Sam : lignes non focalisables, icones sans nom, modales sans role.

## Observations mineures
Upload... a traduire, trois points ASCII, page presque entierement hors t(), max-w en px, date UTC, cinq eslint-disable, 1697 lignes.

## Questions
Ouvrir sur Mes reunions par date ? Difference avec le compte-rendu de chantier ? Reunion comme fil de captures ? Comment rassurer vraiment sur le hors ligne ?
