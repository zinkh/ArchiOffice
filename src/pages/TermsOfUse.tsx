import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft, IconCommand } from '@tabler/icons-react';

const content = {
  en: {
    title: 'Terms of Use',
    lastUpdated: 'Last updated: May 20, 2026',
    sections: [
      {
        heading: '1. Acceptance of Terms',
        body: `By accessing or using ArchiManager (the "Service"), you agree to be bound by these Terms of Use ("Terms"). If you do not agree to these Terms, do not use the Service.

These Terms apply to all users, including individual subscribers and organizations. Use of the Service by your employees or agents constitutes your acceptance on their behalf.`,
      },
      {
        heading: '2. Description of Service',
        body: `ArchiManager is a cloud-based SaaS platform designed for architecture firms and professionals. The Service includes tools for project management, client tracking, proposal generation, invoicing, site report management, document storage, and team collaboration.

We reserve the right to modify, suspend, or discontinue any feature of the Service at any time, with reasonable notice to subscribers.`,
      },
      {
        heading: '3. Account Registration',
        body: `To use the Service, you must create an account by providing accurate, complete, and current information. You are responsible for:

• Maintaining the confidentiality of your account credentials.
• All activities that occur under your account.
• Promptly notifying us of any unauthorized use at support@archimanager.fr.

You may not share your account with third parties or create accounts on behalf of others without authorization. Each organization ("tenant") receives an isolated data environment.`,
      },
      {
        heading: '4. Subscription and Billing',
        body: `The Service is offered on a subscription basis. By subscribing, you agree to pay the applicable fees as described on our pricing page.

• **Trial period**: New accounts include a 14-day free trial. No credit card is required during the trial.
• **Billing cycle**: Subscriptions are billed monthly or annually, in advance.
• **Automatic renewal**: Subscriptions automatically renew unless cancelled at least 24 hours before the renewal date.
• **Refunds**: We offer a pro-rata refund within 7 days of a billing date if you are not satisfied with the Service.
• **Price changes**: We will notify you at least 30 days in advance of any price increase.

Payments are processed securely by Stripe. We do not store payment card information.`,
      },
      {
        heading: '5. Acceptable Use',
        body: `You agree to use the Service only for lawful purposes. You may not:

• Use the Service for any illegal activity or in violation of any applicable law.
• Upload or transmit malicious code, viruses, or harmful content.
• Attempt to gain unauthorized access to the Service or other users' data.
• Reverse engineer, decompile, or disassemble any part of the Service.
• Resell, sublicense, or redistribute access to the Service without our written consent.
• Use the Service to send unsolicited commercial communications (spam).
• Impersonate any person or entity or misrepresent your affiliation.

We reserve the right to suspend or terminate accounts that violate these rules.`,
      },
      {
        heading: '6. Intellectual Property',
        body: `**Our IP**: The Service, including its design, code, features, and content (excluding user data), is owned by ArchiManager and protected by copyright, trademark, and other intellectual property laws. You receive a limited, non-exclusive, non-transferable license to use the Service during your subscription.

**Your data**: You retain all rights to the data, documents, and content you upload or create within the Service ("User Content"). You grant us a limited license to process, store, and display your User Content solely to provide the Service.

**Feedback**: Any feedback, suggestions, or ideas you provide may be used by us without obligation or compensation.`,
      },
      {
        heading: '7. Data and Privacy',
        body: `Our collection and use of personal data is governed by our Privacy Policy, available at archimanager.fr/privacy. By using the Service, you consent to our data practices as described therein.

For customers subject to the GDPR, we act as a data processor for the User Content you store in the Service, and you act as the data controller. A Data Processing Agreement (DPA) is available upon request.`,
      },
      {
        heading: '8. Confidentiality',
        body: `Each party agrees to keep confidential any non-public information disclosed by the other party in connection with the Service ("Confidential Information"). Confidential Information does not include information that:

• Is or becomes publicly available through no breach of this agreement.
• Was already known to the receiving party.
• Is independently developed without use of the Confidential Information.
• Is required to be disclosed by law or court order.`,
      },
      {
        heading: '9. Service Availability and SLA',
        body: `We target 99.5% monthly uptime for the Service, excluding scheduled maintenance. We will endeavor to provide at least 24 hours' advance notice for scheduled downtime.

In the event of service interruptions exceeding 1% downtime in a calendar month, subscribers on paid plans may request a pro-rata credit for the affected period. Credits are the sole remedy for service interruptions.`,
      },
      {
        heading: '10. Disclaimer of Warranties',
        body: `THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

We do not warrant that the Service will be uninterrupted, error-free, or that defects will be corrected. You use the Service at your sole risk.`,
      },
      {
        heading: '11. Limitation of Liability',
        body: `TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ARCHIMANAGER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITIES, ARISING FROM YOUR USE OF THE SERVICE.

OUR TOTAL LIABILITY FOR ANY CLAIM RELATED TO THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE 12 MONTHS PRECEDING THE CLAIM.

These limitations apply regardless of the form of action, whether in contract, tort, or otherwise.`,
      },
      {
        heading: '12. Indemnification',
        body: `You agree to indemnify, defend, and hold harmless ArchiManager and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from:

• Your use of the Service.
• Your violation of these Terms.
• Your violation of any third-party rights.
• Any User Content you submit to the Service.`,
      },
      {
        heading: '13. Termination',
        body: `**By you**: You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period.

**By us**: We may suspend or terminate your account immediately if you breach these Terms, fail to pay, or if required by law. We will provide reasonable notice where possible.

**Effect of termination**: Upon termination, your access to the Service ceases. We will retain your data for 90 days post-termination to allow export, after which it will be permanently deleted.`,
      },
      {
        heading: '14. Governing Law and Disputes',
        body: `These Terms are governed by the laws of France, without regard to its conflict of law provisions.

Any dispute arising from these Terms or the Service shall first be submitted to good-faith mediation. If mediation fails within 60 days, disputes shall be resolved by the competent courts of Paris, France.

For EU consumers, mandatory consumer protection provisions of your country of residence also apply.`,
      },
      {
        heading: '15. Changes to Terms',
        body: `We may update these Terms at any time. For material changes, we will notify you by email or prominent notice at least 30 days before the changes take effect. Your continued use of the Service after that date constitutes acceptance of the new Terms.

If you do not agree to the updated Terms, you must stop using the Service and may cancel your subscription for a pro-rata refund.`,
      },
      {
        heading: '16. Contact',
        body: `For any questions regarding these Terms:

ArchiManager
Email: legal@archimanager.fr
Website: archimanager.fr`,
      },
    ],
  },
  fr: {
    title: "Conditions d'Utilisation",
    lastUpdated: 'Dernière mise à jour : 20 mai 2026',
    sections: [
      {
        heading: '1. Acceptation des Conditions',
        body: `En accédant ou en utilisant ArchiManager (le "Service"), vous acceptez d'être lié par ces Conditions d'Utilisation ("Conditions"). Si vous n'acceptez pas ces Conditions, n'utilisez pas le Service.

Ces Conditions s'appliquent à tous les utilisateurs, y compris les abonnés individuels et les organisations. L'utilisation du Service par vos employés ou agents constitue votre acceptation en leur nom.`,
      },
      {
        heading: '2. Description du Service',
        body: `ArchiManager est une plateforme SaaS cloud conçue pour les cabinets d'architecture et les professionnels. Le Service comprend des outils de gestion de projets, suivi clients, génération de propositions, facturation, gestion de comptes rendus de chantier, stockage de documents et collaboration d'équipe.

Nous nous réservons le droit de modifier, suspendre ou interrompre toute fonctionnalité du Service à tout moment, avec un préavis raisonnable aux abonnés.`,
      },
      {
        heading: '3. Création de Compte',
        body: `Pour utiliser le Service, vous devez créer un compte en fournissant des informations exactes, complètes et à jour. Vous êtes responsable de :

• La confidentialité de vos identifiants de compte.
• Toutes les activités effectuées sous votre compte.
• Nous notifier rapidement de toute utilisation non autorisée à support@archimanager.fr.

Vous ne pouvez pas partager votre compte avec des tiers ni créer des comptes au nom d'autrui sans autorisation. Chaque organisation ("tenant") bénéficie d'un environnement de données isolé.`,
      },
      {
        heading: '4. Abonnement et Facturation',
        body: `Le Service est proposé sur la base d'un abonnement. En vous abonnant, vous acceptez de payer les frais applicables décrits sur notre page de tarification.

• **Période d'essai** : Les nouveaux comptes bénéficient d'un essai gratuit de 14 jours. Aucune carte bancaire n'est requise pendant l'essai.
• **Cycle de facturation** : Les abonnements sont facturés mensuellement ou annuellement, à l'avance.
• **Renouvellement automatique** : Les abonnements se renouvellent automatiquement sauf annulation au moins 24 heures avant la date de renouvellement.
• **Remboursements** : Nous offrons un remboursement au prorata dans les 7 jours suivant une date de facturation si vous n'êtes pas satisfait du Service.
• **Modification des prix** : Nous vous informerons au moins 30 jours à l'avance de toute augmentation de prix.

Les paiements sont traités de manière sécurisée par Stripe. Nous ne stockons pas les informations de carte bancaire.`,
      },
      {
        heading: '5. Utilisation Acceptable',
        body: `Vous vous engagez à utiliser le Service uniquement à des fins légales. Vous ne pouvez pas :

• Utiliser le Service à des fins illégales ou en violation de toute loi applicable.
• Télécharger ou transmettre des codes malveillants, virus ou contenus nuisibles.
• Tenter d'obtenir un accès non autorisé au Service ou aux données d'autres utilisateurs.
• Procéder à de l'ingénierie inverse, décompiler ou désassembler toute partie du Service.
• Revendre, sous-licencier ou redistribuer l'accès au Service sans notre accord écrit.
• Utiliser le Service pour envoyer des communications commerciales non sollicitées (spam).
• Usurper l'identité de toute personne ou entité.

Nous nous réservons le droit de suspendre ou de résilier les comptes qui enfreignent ces règles.`,
      },
      {
        heading: '6. Propriété Intellectuelle',
        body: `**Notre propriété intellectuelle** : Le Service, y compris sa conception, son code, ses fonctionnalités et son contenu (à l'exclusion des données utilisateur), appartient à ArchiManager et est protégé par le droit d'auteur, les marques et d'autres lois sur la propriété intellectuelle. Vous recevez une licence limitée, non exclusive et non transférable pour utiliser le Service pendant votre abonnement.

**Vos données** : Vous conservez tous les droits sur les données, documents et contenus que vous téléchargez ou créez dans le Service ("Contenu Utilisateur"). Vous nous accordez une licence limitée pour traiter, stocker et afficher votre Contenu Utilisateur uniquement pour fournir le Service.

**Retours** : Tout retour, suggestion ou idée que vous fournissez peut être utilisé par nous sans obligation ni compensation.`,
      },
      {
        heading: '7. Données et Confidentialité',
        body: `Notre collecte et utilisation des données personnelles est régie par notre Politique de Confidentialité, disponible sur archimanager.fr/privacy. En utilisant le Service, vous consentez à nos pratiques en matière de données telles que décrites.

Pour les clients soumis au RGPD, nous agissons en tant que sous-traitant pour le Contenu Utilisateur que vous stockez dans le Service, et vous agissez en tant que responsable du traitement. Un Accord de Traitement des Données (DPA) est disponible sur demande.`,
      },
      {
        heading: '8. Confidentialité',
        body: `Chaque partie s'engage à garder confidentielles toutes les informations non publiques divulguées par l'autre partie dans le cadre du Service ("Informations Confidentielles"). Les Informations Confidentielles n'incluent pas les informations qui :

• Sont ou deviennent accessibles au public sans violation du présent accord.
• Étaient déjà connues de la partie réceptrice.
• Sont développées indépendamment sans utilisation des Informations Confidentielles.
• Doivent être divulguées en vertu de la loi ou d'une décision de justice.`,
      },
      {
        heading: '9. Disponibilité du Service et SLA',
        body: `Nous visons une disponibilité mensuelle de 99,5 % pour le Service, hors maintenance programmée. Nous nous efforcerons de fournir un préavis d'au moins 24 heures pour les interruptions programmées.

En cas d'interruptions de service dépassant 1 % de temps d'arrêt au cours d'un mois civil, les abonnés aux formules payantes peuvent demander un crédit au prorata pour la période concernée. Les crédits sont l'unique recours en cas d'interruption de service.`,
      },
      {
        heading: '10. Exclusion de Garanties',
        body: `LE SERVICE EST FOURNI "EN L'ÉTAT" ET "TEL QUE DISPONIBLE" SANS GARANTIE D'AUCUNE SORTE, EXPRESSE OU IMPLICITE, Y COMPRIS MAIS SANS S'Y LIMITER LES GARANTIES DE QUALITÉ MARCHANDE, D'ADÉQUATION À UN USAGE PARTICULIER OU DE NON-VIOLATION.

Nous ne garantissons pas que le Service sera ininterrompu, sans erreur ou que les défauts seront corrigés. Vous utilisez le Service à vos propres risques.`,
      },
      {
        heading: '11. Limitation de Responsabilité',
        body: `DANS LA MESURE MAXIMALE PERMISE PAR LA LOI APPLICABLE, ARCHIMANAGER NE SERA PAS RESPONSABLE DES DOMMAGES INDIRECTS, ACCESSOIRES, SPÉCIAUX, CONSÉCUTIFS OU PUNITIFS, Y COMPRIS LA PERTE DE PROFITS, DE DONNÉES OU D'OPPORTUNITÉS COMMERCIALES, DÉCOULANT DE VOTRE UTILISATION DU SERVICE.

NOTRE RESPONSABILITÉ TOTALE POUR TOUTE RÉCLAMATION LIÉE AU SERVICE NE DÉPASSERA PAS LE MONTANT QUE VOUS NOUS AVEZ PAYÉ AU COURS DES 12 MOIS PRÉCÉDANT LA RÉCLAMATION.

Ces limitations s'appliquent quelle que soit la forme d'action, en contrat, délit ou autre.`,
      },
      {
        heading: '12. Indemnisation',
        body: `Vous acceptez d'indemniser, de défendre et de tenir indemnes ArchiManager et ses dirigeants, directeurs, employés et agents contre toute réclamation, dommage, perte, responsabilité et dépense (y compris les honoraires d'avocat) découlant de :

• Votre utilisation du Service.
• Votre violation des présentes Conditions.
• Votre violation des droits de tiers.
• Tout Contenu Utilisateur que vous soumettez au Service.`,
      },
      {
        heading: '13. Résiliation',
        body: `**Par vous** : Vous pouvez annuler votre abonnement à tout moment depuis les paramètres de votre compte. L'annulation prend effet à la fin de la période de facturation en cours.

**Par nous** : Nous pouvons suspendre ou résilier votre compte immédiatement si vous enfreignez ces Conditions, ne payez pas, ou si la loi l'exige. Nous fournirons un préavis raisonnable dans la mesure du possible.

**Effets de la résiliation** : À la résiliation, votre accès au Service cesse. Nous conserverons vos données pendant 90 jours après la résiliation pour permettre l'exportation, après quoi elles seront définitivement supprimées.`,
      },
      {
        heading: '14. Droit Applicable et Litiges',
        body: `Les présentes Conditions sont régies par le droit français, sans égard à ses dispositions sur les conflits de lois.

Tout litige découlant des présentes Conditions ou du Service sera d'abord soumis à une médiation de bonne foi. En cas d'échec de la médiation dans les 60 jours, les litiges seront résolus par les tribunaux compétents de Paris, France.

Pour les consommateurs de l'UE, les dispositions obligatoires de protection des consommateurs de votre pays de résidence s'appliquent également.`,
      },
      {
        heading: '15. Modifications des Conditions',
        body: `Nous pouvons mettre à jour ces Conditions à tout moment. Pour les modifications importantes, nous vous en informerons par e-mail ou avis prominent au moins 30 jours avant leur entrée en vigueur. Votre utilisation continue du Service après cette date vaut acceptation des nouvelles Conditions.

Si vous n'acceptez pas les Conditions mises à jour, vous devez cesser d'utiliser le Service et pouvez résilier votre abonnement avec remboursement au prorata.`,
      },
      {
        heading: '16. Contact',
        body: `Pour toute question concernant ces Conditions :

ArchiManager
E-mail : legal@archimanager.fr
Site web : archimanager.fr`,
      },
    ],
  },
};

export default function TermsOfUse() {
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
              <span className="font-semibold text-gray-900 text-sm">ArchiManager</span>
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
                <div className="text-gray-600 text-sm leading-relaxed">
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
            <p className="text-xs text-gray-400">© 2026 ArchiManager. All rights reserved.</p>
            <div className="flex gap-4 text-xs">
              <Link to="/privacy" className="text-gray-500 hover:text-gray-800 transition-colors">
                {lang === 'fr' ? 'Politique de Confidentialité' : 'Privacy Policy'}
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
