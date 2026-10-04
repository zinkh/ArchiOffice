---
target: fiche affaire ProjectDetail
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/ArchiOffice/src/pages/ProjectDetail.tsx"
target_fingerprint: "sha256:7d6e7b14ca676cac5922fdf6ed905059ead6bb69df244371cfe495e786ece3c9"
target_path: /home/user/ArchiOffice/src/pages/ProjectDetail.tsx
timestamp: 2026-10-03T16-35-36Z
slug: src-pages-projectdetail-tsx
closed: true
---
# Critique ProjectDetail.tsx (2e passage) : 24/40 (Acceptable)

| # | Heuristique | Note | Problème |
|---|---|---|---|
| 1 | Visibilité de l'état | 3 | deleteNote sans contrôle de res.ok (:2676) |
| 2 | Monde réel | 3 | « Facture » de l'aperçu mène aux factures entreprises (RDT) |
| 3 | Contrôle | 2 | « Annuler » quitte la fiche ; aucune annulation de suppression |
| 4 | Cohérence | 2 | Trois modèles d'enregistrement ; deux bleus ; ~190 textes hors i18n |
| 5 | Prévention | 3 | Confirmation HT/TTC, mot à saisir pour supprimer |
| 6 | Reconnaissance | 2 | Sigles seuls au 2e niveau sur téléphone ; aides en title |
| 7 | Efficacité | 3 | Ctrl+S, ?tab, flèches ; pas au 2e niveau |
| 8 | Minimalisme | 2 | En-tête à 14 cibles ; encarts bleus RDT |
| 9 | Erreurs | 2 | Échec de chargement silencieux ; chargement infini hors ligne sans cache |
| 10 | Aide | 2 | Règle de quote-part non expliquée à l'écran |

Détecteur : 0 constat sur 15 fichiers.

## Problèmes prioritaires
- [P1] « Facture » (ProjectOverview.tsx:393-403) grisé hors chantier et mène à RDT au lieu des honoraires. clarify.
- [P1] « Annuler » (:1797) quitte la fiche ; note/OS/avenant en cours hors de la garde isDirty. harden, clarify.
- [P1] 12 confirm() natifs (facture :2696 comprise), suppressions sans annulation, deleteNote sans res.ok. harden.
- [P2] Ventilation : champs nommés par title seul (:2907-2957), Répartir sans aria-label, pas de vue mobile. adapt.
- [P2] Corps des onglets hors charte : bg-blue-600, zinc, rounded-xl stepper, encarts RDT, champs dupliqués. polish, quieter.

## Persona
Alex : 2e niveau sans flèches. Sam : pas de tabpanel, corbeille d'en-tête sans aria-label, Prochaines tâches en div onClick, labels sans htmlFor, calque de couverture (:3190) au survol seul. Chantier : en-tête sur 3 lignes, sigles seuls, corbeille près d'Enregistrer, DET/RDT en tableaux.

## Mineurs
:1729 titre 16 px ; :1737 statut en bleu et texte en dur ; jalons/tâches même style ; programme tronqué ; numéros d'étape décoratifs ; :5166 w-full ; 5 textes anglais ; 66 boutons sans type ; fichier de 5 719 lignes.
