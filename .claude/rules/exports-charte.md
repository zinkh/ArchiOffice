---
paths:
  - "src/lib/pdfLetterhead.ts"
  - "src/lib/xlsxLetterhead.ts"
  - "src/lib/docxRunningHeader.ts"
  - "src/lib/*Export*.ts"
  - "src/lib/*Pdf*.ts"
  - "server/artifacts.ts"
  - "server/agencyIdentity.ts"
---

# Exports PDF, Excel, Word : charte du cabinet

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Exports PDF et Excel : une seule charte

Tout document produit depuis l'interface porte la charte du cabinet : en-tête
(logo, coordonnées, titre à droite), tableaux en nuances de gris, pied de page
(adresse, SIRET...) et pagination « P1|2 » en bas à droite. La couleur n'est
admise que pour une donnée qui en a besoin (statut d'une réserve, retard).

- **Logo sur la première page seulement.** Le logo (et les coordonnées, le bandeau des cotraitants) ne
  s'imprime que sur la PREMIÈRE page. Les pages suivantes portent un en-tête d'UNE seule ligne : le nom de
  l'agence en texte à gauche, le nom du document à droite, jamais le logo. PDF : `drawAgencyHeader()` dessine
  seul cette ligne dès qu'il est appelé au-delà de la page 1 (`drawCompactHeader`), et `drawAgencyFooters()`
  l'ajoute aux pages restées sans en-tête ; ne jamais redessiner l'en-tête complet après un `addPage()`.
  Excel : `ajouterFeuille()` pose `differentFirst` (première page sans en-tête d'impression, les suivantes
  « agence | document »). Word : `docxSectionChrome()` (`src/lib/docxRunningHeader.ts`) pose `titlePage`
  et les deux en-têtes (complet en première page, ligne réduite ensuite) ; tout nouvel export Word passe
  par lui. Documents d'agent (`artifacts.ts`) : même règle en PDF, en Word et en Excel (ExcelJS, plus
  SheetJS qui n'écrit pas les en-têtes d'impression).
- **PDF** : `src/lib/pdfLetterhead.ts` (`drawAgencyHeader`, `drawAgencyFooters`,
  `tableauGris()` / `TABLEAU_GRIS` pour les tableaux autoTable, `fetchAgencySettings()`
  pour un générateur qui n'a pas les réglages sous la main). Ne plus écrire de
  bandeau coloré ni de « Page i/n » à la main.
- **Excel** : `src/lib/xlsxLetterhead.ts`, sur ExcelJS (chargé à la demande) :
  `ajouterFeuille()` pose l'en-tête, l'entête de tableau, le volet figé et la mise
  en page d'impression (A4 ajusté en largeur, titres répétés, pied avec `&P|&N`) ;
  `exporterListe()` couvre une simple liste. SheetJS (`xlsx`) ne reste utilisé que pour
  LIRE des imports : il ne sait ni styler ni placer une image. Un montant reste un
  nombre dans la cellule (format `FORMAT_EURO`), jamais un texte formaté.
- **Les entreprises consultées** (ACT) sont classées par LOT, en PDF comme en Excel
  (`groupByLot`, `src/lib/actExport.ts`), plus par corps d'état. Une entreprise sur
  plusieurs lots apparaît sous chacun, une entreprise sans lot sous « Sans lot assigné ».
  Le rapport d'analyse des offres et le comparatif sont dans `src/lib/actAnalysisExport.ts`.
- **BPU/DQE** (`bpuExport.ts`) : le classeur est aussi un format d'aller-retour que
  `bpuImport.ts` relit. L'en-tête du cabinet y est donc libre (l'import repère la
  ligne d'entête de colonnes, `detectHeader`, pas un numéro de ligne), mais les
  INTITULÉS de colonnes, la colonne A (références `#L1`, `#C1.2`, `A1`...), les lignes de
  lot/chapitre non fusionnées et la feuille masquée `_meta` ne changent pas.
  `src/lib/__tests__/bpuExcelRoundTrip.test.ts` exporte puis relit.
- **Répartition d'honoraires** (`feeDistribution.ts`) : reste une calculette, ses formules
  visent des lignes décalées par l'en-tête, d'où un compteur de lignes tenu à l'écriture.
- **Hors périmètre** : la facture d'abonnement ArchiOffice (`subscriptionInvoice.ts`),
  émise par la plateforme et non par le cabinet, et les exports Word (hors règle de l'en-tête réduit ci-dessus).

### Charte sobre : documents générés, pas l'interface

La préférence de l'architecte pour le noir, le blanc et les gris, la couleur étant
réservée aux données qui en ont besoin, vaut pour les **documents générés** (PDF,
Word, Excel, courriers, exports) et **pas pour le code de l'interface**. L'interface
reste bleue : ses couleurs passent par les jetons `--tblr-*` (`--tblr-primary`,
`--tblr-primary-lt`, `--tblr-surface`...), jamais par des `bg-blue-*` / `text-blue-*`
figés qui ignorent le thème sombre. Les couleurs de statut (vert, ambre, rouge) sont des
données et restent.
