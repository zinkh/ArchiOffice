import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft, IconCommand } from '@tabler/icons-react';

const content = {
  en: {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: August 4, 2026',
    sections: [
      {
        heading: '1. Introduction',
        body: `ArchiOffice ("we", "our", or "us") is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and protect information about you when you use our SaaS platform for architecture project management (the "Service").

By using the Service, you agree to the collection and use of information in accordance with this policy.`,
      },
      {
        heading: '2. Data Controller',
        body: `The data controller responsible for your personal data is ArchiOffice, accessible at archioffice.fr. For any privacy-related questions, contact us at: privacy@archioffice.fr`,
      },
      {
        heading: '3. Data We Collect',
        body: `We collect the following categories of personal data:

• **Account data**: name, email address, password (hashed), company name, job title, phone number.
• **Professional data**: project information, client data, invoices, proposals, and documents you enter into the platform.
• **Usage data**: IP address, browser type, pages visited, actions performed, timestamps.
• **Communication data**: emails sent through the platform (SMTP configuration).
• **Payment data**: processed by our payment provider (Stripe); we do not store card numbers.`,
      },
      {
        heading: '4. Legal Basis for Processing',
        body: `We process your personal data on the following legal bases:

• **Contract performance**: to provide the Service you subscribed to.
• **Legitimate interest**: to improve the Service, ensure security, and prevent fraud.
• **Legal obligation**: to comply with applicable laws and regulations.
• **Consent**: for optional communications and marketing (you may withdraw consent at any time).`,
      },
      {
        heading: '5. How We Use Your Data',
        body: `We use your data to:

• Provide, maintain, and improve the Service.
• Manage your account and subscription.
• Send transactional emails (account confirmation, invoices, alerts).
• Respond to support requests.
• Comply with legal and regulatory obligations.
• Generate anonymized, aggregated statistics to improve the platform.`,
      },
      {
        heading: '6. Data Sharing',
        body: `We do not sell your personal data. We share it with the following sub-processors, each bound by a data processing agreement:

• **Supabase**: database, file storage and authentication for the whole Service.
• **Our hosting provider**: infrastructure hosting.
• **Stancer**: payment processing for your ArchiOffice subscription (Stripe is integrated but not yet in active use).
• **Google (Gemini API)**: AI-assisted drafting features (proposals, CCTP...) send the relevant project text to Google's Gemini API for processing.
• **Email providers**: transactional email delivery (SMTP), using either our platform mailer or your own SMTP configuration.
• **Sentry**: error monitoring for the Service, so we can detect and fix bugs. Technical error data may include your user ID and the route you were using; we filter out emails and access tokens before they reach Sentry.

In addition, if your cabinet chooses to enable one of the following optional integrations (Settings > Plugins), the data you explicitly sync through it is also shared with that provider, under your cabinet's own relationship with them: **Zoho** (Invoice/Books), **Odoo**, **Ragic**, or **Chorus Pro** (AIFE — Ministère de l'Économie, mandatory for public-sector e-invoicing). These integrations are off by default and only exchange data once your cabinet configures and enables them.

We may also share data with **legal authorities** when required by law, court order, or to protect rights and safety, and in a **business transfer** (merger, acquisition, asset sale), in which case users will be notified.`,
      },
      {
        heading: '7. Data Retention',
        body: `We retain your data for as long as your account or your cabinet's account is active.

• **Your personal profile data** (name, contact details, CV, avatar, education, experience) can be deleted immediately and permanently at any time, by yourself, from Profile > Confidentiality — no request or waiting period needed.
• **Your cabinet's professional data** (projects, invoices, documents, contacts...) is deleted through a cabinet-wide closure requested by an administrator (Settings > Danger Zone). This starts a 30-day grace period, cancellable at any time, after which the deletion runs automatically and permanently.
• **Legally mandated records** (in particular accounting documents, which French law requires to be kept for 10 years) are not affected by these deletions and remain your cabinet's responsibility to archive beforehand — use **Settings > Archiving** to download a complete, exploitable export of your cabinet's activity (a CSV file per data table plus every uploaded file) at any time, independently of any deletion request.
• Backup copies may persist for up to 60 additional days after a deletion.
• Anonymized usage statistics may be retained indefinitely.`,
      },
      {
        heading: '8. Data Security',
        body: `We implement industry-standard security measures including:

• All data transmitted over HTTPS/TLS.
• Passwords hashed using bcrypt.
• Row-Level Security (RLS) enforced at the database level via Supabase.
• Regular security audits and vulnerability assessments.
• Access to production data restricted to authorized personnel only.`,
      },
      {
        heading: '9. Your Rights (GDPR)',
        body: `If you are located in the European Economic Area, you have the following rights:

• **Right of access**: obtain a copy of your personal data.
• **Right to rectification**: correct inaccurate or incomplete data.
• **Right to erasure**: request deletion of your data ("right to be forgotten").
• **Right to restriction**: limit how we process your data.
• **Right to portability**: receive your data in a structured, machine-readable format.
• **Right to object**: object to processing based on legitimate interests.
• **Right to withdraw consent**: at any time, for consent-based processing.

You can exercise the rights of access, portability and erasure yourself, immediately, from Profile > Confidentiality (export or delete your personal profile data) and, for a cabinet administrator, from Settings > Archiving (export the cabinet's full activity) and Settings > Danger Zone (request full cabinet closure). For any other request, contact us at privacy@archioffice.fr — we will respond within 30 days.`,
      },
      {
        heading: '10. Cookies',
        body: `We use essential cookies to maintain your session and preferences. We do not use advertising or tracking cookies. You can configure your browser to refuse cookies, though some features may not function correctly.`,
      },
      {
        heading: '11. International Transfers',
        body: `Your data may be processed in countries outside the European Economic Area. When this occurs, we ensure appropriate safeguards are in place, such as Standard Contractual Clauses approved by the European Commission.`,
      },
      {
        heading: '12. Children\'s Privacy',
        body: `The Service is not directed to individuals under the age of 18. We do not knowingly collect personal data from minors. If we become aware that a minor has provided us with personal data, we will delete it immediately.`,
      },
      {
        heading: '13. Changes to This Policy',
        body: `We may update this Privacy Policy from time to time. We will notify you of significant changes by email or through a prominent notice in the Service at least 30 days before the change takes effect. Continued use of the Service after that date constitutes acceptance of the updated policy.`,
      },
      {
        heading: '14. Contact & Complaints',
        body: `For privacy inquiries: privacy@archioffice.fr

If you believe we have not addressed your concern adequately, you have the right to lodge a complaint with your local data protection authority. In France: Commission Nationale de l'Informatique et des Libertés (CNIL) — www.cnil.fr`,
      },
    ],
  },
  fr: {
    title: 'Politique de Confidentialité',
    lastUpdated: 'Dernière mise à jour : 4 août 2026',
    sections: [
      {
        heading: '1. Introduction',
        body: `ArchiOffice ("nous", "notre", "nos") s'engage à protéger vos données personnelles. Cette Politique de Confidentialité explique comment nous collectons, utilisons, stockons et protégeons les informations vous concernant lorsque vous utilisez notre plateforme SaaS de gestion de projets d'architecture (le "Service").

En utilisant le Service, vous acceptez la collecte et l'utilisation des informations conformément à cette politique.`,
      },
      {
        heading: '2. Responsable du Traitement',
        body: `Le responsable du traitement de vos données personnelles est ArchiOffice, accessible sur archioffice.fr. Pour toute question relative à la vie privée, contactez-nous à : privacy@archioffice.fr`,
      },
      {
        heading: '3. Données Collectées',
        body: `Nous collectons les catégories suivantes de données personnelles :

• **Données de compte** : nom, adresse e-mail, mot de passe (haché), nom de la société, poste, numéro de téléphone.
• **Données professionnelles** : informations sur les projets, données clients, factures, propositions et documents saisis dans la plateforme.
• **Données d'utilisation** : adresse IP, type de navigateur, pages visitées, actions effectuées, horodatages.
• **Données de communication** : e-mails envoyés via la plateforme (configuration SMTP).
• **Données de paiement** : traitées par notre prestataire de paiement (Stripe) ; nous ne stockons pas les numéros de carte.`,
      },
      {
        heading: '4. Base Légale du Traitement',
        body: `Nous traitons vos données personnelles sur les bases légales suivantes :

• **Exécution du contrat** : pour fournir le Service auquel vous avez souscrit.
• **Intérêt légitime** : pour améliorer le Service, assurer la sécurité et prévenir la fraude.
• **Obligation légale** : pour respecter les lois et réglementations applicables.
• **Consentement** : pour les communications optionnelles et marketing (vous pouvez retirer votre consentement à tout moment).`,
      },
      {
        heading: '5. Utilisation de vos Données',
        body: `Nous utilisons vos données pour :

• Fournir, maintenir et améliorer le Service.
• Gérer votre compte et votre abonnement.
• Envoyer des e-mails transactionnels (confirmation de compte, factures, alertes).
• Répondre aux demandes de support.
• Respecter nos obligations légales et réglementaires.
• Générer des statistiques anonymisées et agrégées pour améliorer la plateforme.`,
      },
      {
        heading: '6. Partage des Données',
        body: `Nous ne vendons pas vos données personnelles. Nous les partageons avec les sous-traitants suivants, chacun lié par un accord de traitement des données :

• **Supabase** : base de données, stockage de fichiers et authentification pour l'ensemble du Service.
• **Notre hébergeur** : hébergement de l'infrastructure.
• **Stancer** : traitement des paiements de votre abonnement ArchiOffice (Stripe est intégré mais pas encore utilisé en production).
• **Google (API Gemini)** : les fonctionnalités de rédaction assistée par IA (propositions, CCTP...) transmettent le texte concerné à l'API Gemini de Google pour traitement.
• **Fournisseurs de messagerie** : envoi des e-mails transactionnels (SMTP), via notre messagerie de plateforme ou votre propre configuration SMTP.
• **Sentry** : supervision des erreurs du Service, pour détecter et corriger les bugs. Les données techniques d'erreur peuvent inclure votre identifiant utilisateur et la route consultée ; les adresses e-mail et jetons d'accès sont filtrés avant transmission à Sentry.

Par ailleurs, si votre cabinet active l'une des intégrations optionnelles suivantes (Réglages > Plugins), les données que vous synchronisez explicitement via cette intégration sont également partagées avec ce prestataire, dans le cadre de la relation propre de votre cabinet avec lui : **Zoho** (Invoice/Books), **Odoo**, **Ragic**, ou **Chorus Pro** (AIFE — Ministère de l'Économie, obligatoire pour la facturation électronique du secteur public). Ces intégrations sont désactivées par défaut et n'échangent des données qu'une fois configurées et activées par votre cabinet.

Nous pouvons également partager des données avec des **autorités légales** lorsque la loi, une décision de justice ou la protection des droits et de la sécurité l'exige, et lors d'un **transfert d'entreprise** (fusion, acquisition, vente d'actifs), auquel cas les utilisateurs seront informés.`,
      },
      {
        heading: '7. Conservation des Données',
        body: `Nous conservons vos données aussi longtemps que votre compte ou celui de votre cabinet est actif.

• **Vos données personnelles de profil** (nom, coordonnées, CV, avatar, formations, expériences) peuvent être supprimées immédiatement et définitivement à tout moment, par vous-même, depuis Profil > Confidentialité — sans demande ni délai d'attente.
• **Les données professionnelles de votre cabinet** (projets, factures, documents, contacts...) sont supprimées via une fermeture de cabinet demandée par un administrateur (Réglages > Zone dangereuse). Cela déclenche un délai de grâce de 30 jours, annulable à tout moment, à l'issue duquel la suppression s'exécute automatiquement et définitivement.
• **Les documents à conservation légale obligatoire** (notamment les documents comptables, que la loi française impose de conserver 10 ans) ne sont pas concernés par ces suppressions et restent sous la responsabilité de votre cabinet, à archiver au préalable — utilisez **Réglages > Archivage** pour télécharger à tout moment un export complet et exploitable de l'activité du cabinet (un fichier CSV par table de données, ainsi que tous les fichiers déposés), indépendamment de toute demande de suppression.
• Les copies de sauvegarde peuvent subsister pendant 60 jours supplémentaires après une suppression.
• Les statistiques d'utilisation anonymisées peuvent être conservées indéfiniment.`,
      },
      {
        heading: '8. Sécurité des Données',
        body: `Nous mettons en œuvre des mesures de sécurité conformes aux standards du secteur :

• Toutes les données transmises via HTTPS/TLS.
• Mots de passe hachés avec bcrypt.
• Sécurité au niveau des lignes (RLS) appliquée au niveau de la base de données via Supabase.
• Audits de sécurité et évaluations de vulnérabilités réguliers.
• Accès aux données de production limité au personnel autorisé.`,
      },
      {
        heading: '9. Vos Droits (RGPD)',
        body: `Si vous êtes situé dans l'Espace Économique Européen, vous disposez des droits suivants :

• **Droit d'accès** : obtenir une copie de vos données personnelles.
• **Droit de rectification** : corriger des données inexactes ou incomplètes.
• **Droit à l'effacement** : demander la suppression de vos données ("droit à l'oubli").
• **Droit à la limitation** : restreindre la manière dont nous traitons vos données.
• **Droit à la portabilité** : recevoir vos données dans un format structuré et lisible par machine.
• **Droit d'opposition** : vous opposer au traitement fondé sur des intérêts légitimes.
• **Droit de retrait du consentement** : à tout moment, pour les traitements fondés sur le consentement.

Vous pouvez exercer vous-même, immédiatement, les droits d'accès, de portabilité et d'effacement depuis Profil > Confidentialité (exporter ou supprimer vos données personnelles de profil) et, pour un administrateur de cabinet, depuis Réglages > Archivage (exporter toute l'activité du cabinet) et Réglages > Zone dangereuse (demander la fermeture complète du cabinet). Pour toute autre demande, contactez-nous à privacy@archioffice.fr — nous répondrons dans les 30 jours.`,
      },
      {
        heading: '10. Cookies',
        body: `Nous utilisons des cookies essentiels pour maintenir votre session et vos préférences. Nous n'utilisons pas de cookies publicitaires ou de suivi. Vous pouvez configurer votre navigateur pour refuser les cookies, bien que certaines fonctionnalités puissent ne pas fonctionner correctement.`,
      },
      {
        heading: '11. Transferts Internationaux',
        body: `Vos données peuvent être traitées dans des pays situés en dehors de l'Espace Économique Européen. Dans ce cas, nous nous assurons que des garanties appropriées sont en place, telles que les Clauses Contractuelles Types approuvées par la Commission européenne.`,
      },
      {
        heading: '12. Données des Mineurs',
        body: `Le Service n'est pas destiné aux personnes de moins de 18 ans. Nous ne collectons pas sciemment de données personnelles auprès de mineurs. Si nous prenons connaissance qu'un mineur nous a fourni des données personnelles, nous les supprimerons immédiatement.`,
      },
      {
        heading: '13. Modifications de cette Politique',
        body: `Nous pouvons mettre à jour cette Politique de Confidentialité de temps à autre. Nous vous informerons des modifications importantes par e-mail ou via un avis prominent dans le Service au moins 30 jours avant l'entrée en vigueur du changement. L'utilisation continue du Service après cette date vaut acceptation de la politique mise à jour.`,
      },
      {
        heading: '14. Contact & Réclamations',
        body: `Pour toute question relative à la confidentialité : privacy@archioffice.fr

Si vous estimez que nous n'avons pas répondu à votre préoccupation de manière satisfaisante, vous avez le droit de déposer une plainte auprès de votre autorité de protection des données locale. En France : Commission Nationale de l'Informatique et des Libertés (CNIL) — www.cnil.fr`,
      },
    ],
  },
};

export default function PrivacyPolicy() {
  const [lang, setLang] = useState<'en' | 'fr'>(() => {
    const browserLang = navigator.language.toLowerCase();
    return browserLang.startsWith('fr') ? 'fr' : 'en';
  });

  const c = content[lang];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <IconArrowLeft size={16} />
              {lang === 'fr' ? 'Retour' : 'Back'}
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center">
                <IconCommand size={14} className="text-white" />
              </div>
              <span className="font-semibold text-gray-900 text-sm">ArchiOffice</span>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setLang('fr')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${lang === 'fr' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              FR
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${lang === 'en' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{c.title}</h1>
          <p className="text-sm text-gray-500 mb-10">{c.lastUpdated}</p>

          <div className="space-y-8">
            {c.sections.map((section, i) => (
              <div key={i}>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">{section.heading}</h2>
                <div className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">
                  {section.body.split('\n').map((line, j) => {
                    if (line.startsWith('• **') && line.includes('**:')) {
                      const parts = line.replace('• **', '').split('**:');
                      return (
                        <p key={j} className="mb-1.5 flex gap-1.5">
                          <span className="text-gray-400 mt-0.5">•</span>
                          <span><strong className="text-gray-800">{parts[0]}</strong>:{parts[1]}</span>
                        </p>
                      );
                    }
                    if (line.startsWith('• ')) {
                      return (
                        <p key={j} className="mb-1.5 flex gap-1.5">
                          <span className="text-gray-400 mt-0.5">•</span>
                          <span>{line.slice(2)}</span>
                        </p>
                      );
                    }
                    if (line === '') return <br key={j} />;
                    return <p key={j} className="mb-2">{line}</p>;
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <p className="text-xs text-gray-400">© 2026 ArchiOffice. All rights reserved.</p>
            <div className="flex gap-4 text-xs">
              <Link to="/terms" className="text-gray-500 hover:text-gray-800 transition-colors">
                {lang === 'fr' ? 'Conditions d\'utilisation' : 'Terms of Use'}
              </Link>
              <Link to="/login" className="text-gray-500 hover:text-gray-800 transition-colors">
                {lang === 'fr' ? 'Connexion' : 'Sign In'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
