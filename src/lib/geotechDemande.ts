// Demande de devis d'étude de sol : construction pure du sujet et du corps du
// message, à partir des données de l'affaire et du formulaire de l'onglet DIAG.
// Une information absente s'écrit « à préciser » : rien n'est inventé, et le
// géotechnicien voit tout de suite ce qui reste à confirmer.

export const APROX_A_PRECISER = 'à préciser';

export interface DemandeGeotechProjet {
  name: string;
  projectCode?: string;
  maitreOuvrage?: string;
  adresse?: string;
  cpVille?: string;
  refCadastrale?: string;
  surfaceParcelle?: string;
  zonePlu?: string;
  sismicite?: string;
  retraitArgiles?: string;
  programme?: string;
  surfacePlancher?: string;
}

export interface DemandeGeotech {
  projet: DemandeGeotechProjet;
  moeNom?: string;
  moeEmail?: string;
  /** Libellés des études cochées, dans l'ordre d'affichage du formulaire. */
  etudes: string[];
  sondages: { nombre?: string; profondeur?: string; types?: string };
  batiment: { niveaux?: string; sousSol: boolean; emprise?: string };
  calendrier: { reponseAvant?: string; interventionDes?: string };
  acces?: string;
  commentaire?: string;
}

const valeur = (v?: string | null): string => (v && v.trim() ? v.trim() : APROX_A_PRECISER);

/** Date ISO (aaaa-mm-jj, valeur d'un champ date) vers jj/mm/aaaa ; à préciser si vide ou illisible. */
export function dateFrancaise(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : APROX_A_PRECISER;
}

export function buildGeotechSubject(projet: DemandeGeotechProjet): string {
  const code = projet.projectCode?.trim();
  return `Demande de devis, étude de sol : ${projet.name}${code ? ` (${code})` : ''}`;
}

export function buildGeotechBody(d: DemandeGeotech): string {
  const p = d.projet;
  const lignes: string[] = [
    'Bonjour,',
    '',
    'Dans le cadre d’un projet de construction, nous sollicitons votre offre pour une étude de sol. Les informations de l’opération sont reprises ci-dessous.',
    '',
    'OPÉRATION',
    `- Intitulé : ${valeur(p.name)}`,
    `- Référence : ${valeur(p.projectCode)}`,
    `- Maître d’ouvrage : ${valeur(p.maitreOuvrage)}`,
    `- Maître d’œuvre : ${valeur(d.moeNom)}${d.moeEmail ? ` (${d.moeEmail})` : ''}`,
    '',
    'TERRAIN',
    `- Adresse : ${valeur(p.adresse)}`,
    `- Code postal et ville : ${valeur(p.cpVille)}`,
    `- Référence cadastrale : ${valeur(p.refCadastrale)}`,
    `- Surface de la parcelle : ${valeur(p.surfaceParcelle)}`,
    `- Zone du PLU : ${valeur(p.zonePlu)}`,
    `- Zone de sismicité : ${valeur(p.sismicite)}`,
    `- Retrait-gonflement des argiles : ${valeur(p.retraitArgiles)}`,
    '',
    'PROJET',
    `- Programme : ${valeur(p.programme)}`,
    `- Surface de plancher envisagée : ${valeur(p.surfacePlancher)}`,
    `- Niveaux : ${valeur(d.batiment.niveaux)}${d.batiment.sousSol ? ', avec sous-sol' : ', sans sous-sol'}`,
    `- Emprise au sol : ${valeur(d.batiment.emprise)}`,
    '',
    'ÉTUDES DEMANDÉES',
    ...(d.etudes.length ? d.etudes.map(e => `- ${e}`) : [`- ${APROX_A_PRECISER}`]),
    '',
    'INVESTIGATIONS SOUHAITÉES',
    `- Nombre de sondages : ${valeur(d.sondages.nombre)}`,
    `- Profondeur indicative : ${d.sondages.profondeur?.trim() ? `${d.sondages.profondeur.trim()} m` : APROX_A_PRECISER}`,
    `- Types de sondages et d’essais : ${valeur(d.sondages.types)}`,
    '',
    'CALENDRIER',
    `- Réponse attendue avant le : ${dateFrancaise(d.calendrier.reponseAvant)}`,
    `- Intervention souhaitée à partir du : ${dateFrancaise(d.calendrier.interventionDes)}`,
    '',
    'ACCÈS ET CONTRAINTES',
    `- ${valeur(d.acces)}`,
  ];
  if (d.commentaire?.trim()) lignes.push('', 'COMMENTAIRES', d.commentaire.trim());
  lignes.push(
    '',
    'Merci de nous transmettre votre offre détaillée : prix par prestation, délais d’intervention, hypothèses retenues et conditions de réalisation.',
    '',
    'Cordialement,',
  );
  return lignes.join('\n');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lit une liste d'adresses saisies à la main (virgules, points-virgules ou espaces). */
export function parseEmailList(texte: string): { valides: string[]; invalides: string[] } {
  const morceaux = texte.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const valides = [...new Set(morceaux.filter(s => EMAIL.test(s)))];
  const invalides = morceaux.filter(s => !EMAIL.test(s));
  return { valides, invalides };
}
