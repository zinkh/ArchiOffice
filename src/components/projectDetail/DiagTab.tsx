// Onglet DIAG de la fiche affaire : demande de devis d'étude de sol au
// géotechnicien. Le formulaire reprend les données de l'affaire (terrain,
// cadastre, PLU, projet, maître d'ouvrage) ; le message s'ouvre dans le composeur
// de messagerie, où l'architecte relit et envoie. Rien ne part sans cette étape.
import { useEffect, useMemo, useState } from 'react';
import { IconSend, IconAlertTriangle } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import { useSettings } from '../../hooks/useSettings';
import MailComposeModal from '../MailComposeModal';
import type { Contact, Project } from '../../types';
import { isBureauEtudesContact } from '../../lib/contactCategories';
import {
  APROX_A_PRECISER, buildGeotechBody, buildGeotechSubject, parseEmailList, type DemandeGeotech,
} from '../../lib/geotechDemande';

const ETUDES: { id: string; libelle: string }[] = [
  { id: 'G1', libelle: 'G1 : étude géotechnique préalable (site)' },
  { id: 'G2AVP', libelle: 'G2 : étude géotechnique de conception, avant-projet (AVP)' },
  { id: 'G2PRO', libelle: 'G2 : étude géotechnique de conception, projet (PRO)' },
  { id: 'G3', libelle: 'G3 : étude géotechnique d’exécution (DCE, EXE)' },
  { id: 'G4', libelle: 'G4 : supervision géotechnique d’exécution' },
];

const CHAMP = 'mt-1 w-full min-h-11 rounded-lg border border-[var(--tblr-border)] bg-white px-3 py-2 text-sm dark:bg-zinc-900';
const TITRE_SECTION = 'text-[0.6875rem] font-bold uppercase tracking-wider';

function Champ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className ?? ''}`}>
      <span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{label}</span>
      {children}
    </label>
  );
}

function Ligne({ label, valeur }: { label: string; valeur?: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 text-sm">
      <dt style={{ color: 'var(--tblr-muted)' }}>{label}</dt>
      <dd className="min-w-0 break-words" style={{ color: valeur ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}>
        {valeur?.trim() || APROX_A_PRECISER}
      </dd>
    </div>
  );
}

export function DiagTab({ project }: { project: Project }) {
  const { accounts, loading: comptesEnChargement } = useMailAccounts();
  const { settings } = useSettings();
  const agence = settings as unknown as { agencyName?: string; email?: string } | null;

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [etudes, setEtudes] = useState<string[]>([]);
  const [sondagesNombre, setSondagesNombre] = useState('');
  const [sondagesProfondeur, setSondagesProfondeur] = useState('');
  const [sondagesTypes, setSondagesTypes] = useState('');
  const [niveaux, setNiveaux] = useState('');
  const [sousSol, setSousSol] = useState(false);
  const [emprise, setEmprise] = useState('');
  const [reponseAvant, setReponseAvant] = useState('');
  const [interventionDes, setInterventionDes] = useState('');
  const [acces, setAcces] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [autresEmails, setAutresEmails] = useState('');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [composeOuvert, setComposeOuvert] = useState(false);
  const [message, setMessage] = useState<{ sujet: string; corps: string; destinataires: string[] } | null>(null);

  useEffect(() => {
    apiFetch<Contact[]>('/api/contacts').then(setContacts).catch(() => setContacts([]));
  }, []);

  // Une catégorie est exigée : un contact sans catégorie n'est pas forcément un bureau d'études.
  const geotechniciens = useMemo(
    () => contacts.filter(c => c.category && isBureauEtudesContact(c) && c.email),
    [contacts],
  );

  const donneesProjet = {
    name: project.name,
    projectCode: project.project_code || project.reference,
    maitreOuvrage: project.nom_societe || project.client,
    adresse: project.adresse_terrain || project.address,
    cpVille: project.cp_ville_terrain || [project.site_postcode, project.site_city].filter(Boolean).join(' ') || undefined,
    refCadastrale: project.ref_cadastrale,
    surfaceParcelle: project.surface_parcelle,
    zonePlu: project.zone_plu,
    sismicite: project.sismicite,
    retraitArgiles: project.retrait_argiles,
    programme: project.programme,
    surfacePlancher: project.surface_plancher,
  };

  const basculer = (liste: string[], valeur: string, mettreAJour: (v: string[]) => void) =>
    mettreAJour(liste.includes(valeur) ? liste.filter(x => x !== valeur) : [...liste, valeur]);

  const preparerEmail = () => {
    const saisies = parseEmailList(autresEmails);
    const adressesChoisies = geotechniciens.filter(c => contactIds.includes(c.id)).map(c => c.email);
    const destinataires = [...new Set([...adressesChoisies, ...saisies.valides])];
    const nouvellesErreurs: string[] = [];
    if (etudes.length === 0) nouvellesErreurs.push('Cochez au moins une étude demandée.');
    if (destinataires.length === 0) nouvellesErreurs.push('Choisissez au moins un géotechnicien, ou saisissez son adresse e-mail.');
    if (saisies.invalides.length > 0) nouvellesErreurs.push(`Adresse à corriger : ${saisies.invalides.join(', ')}.`);
    setErreurs(nouvellesErreurs);
    if (nouvellesErreurs.length > 0) return;

    const demande: DemandeGeotech = {
      projet: donneesProjet,
      moeNom: agence?.agencyName,
      moeEmail: agence?.email,
      etudes: ETUDES.filter(e => etudes.includes(e.id)).map(e => e.libelle),
      sondages: { nombre: sondagesNombre, profondeur: sondagesProfondeur, types: sondagesTypes },
      batiment: { niveaux, sousSol, emprise },
      calendrier: { reponseAvant, interventionDes },
      acces,
      commentaire,
    };
    setMessage({
      sujet: buildGeotechSubject(donneesProjet),
      corps: buildGeotechBody(demande),
      destinataires,
    });
    setComposeOuvert(true);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>Étude de sol</h2>
        <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
          Demande de devis au géotechnicien. Les données de l’affaire sont reprises automatiquement ; le message s’ouvre ensuite dans votre messagerie, où vous le relisez avant l’envoi.
        </p>
      </header>

      <section className="rounded-xl border border-[var(--tblr-border)] p-4" aria-labelledby="diag-donnees">
        <h3 id="diag-donnees" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Données reprises de l’affaire</h3>
        <dl className="mt-3 grid gap-2 md:grid-cols-2">
          <Ligne label="Intitulé" valeur={donneesProjet.name} />
          <Ligne label="Référence" valeur={donneesProjet.projectCode} />
          <Ligne label="Maître d’ouvrage" valeur={donneesProjet.maitreOuvrage} />
          <Ligne label="Adresse du terrain" valeur={donneesProjet.adresse} />
          <Ligne label="Code postal et ville" valeur={donneesProjet.cpVille} />
          <Ligne label="Référence cadastrale" valeur={donneesProjet.refCadastrale} />
          <Ligne label="Surface de la parcelle" valeur={donneesProjet.surfaceParcelle} />
          <Ligne label="Zone du PLU" valeur={donneesProjet.zonePlu} />
          <Ligne label="Zone de sismicité" valeur={donneesProjet.sismicite} />
          <Ligne label="Retrait-gonflement" valeur={donneesProjet.retraitArgiles} />
          <Ligne label="Programme" valeur={donneesProjet.programme} />
          <Ligne label="Surface de plancher" valeur={donneesProjet.surfacePlancher} />
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="diag-etudes">
        <h3 id="diag-etudes" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Études demandées</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {ETUDES.map(e => (
            <label key={e.id} className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--tblr-border)] p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0"
                checked={etudes.includes(e.id)}
                onChange={() => basculer(etudes, e.id, setEtudes)}
              />
              <span>{e.libelle}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="diag-investigations">
        <h3 id="diag-investigations" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Investigations souhaitées</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Champ label="Nombre de sondages">
            <input type="number" min={0} className={CHAMP} value={sondagesNombre} onChange={e => setSondagesNombre(e.target.value)} />
          </Champ>
          <Champ label="Profondeur indicative (m)">
            <input type="number" min={0} step="0.5" className={CHAMP} value={sondagesProfondeur} onChange={e => setSondagesProfondeur(e.target.value)} />
          </Champ>
          <Champ label="Types de sondages et d’essais" className="md:col-span-3">
            <input className={CHAMP} placeholder="Ex. carottés, pressiomètre, essais en laboratoire" value={sondagesTypes} onChange={e => setSondagesTypes(e.target.value)} />
          </Champ>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="diag-batiment">
        <h3 id="diag-batiment" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Bâtiment projeté</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <Champ label="Niveaux">
            <input className={CHAMP} placeholder="Ex. R+2" value={niveaux} onChange={e => setNiveaux(e.target.value)} />
          </Champ>
          <Champ label="Emprise au sol (m²)">
            <input type="number" min={0} className={CHAMP} value={emprise} onChange={e => setEmprise(e.target.value)} />
          </Champ>
          <label className="flex min-h-11 items-center gap-3 self-end text-sm">
            <input type="checkbox" className="size-4" checked={sousSol} onChange={e => setSousSol(e.target.checked)} />
            Avec sous-sol
          </label>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="diag-calendrier">
        <h3 id="diag-calendrier" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Calendrier et accès</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <Champ label="Réponse attendue avant le">
            <input type="date" className={CHAMP} value={reponseAvant} onChange={e => setReponseAvant(e.target.value)} />
          </Champ>
          <Champ label="Intervention souhaitée à partir du">
            <input type="date" className={CHAMP} value={interventionDes} onChange={e => setInterventionDes(e.target.value)} />
          </Champ>
          <Champ label="Accès et contraintes du terrain" className="md:col-span-2">
            <textarea rows={3} className={CHAMP} placeholder="Accès engins, réseaux, voisinage, contraintes horaires" value={acces} onChange={e => setAcces(e.target.value)} />
          </Champ>
          <Champ label="Commentaires" className="md:col-span-2">
            <textarea rows={2} className={CHAMP} value={commentaire} onChange={e => setCommentaire(e.target.value)} />
          </Champ>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="diag-destinataires">
        <h3 id="diag-destinataires" className={TITRE_SECTION} style={{ color: 'var(--tblr-muted)' }}>Destinataires</h3>
        {geotechniciens.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>
            Aucun contact classé « Bureau d’études » avec une adresse e-mail. Saisissez l’adresse ci-dessous, ou classez le géotechnicien dans Contacts.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {geotechniciens.map(c => {
              const nom = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || c.email;
              return (
                <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--tblr-border)] p-3 text-sm">
                  <input type="checkbox" className="size-4 shrink-0" checked={contactIds.includes(c.id)} onChange={() => basculer(contactIds, c.id, setContactIds)} />
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{nom}</span>
                    {c.company_name && nom !== c.company_name && <span style={{ color: 'var(--tblr-muted)' }}> · {c.company_name}</span>}
                    <span className="block text-xs" style={{ color: 'var(--tblr-muted)' }}>{c.email}</span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <Champ label="Autres adresses e-mail (séparées par des virgules)">
          <input className={CHAMP} type="text" inputMode="email" autoComplete="off" value={autresEmails} onChange={e => setAutresEmails(e.target.value)} />
        </Champ>
      </section>

      {erreurs.length > 0 && (
        <div role="alert" className="flex gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <IconAlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <ul className="space-y-1">
            {erreurs.map(e => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--tblr-border)] pt-4">
        <button
          type="button"
          onClick={preparerEmail}
          disabled={comptesEnChargement}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--tblr-primary)] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          <IconSend size={16} aria-hidden /> Préparer l’e-mail au géotechnicien
        </button>
      </div>

      {composeOuvert && message && !comptesEnChargement && (
        <MailComposeModal
          accounts={accounts}
          initial={{ to: message.destinataires.join(', '), subject: message.sujet, body: message.corps }}
          onSent={() => setComposeOuvert(false)}
          onClose={() => setComposeOuvert(false)}
        />
      )}
    </div>
  );
}

export default DiagTab;
