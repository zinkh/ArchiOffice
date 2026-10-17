# Exploitation d'ArchiOffice (France)

**Garde-fous.** Ce document décrit comment faire tourner un éditeur de logiciel en abonnement avec très peu de personnes. Il s'appuie sur le dépôt (`Dockerfile`, `.env.example`, `server/tenantBackup.ts`, `SECURITY.md`) et sur des recherches web non confirmées sur les pages officielles. **Aucun prix de fournisseur n'a été confirmé sur sa grille publique** sauf mention contraire. Les règles de droit, de fiscalité et de protection des données évoluent : à confirmer avec un expert-comptable, un avocat ou l'autorité compétente. Ce n'est pas un avis juridique.

## 1. Le cycle quotidien

Les étapes marquées **(client)** sont celles que le client voit.

1. **Contrôle du matin (15 minutes)** : tableau d'erreurs (Sentry), disponibilité de l'application, file d'e-mails d'envoi, dernière sauvegarde.
2. **Boîte de support (client)** : réponse aux messages reçus avant midi ; une promesse tenable est « réponse sous un jour ouvré ».
3. **Démos et mises en route (client)** : visioconférences avec les agences en essai ou en reprise de données.
4. **Développement et correctifs** : une demi-journée par semaine au minimum pour corriger les anomalies et mettre à jour les dépendances.
5. **Facturation et encaissements** : suivi des abonnements, des échecs de paiement, des factures émises.
6. **Contenu et prospection (client)** : une à deux publications LinkedIn par semaine, relances personnelles.
7. **Clôture du jour (10 minutes)** : file de support vide ou notée, tâches du lendemain, incident éventuel consigné.

## 2. Fournisseurs

| Poste | Fournisseur | Prix connu | Source et statut |
| --- | --- | --- | --- |
| Base de données, authentification, fichiers | **Supabase** | Pro à 25 $ par mois et par organisation, plus le calcul de chaque projet au-delà du crédit inclus (10 $ par mois) | [Supabase](https://supabase.com/pricing.md) via [JetAdmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) ; région d'hébergement du projet **non connue** |
| Serveur de l'application (conteneur) | à choisir : **Scalingo**, **OVHcloud**, **Infomaniak** | non relevé | consulter la grille publique de chacun ; devis à demander ; le `Dockerfile` existe, l'hébergeur actuel n'est pas connu |
| Paiement par carte | **Stripe** | 1,5 % + 0,25 € pour une carte standard de l'EEE | [Wise](https://wise.com/fr/blog/stripe-carte-bancaire-paiement), [Indy](https://www.indy.fr/guide/comptabilite-en-ligne/commerce/stripe-comptabilite/frais-stripe/) ; page officielle non consultée |
| Suivi des erreurs | **Sentry** (déjà configuré par `SENTRY_DSN`) | palier gratuit existant, non relevé | consulter la grille publique |
| E-mail transactionnel | SMTP du cabinet (`SMTP_HOST`) | non relevé | à confirmer avec votre fournisseur de messagerie |
| Expert-comptable | à choisir | devis | 50 € par mois estimés dans `numbers.json`, non confirmés |
| Assurance RC professionnelle et cyber | courtier (AssurUp, Philtr, AIG parmi les sources) | RC pro seule : 150 à 300 € par an pour une jeune entreprise ; cyber : non chiffré | [Appvizer](https://www.appvizer.fr/magazine/organisations/startup/assurance-startup), [AssurUp](https://www.assurup.com/activities/edition-logiciels-mode-saas) ; devis à demander |
| Fournisseurs d'IA (Gemini, Claude, Mistral) | facturés au jeton, refacturés avec marge | non relevé | hors du calcul de base, voir `CLAUDE.md` section facturation IA |

**Comparaison avec `numbers.json`.** Les charges fixes estimées (160 € par mois hors temps de travail) restent plausibles : Supabase 35 €, serveur 20 €, outils 15 €, comptable 50 €, assurance 40 €. Aucun prix réel ne les contredit, aucune mise à jour du fichier n'est faite. **Les 150 à 300 € par an de RC pro correspondent à 12 à 25 € par mois, la cyber s'y ajoute : à confirmer par devis.**

## 3. Les personnes et le temps

**Qui fait quoi.** Une personne (le fondateur) assure développement, support, démos et prospection. Un renfort ponctuel est prévu pour la mise en route des 10 premières agences.

**Charge estimée du mois de lancement (mon estimation, à ajuster) :**

| Activité | Heures par mois |
| --- | ---: |
| Contrôle du matin, support, clôture (30 minutes par jour ouvré) | 10 |
| Démos (8 de 1 h 30) | 12 |
| Mises en route accompagnées (3 de 3 h) | 9 |
| Contenu et prospection (2 publications par semaine, 1 h chacune) | 8 |
| Facturation, comptabilité, administratif | 3 |
| Maintenance et correctifs | 12 |
| **Total** | **54** |

**Écart avec le calcul financier.** Le cas B de `cfo.md` finance 1 500 € par mois de temps payé, soit environ 30 heures à 50 € de l'heure (taux d'hypothèse). La charge estimée est de 54 heures : **le cas B finance donc environ la moitié du temps nécessaire au mois de lancement.** À 2 750 € par mois (54 heures à 50 €) et 160 € de charges fixes, l'outil du calcul financier donne un seuil de rentabilité de **81 agences**, une marge de -33 % à 60 agences, un résultat d'exploitation de -27 624 € en année 1 et 32 624 € de trésorerie à avancer. **Le calcul financier doit être relancé avec cette hypothèse avant de décider.** Ce chiffre est ma propre estimation d'heures, pas un coût constaté.

**Semaine type (mois de lancement) :**
- Lundi : contrôle, support, planification des démos.
- Mardi et jeudi : démos et mises en route.
- Mercredi : développement et correctifs.
- Vendredi : prospection, contenu, point de la semaine (trois chiffres de `marketing.md`).

Les charges sociales du temps payé (salaire, régime du dirigeant) dépendent du statut et ne sont pas calculées ici : à confirmer avec l'expert-comptable.

## 4. Routines (une page chacune)

**A. Ouvrir la journée**
1. Ouvrir le tableau d'erreurs : classer les nouvelles erreurs (bloquante, gênante, mineure).
2. Vérifier que l'application répond et que la connexion fonctionne.
3. Vérifier que la dernière sauvegarde est datée de moins de 24 heures.
4. Lire la boîte de support : répondre, ou noter la date de réponse.
5. Noter dans le journal tout incident de la veille.

**B. Mettre en route une agence** (visio, 2 heures)
1. Avant : demander la liste des projets en cours, des contacts et de la dernière facture émise (numéro et date).
2. Créer le cabinet, inviter l'administrateur.
3. Reprendre les contacts, puis un projet en cours avec ses lots et son DPGF.
4. Poser la numérotation des factures sur le dernier numéro de l'agence, vérifier en émettant une facture brouillon.
5. Montrer l'export complet et le téléphone en chantier.
6. Après : envoyer un résumé écrit et un contact direct, noter les points bloquants.

**C. Traiter une réclamation ou un incident**
1. Accuser réception dans l'heure ouvrée.
2. Reproduire le problème ; si une facture ou un document légal est touché, le traiter en priorité.
3. Dire au client ce qui s'est passé, ce qui est fait, à quelle date.
4. Corriger, ajouter un test qui aurait détecté l'erreur.
5. Appeler le client si l'erreur lui a coûté quelque chose.
6. Consigner l'incident dans le journal, vérifier si d'autres clients sont touchés.

**D. Clôturer la journée**
1. Support : aucun message sans réponse ou date de réponse notée.
2. Journal : incidents et décisions du jour.
3. Préparer les trois démos ou tâches du lendemain.

**E. Revue hebdomadaire (vendredi, 45 minutes)**
1. Mettre à jour les dépendances ayant une alerte de sécurité.
2. Tester la restauration d'une sauvegarde sur un environnement séparé (une fois par mois au minimum).
3. Relever les trois nombres de `marketing.md`.
4. Vérifier les paiements échoués et relancer.
5. Revoir les coûts réels contre `numbers.json`.

## 5. Outils (la pile minimale)

| Besoin | Outil | Pourquoi | Prix |
| --- | --- | --- | --- |
| Base, authentification, fichiers | Supabase | déjà utilisé par le produit | 25 $ par mois (Pro) |
| Serveur | hébergeur à choisir (voir section 2) | le conteneur existe déjà | non relevé |
| Paiement | Stripe | abonnement par carte, factures | 1,5 % + 0,25 € |
| Suivi d'erreurs | Sentry | déjà branché | palier gratuit, à vérifier |
| Comptabilité | expert-comptable et logiciel de facturation avec facture électronique | éviter d'inventer sa propre comptabilité | devis |
| Support | boîte partagée `support@`, réponse sous un jour ouvré | simple, tenable à une personne | gratuit avec votre messagerie |
| Prise de rendez-vous pour les démos | outil de prise de rendez-vous au choix | éviter les échanges d'e-mails | non relevé |

## 6. Obligations, assurances et démarches (France)

Pour chaque ligne, **confirmer auprès de l'autorité ou d'un professionnel**. Ce tableau n'est pas exhaustif.

| Sujet | À faire | Où confirmer |
| --- | --- | --- |
| **Structure juridique** | Choisir la forme (société ou entreprise individuelle), de préférence **distincte de votre agence d'architecture** ; poser la question à l'expert-comptable | [Guichet unique des formalités](https://formalites.entreprises.gouv.fr/) |
| **TVA** | Franchise en base possible sous un seuil pour les prestations de services (37 500 € HT d'après [Keobiz](https://www.keobiz.fr/le-mag/sas-tva/), à confirmer) ; sans franchise, les prix de `pricing.md` (29 € et 59 €) sont **hors taxes** et les clients paieront 20 % de plus : le panel n'a pas précisé HT ou TTC | [impots.gouv.fr](https://www.impots.gouv.fr/) |
| **Mentions légales, conditions générales de vente et d'utilisation** | Rédiger des conditions B2B (clients professionnels) : durée, résiliation, responsabilité, export des données | [service-public.fr](https://www.service-public.fr/) ou avocat |
| **Protection des données** | ArchiOffice est en principe **sous-traitant** au sens du RGPD pour les données de ses clients : contrat de sous-traitance avec chaque client, registre des traitements de sous-traitant, liste des sous-traitants ultérieurs (Supabase, hébergeur, fournisseurs d'IA, Stripe, Sentry) ([source non officielle](https://www.donneespersonnelles.fr/rgpd-editeur-saas)) | [CNIL](https://www.cnil.fr/) |
| **Transferts hors Union européenne** | Les fournisseurs d'IA et certains outils sont des sociétés américaines : décrire les transferts et leur cadre dans le contrat | [CNIL](https://www.cnil.fr/) |
| **Facturation électronique, côté ArchiOffice lui-même** | Recevoir des factures électroniques depuis le 1er septembre 2026, en émettre à partir du 1er septembre 2027 d'après les sources de `marketing.md` ; vérifier comment vos propres abonnements sont facturés | [impots.gouv.fr](https://www.impots.gouv.fr/) |
| **Assurance** | RC professionnelle d'éditeur de logiciel et assurance cyber | courtier, voir section 2 |
| **Statut d'hébergeur** | Vérifier si l'hébergement de contenu de clients entraîne des obligations particulières | avocat |
| **Marque** | Vérifier « ArchiOffice » avant tout investissement, voir `brand.md` | INPI, EUIPO |
| **Licences des dépendances** | Contrôler que les licences open source du produit autorisent une vente en abonnement | avocat ou outil d'analyse de licences |

## 7. Registre des risques

| N° | Risque | Probabilité | Gravité | Plan |
| --- | --- | --- | --- | --- |
| 1 | **Indisponibilité du fondateur** (maladie, charge) : un seul mainteneur | moyenne | haute | Documenter les accès et les routines ; désigner une personne de confiance avec accès d'urgence ; dire la limite dans les conditions. |
| 2 | **Panne de la base ou du serveur** | moyenne | haute | Page de statut, message aux clients, hébergeur avec reprise ; contrat avec délai d'intervention réaliste. |
| 3 | **Sauvegarde jamais testée** | moyenne | très haute | Test de restauration mensuel (routine E) ; sauvegarde hors du fournisseur principal. |
| 4 | **Erreur de facture ou de numérotation chez un client** | basse | très haute | Tests du numérotage (déjà en place d'après `CLAUDE.md`) ; routine C en priorité ; vérification à la mise en route. |
| 5 | **Fuite de données** | basse | très haute | Mises à jour de sécurité hebdomadaires ; accès par cabinet testés ; assurance cyber ; procédure de notification dans les 72 heures. |
| 6 | **Coût de l'IA hors de contrôle** | basse | moyenne | Réserve, exécution, règlement par appel déjà en place d'après `CLAUDE.md` ; plafonds par cabinet. |
| 7 | **Affirmation de conformité à la facturation électronique non vérifiée** | moyenne | haute | Ne rien promettre avant vérification (voir `marketing.md`) ; relecture juridique. |
| 8 | **Conflit sur le nom** avec le logiciel homonyme | moyenne | haute | Vérification de marque avant lancement (voir `brand.md`). |
| 9 | **Peu de conversions**, aucune référence | haute | haute | Réaliser les préalables de `offer.md` ; arrêter ou pivoter si les trois nombres de `marketing.md` restent sous le seuil après 4 semaines. |
| 10 | **Support saturé** à partir d'une dizaine d'agences | moyenne | moyenne | Base d'aide courte, mises en route standardisées, embaucher ou externaliser à partir du seuil que le calcul financier rend rentable. |

## 8. Questions ouvertes
- Où est hébergé le projet Supabase (région) et le serveur de l'application ?
- Quelle sauvegarde existe en production ? (`server/tenantBackup.ts` existe, sa planification et sa conservation ne sont pas vérifiées ici.)
- Quelle structure juridique et quel statut du fondateur pour les charges sociales ?
- Comment les abonnements seront-ils facturés et par quel outil ?
- Quel est le taux horaire réel du temps payé ?

Prochaine étape : relancer `/founder-cfo` avec 2 750 € de temps payé, puis `/founder-launch`.
