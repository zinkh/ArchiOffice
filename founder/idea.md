# ArchiOffice

- What it is: plateforme SaaS de gestion pour agences d'architecture françaises, vendue par abonnement mensuel. Elle couvre le cycle de vie d'un projet : devis, appels d'offres, factures (Factur-X), CCTP/DPGF, planning Gantt, comptes-rendus de chantier, cadastre et PLU. Assistants IA intégrés (réservés à l'offre Entreprise).
- Who it is for: agences d'architecture en France (de l'architecte seul aux cabinets de 10 personnes et plus), vocabulaire et obligations métier français (loi MOP, ACT, DET, AOR).
- What it sells, at what price: abonnement mensuel. Essai gratuit (3 projets, 1 utilisateur, 100 Mo). Starter 29 EUR/mois (10 projets, 2 utilisateurs, 1 Go). Pro 59 EUR/mois (projets illimités, 10 utilisateurs, 10 Go, toutes les intégrations). Entreprise sur devis (utilisateurs illimités, IA, SLA, formation sur site). Source : src/lib/billing.ts du produit.
- Where and how: en ligne (application web, PWA, client de bureau Electron avec mode hors ligne). Acquisition non définie à ce stade.
- Budget and constraints: non précisés par le fondateur. Le produit existe déjà et est développé par un architecte praticien (Atelier d'Architecture Zomeno Sektaoui, Vandoeuvre-lès-Nancy) qui l'utilise dans sa propre agence. Charges d'exploitation à connaître : hébergement Supabase, coût des appels IA au jeton (refacturés avec marge).
