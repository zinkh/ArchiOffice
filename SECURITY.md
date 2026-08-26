# Politique de sécurité

## Signaler une vulnérabilité

Merci de ne **pas** ouvrir d'issue GitHub publique pour une vulnérabilité de
sécurité. Contactez-nous directement à **privacy@archioffice.fr** en
décrivant :

- le composant concerné (URL, endpoint API, page) ;
- les étapes pour reproduire ;
- l'impact potentiel.

Nous accusons réception sous 72h et visons une résolution des failles
critiques sous 30 jours. Un correctif est déployé avant toute divulgation
publique.

> **À compléter par l'équipe** : une adresse dédiée `security@archioffice.fr`
> (distincte de `privacy@`) et, si souhaité, une politique de divulgation
> responsable avec barème de récompense (bug bounty) peuvent être ajoutées
> ici une fois décidées — hors périmètre de ce qu'un correctif de code peut
> établir seul.

## Procédure de réponse à incident

Déclenchée par : une alerte Sentry de sévérité critique, un signalement
externe (voir ci-dessus), une anomalie détectée dans `admin_audit_log`, ou
une notification d'un sous-traitant (Supabase, Google, etc.).

1. **Qualification (< 4h)** — confirmer l'incident, évaluer le périmètre
   (quels tenants, quelles données, RGPD-notifiable ou non), désigner un
   responsable de la réponse.
2. **Confinement** — révoquer les identifiants compromis (clés API dans le
   dashboard Supabase, jetons OAuth via les routes `/api/*/disconnect`,
   rotation de `MAIL_ENCRYPTION_KEY`/`SUPABASE_SERVICE_ROLE_KEY` si
   nécessaire), couper l'accès concerné.
3. **Éradication & remédiation** — corriger la cause racine, déployer le
   correctif, vérifier via les tests de régression concernés
   (`tests/tenantIsolation.test.ts`, `tests/rbac.test.ts`, etc. selon la
   nature de l'incident).
4. **Notification** — voir les délais réglementaires ci-dessous.
5. **Post-mortem** — document interne : chronologie, cause racine, actions
   correctives, ajout d'un test de non-régression.

### Délais de notification réglementaires

- **RGPD (violation de données à caractère personnel)** : notification à la
  CNIL dans les **72 heures** suivant la prise de connaissance (art. 33),
  et aux personnes concernées « dans les meilleurs délais » si le risque est
  élevé pour leurs droits et libertés (art. 34).
- **NIS2** (si applicable à ArchiOffice ou à un client soumis à la
  directive) : alerte précoce à l'ANSSI/au CSIRT national sous **24h**,
  notification d'incident sous **72h**, rapport final sous **1 mois**.

> **À compléter par l'équipe** : coordonnées du DPO (ou de la personne qui en
> tient le rôle), contact CSIRT national applicable (ANSSI/CERT-FR pour la
> France), et confirmation du statut d'ArchiOffice au regard de NIS2 (voir
> note dans l'audit de conformité — un éditeur SaaS n'est en général pas
> lui-même une entité « essentielle »/« importante », mais peut être évalué
> comme fournisseur par des clients qui le sont).

## Sous-traitants et hébergement

La liste des sous-traitants de données (Supabase, Google Gemini, Stancer,
Sentry, et les intégrations optionnelles Zoho/Odoo/Ragic/Chorus&nbsp;Pro) est
tenue à jour dans la Politique de confidentialité de l'application
(`src/pages/PrivacyPolicy.tsx`, section « Partage des données ») — c'est la
source de vérité, à garder synchronisée avec celle-ci plutôt que dupliquée.

> **À compléter par l'équipe** : région d'hébergement effective (Supabase
> project region, région de l'API Gemini utilisée) et référence des accords
> de traitement des données (DPA) signés avec chaque sous-traitant. La
> Politique de confidentialité affirme l'usage de Clauses Contractuelles
> Types pour les transferts hors UE ; ce fichier ne peut pas se substituer
> à la vérification que ces clauses sont bien signées et archivées.

## Mesures techniques en place

- Isolation multi-tenant par Row-Level Security (Postgres/Supabase),
  vérifiée par `tests/tenantIsolation.test.ts`.
- Chiffrement au repos des secrets sensibles (mots de passe IMAP, jetons
  OAuth des intégrations connectées) — `server/secretsCrypto.ts`.
- RBAC vérifié côté serveur (jamais via un en-tête client) —
  `tests/rbac.test.ts`.
- En-têtes de sécurité (Helmet, CSP, HSTS) et liste blanche CORS —
  `server.ts`.
- Scan de vulnérabilités des dépendances à chaque build (`npm audit`,
  `.github/dependabot.yml`).
- Journal d'audit des actions d'administration plateforme, infalsifiable
  (chaînage de hash + interdiction de modification/suppression appliquée
  par trigger, y compris pour la clé service_role) —
  `server/adminAudit.ts`, `supabase/migrate_platform_admin_audit_hash_chain.sql`.
- Export et effacement des données en libre-service (droits RGPD) —
  `server/tenantExport.ts`, `server/tenantPurge.ts`.

## Vulnérabilités de dépendances connues et non corrigées

Suivies via Dependabot plutôt que forcées en urgence, car chacune nécessite
soit une mise à jour majeure incompatible, soit n'a aucun correctif amont :

- **nodemailer** (`^8.0.1`) : CVE nécessitant un passage en v9 (changement
  majeur) — évalué comme risque limité, notre usage ne définit pas
  `disableFileAccess`/`disableUrlAccess` ni n'expose l'option `raw` à une
  entrée utilisateur.
- **quill / react-quill** : XSS connu, correctif amont uniquement disponible
  en rétrogradant vers une version non fonctionnelle — en attente d'un vrai
  correctif upstream.
- **xlsx (SheetJS)** : pollution de prototype et ReDoS, aucun correctif
  disponible sur le registre npm à ce jour.

## Authentification multifacteur

Voir le paramètre de sécurité du compte (Profil > Sécurité) pour activer la
double authentification (TOTP).
