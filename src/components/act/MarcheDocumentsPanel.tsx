import React, { useMemo, useRef, useState } from 'react';
import { IconFileText, IconDownload, IconChevronDown, IconGavel, IconFileDescription, IconSignature, IconUpload } from '@tabler/icons-react';
import type { Contact, ProjectLot } from '../../types';
import { cn } from '../../lib/utils';
import { fetchAgencySettings } from '../../lib/pdfLetterhead';
import {
  PARAMETRES_MARCHE_DEFAUT, construireCCAP, construireRC,
  type ContexteMarche, type DocModele, type ParametresMarche,
} from '../../lib/actMarche';
import { exporterMarcheDocx, exporterMarchePdf } from '../../lib/actMarcheExport';
import { genererActeFormulaire, type ActeRempli } from '../../lib/actEngagementForm';
import { FormulaireNonReconnuError } from '../../lib/actEngagementImport';
import { lireActeDepuisBuffer } from '../../lib/actEngagementRead';
import { appliquerActeAuxOffres, type EntrepriseOffre, type OffreImportee, type ResultatImport } from '../../lib/actEngagementApply';
import { PARAMETRES_DEFAUT, parametresDe, piecesOffreDe, type DonneesNegociation } from '../../lib/actNegociation';

interface ConsultationLue extends DonneesNegociation {
  marche?: ParametresMarche;
  dce_documents: { nom: string; type_doc: string }[];
  criteres: { nom: string; poids: number }[];
  entreprises: EntrepriseOffre[];
  offres: OffreImportee[];
  pieces_admin: { id: string; nom: string }[];
}

export interface OperationMarche {
  nom: string;
  code?: string;
  adresse?: string;
  maitreOuvrage?: string;
  permisNumero?: string;
  permisDate?: string;
}

interface Props {
  consultation: ConsultationLue;
  lots: ProjectLot[];
  contacts: Contact[];
  operation: OperationMarche;
  onChange: (marche: ParametresMarche) => void;
  /** Verse les entreprises et offres issues d'un acte d'engagement rempli. */
  onImporterOffres: (res: ResultatImport) => void;
}

type DocId = 'rc' | 'ccap' | 'acte';

const CHAMP = 'w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const BOUTON = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';

function Champ({ label, children, large }: { label: string; children: React.ReactNode; large?: boolean }) {
  return (
    <label className={cn('block', large && 'md:col-span-2')}>
      <span className="block text-[0.6875rem] font-semibold text-[var(--tblr-muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}

export function RecapActe({ lu, apercu, onImporter }: { lu: { fichier: string; acte: ActeRempli }; apercu: ResultatImport; onImporter: (res: ResultatImport) => void }) {
  const { acte } = lu;
  const euros = (n: number | null) => (n === null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n));
  return (
    <div className="md:col-span-2 mt-2 rounded-lg border border-[var(--tblr-border)] p-4 text-sm space-y-3" aria-live="polite">
      <p className="font-bold text-[var(--tblr-text)]">{acte.entreprise.entreprise || 'Entreprise non renseignée'} <span className="font-normal text-[var(--tblr-muted)]">({lu.fichier})</span></p>
      <p className="text-xs text-[var(--tblr-muted)]">
        {[acte.entreprise.siret && `SIRET ${acte.entreprise.siret}`, acte.entreprise.representant, acte.entreprise.email, acte.entreprise.telephone].filter(Boolean).join('  ·  ') || 'Aucune coordonnée renseignée'}
      </p>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[var(--tblr-muted)]"><th className="py-1 pr-2">Lot</th><th className="py-1 pr-2 text-right">Prix HT</th><th className="py-1 text-right">Délai (mois)</th></tr></thead>
        <tbody>
          {acte.lots.filter(l => l.candidat).map(l => (
            <tr key={l.numero} className="border-t border-[var(--tblr-border)]">
              <td className="py-1 pr-2">Lot {l.numero}{l.titre ? ` : ${l.titre}` : ''}</td>
              <td className="py-1 pr-2 text-right">{euros(l.prixHT)}</td>
              <td className="py-1 text-right">{l.delaiMois ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {acte.avertissements.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
          {acte.avertissements.map(a => <li key={a}>{a}</li>)}
        </ul>
      )}
      <div className="border-t border-[var(--tblr-border)] pt-3 space-y-2">
        <p className="text-xs font-bold text-[var(--tblr-text)]">Effet de l'import dans les offres</p>
        <p className="text-xs text-[var(--tblr-muted)]">
          {apercu.resume.rapprochement === 'nouvelle'
            ? `Nouvelle entreprise consultée : ${apercu.resume.entrepriseNom}.`
            : `Entreprise déjà consultée, reconnue par ${apercu.resume.rapprochement === 'siret' ? 'son SIRET' : 'son nom'} : ${apercu.resume.entrepriseNom}.`}
        </p>
        <ul className="text-xs space-y-0.5">
          {apercu.resume.lots.map(l => (
            <li key={l.numero}>
              Lot {l.numero} : {euros(l.prix)} HT, {l.action === 'ajoutee' ? 'offre ajoutée' : l.action === 'identique' ? 'offre déjà enregistrée à ce montant' : `offre mise à jour (${l.ancien ? euros(l.ancien) : 'non chiffrée'} avant)`}
            </li>
          ))}
        </ul>
        {apercu.resume.ignores.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">{apercu.resume.ignores.map(i => <li key={i}>{i}</li>)}</ul>
        )}
        <button type="button" className={BOUTON} disabled={apercu.resume.lots.length === 0} onClick={() => onImporter(apercu)}>
          <IconUpload size={13} /> Importer dans les offres
        </button>
      </div>
    </div>
  );
}

export default function MarcheDocumentsPanel({ consultation, lots, contacts, operation, onChange, onImporterOffres }: Props) {
  const [ouvert, setOuvert] = useState<DocId | null>('rc');
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [acteLu, setActeLu] = useState<{ fichier: string; acte: ActeRempli } | null>(null);
  const [importe, setImporte] = useState<string | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);

  const p = { ...PARAMETRES_MARCHE_DEFAUT, ...(consultation.marche ?? {}) } as ParametresMarche;
  const maj = (patch: Partial<ParametresMarche>) => onChange({ ...(consultation.marche ?? {}), ...patch });
  const texte = (cle: keyof ParametresMarche, ph?: string) => (
    <input className={CHAMP} placeholder={ph} value={(consultation.marche?.[cle] as string | undefined) ?? ''}
      onChange={e => maj({ [cle]: e.target.value })} />
  );
  const nombre = (cle: keyof ParametresMarche, ph?: number) => (
    <input type="number" min={0} className={CHAMP} placeholder={ph !== undefined ? String(ph) : undefined}
      value={(consultation.marche?.[cle] as number | undefined) ?? ''}
      onChange={e => maj({ [cle]: e.target.value === '' ? undefined : Number(e.target.value) })} />
  );
  const case_ = (cle: keyof ParametresMarche, libelle: string) => (
    <label className="flex items-center gap-2 text-sm md:col-span-2">
      <input type="checkbox" checked={!!p[cle]} onChange={e => maj({ [cle]: e.target.checked })} />
      {libelle}
    </label>
  );

  /** Réglages du marché, complétés par ce que l'affaire sait déjà. */
  const contexte = useMemo((): ContexteMarche => ({
    operation: { nom: operation.nom, code: operation.code, adresse: operation.adresse },
    params: {
      ...p,
      moa_nom: p.moa_nom || operation.maitreOuvrage,
      lieu_construction: p.lieu_construction || operation.adresse,
      permis_numero: p.permis_numero || operation.permisNumero,
      permis_date: p.permis_date || operation.permisDate,
    },
    agence: {},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [consultation.marche, operation]);

  const tvaPct = parametresDe(consultation).tva_pct ?? PARAMETRES_DEFAUT.tva_pct;

  const construire = (id: 'rc' | 'ccap', ctx: ContexteMarche): DocModele[] => {
    if (id === 'rc') {
      return [construireRC(ctx, {
        dce: consultation.dce_documents,
        piecesAdmin: consultation.pieces_admin,
        piecesOffre: piecesOffreDe(consultation),
        criteres: consultation.criteres,
        lots: lots.map(l => ({ numero: l.lot_number, titre: l.lot_title })),
      })];
    }
    return [construireCCAP(ctx)];
  };

  const nomFichierBase = operation.code || operation.nom;

  const generer = async (id: 'rc' | 'ccap', format: 'pdf' | 'docx') => {
    setErreur(null);
    setEnCours(`${id}-${format}`);
    try {
      const settings = await fetchAgencySettings();
      // Le cabinet (maître d'œuvre) vient des réglages, lus au moment de l'export.
      const docs = construire(id, { ...contexte, agence: { nom: settings.agencyName, adresse: settings.address } });
      const nom = `${id === 'rc' ? 'Reglement_consultation' : 'CCAP'}_${nomFichierBase}`;
      if (format === 'pdf') await exporterMarchePdf(docs, settings, nom);
      else await exporterMarcheDocx(docs, settings, nom);
    } catch (e) {
      console.error(e);
      setErreur('La génération du document a échoué.');
    } finally { setEnCours(null); }
  };

  /** Formulaire d'acte d'engagement vierge : le même pour toutes les entreprises. */
  const genererFormulaire = async () => {
    setErreur(null);
    setEnCours('acte-pdf');
    try {
      const settings = await fetchAgencySettings();
      const data = await genererActeFormulaire(
        { ...contexte, agence: { nom: settings.agencyName, adresse: settings.address } },
        lots.map(l => ({ numero: l.lot_number, titre: l.lot_title })),
        tvaPct, settings,
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      a.download = `Acte_engagement_formulaire_${nomFichierBase.replace(/[^\p{L}\p{N}]+/gu, '_')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      console.error(e);
      setErreur('La génération du formulaire a échoué.');
    } finally { setEnCours(null); }
  };

  /** Lit un formulaire rempli par une entreprise et en présente le contenu. */
  const lireFormulaire = async (fichier: File) => {
    setErreur(null);
    setActeLu(null);
    setImporte(null);
    setEnCours('acte-lecture');
    try {
      setActeLu({ fichier: fichier.name, acte: await lireActeDepuisBuffer(await fichier.arrayBuffer(), lots) });
    } catch (e) {
      setErreur(e instanceof FormulaireNonReconnuError ? e.message : 'Ce fichier n\'a pas pu être lu comme un acte d\'engagement.');
    } finally { setEnCours(null); }
  };

  const Boutons = ({ id }: { id: 'rc' | 'ccap' }) => (
    <div className="flex flex-wrap items-center gap-2 pt-2 md:col-span-2">
      {(['pdf', 'docx'] as const).map(f => (
        <button key={f} type="button" className={BOUTON} disabled={!!enCours} onClick={() => generer(id, f)}>
          <IconDownload size={13} /> {enCours === `${id}-${f}` ? 'Génération…' : f === 'pdf' ? 'Générer en PDF' : 'Générer en Word'}
        </button>
      ))}
    </div>
  );

  const volets: { id: DocId; titre: string; aide: string; icone: React.ElementType; contenu: React.ReactNode }[] = [
    {
      id: 'rc', titre: 'Règlement de consultation', icone: IconGavel,
      aide: 'Objet, conditions, contenu du DCE, pièces à remettre et critères de jugement, repris de cette consultation.',
      contenu: (
        <>
          <Champ label="Procédure" large>{texte('rc_procedure', PARAMETRES_MARCHE_DEFAUT.rc_procedure)}</Champ>
          <Champ label="Date limite de remise des offres"><input type="date" className={CHAMP} value={consultation.marche?.rc_date_limite ?? ''} onChange={e => maj({ rc_date_limite: e.target.value })} /></Champ>
          <Champ label="Heure limite"><input type="time" className={CHAMP} value={consultation.marche?.rc_heure_limite ?? ''} onChange={e => maj({ rc_heure_limite: e.target.value })} /></Champ>
          <Champ label="Mode de remise" large>{texte('rc_mode_remise', 'par voie électronique à contact@aazs.fr, ou sous pli remis contre récépissé')}</Champ>
          <Champ label="Validité des offres (jours)">{nombre('rc_validite_offres_jours', PARAMETRES_MARCHE_DEFAUT.rc_validite_offres_jours)}</Champ>
          <Champ label="Contact pour les renseignements">{texte('rc_contact', 'Nom, e-mail, téléphone')}</Champ>
          <Champ label="Visite du site" large>{texte('rc_visite_site', 'ex : visite obligatoire le jj/mm/aaaa à 10 h, sur rendez-vous')}</Champ>
          {case_('rc_variantes', 'Variantes autorisées')}
          {case_('rc_negociation', 'Négociation possible avec les candidats')}
          <Champ label="Nature des travaux" large>{texte('nature_travaux', 'ex : la construction d\'une maison individuelle')}</Champ>
          <Boutons id="rc" />
        </>
      ),
    },
    {
      id: 'ccap', titre: 'CCAP (marché de travaux privés)', icone: IconFileDescription,
      aide: 'D\'après le modèle de CCAP de l\'annexe Maison individuelle : 17 articles, norme NF P 03-001.',
      contenu: (
        <>
          <Champ label="Nature des travaux" large>{texte('nature_travaux', 'ex : la construction d\'une maison individuelle')}</Champ>
          <Champ label="Lieu de construction">{texte('lieu_construction', operation.adresse)}</Champ>
          <Champ label="Maître d'ouvrage">{texte('moa_nom', operation.maitreOuvrage)}</Champ>
          <Champ label="Adresse du maître d'ouvrage">{texte('moa_adresse')}</Champ>
          <Champ label="Représenté par">{texte('moa_representant')}</Champ>
          <Champ label="Permis de construire n°">{texte('permis_numero', operation.permisNumero)}</Champ>
          <Champ label="Permis délivré le"><input type="date" className={CHAMP} value={consultation.marche?.permis_date ?? operation.permisDate ?? ''} onChange={e => maj({ permis_date: e.target.value })} /></Champ>
          <Champ label="Mission de l'architecte">{texte('moe_mission', 'ex : la mission de maîtrise d\'œuvre complète')}</Champ>
          <Champ label="Coordonnateur SPS">{texte('sps_nom')}</Champ>
          <Champ label="Adresse du coordonnateur SPS">{texte('sps_adresse')}</Champ>
          <Champ label="Contrôle technique (vide : sans objet)">{texte('controle_technique')}</Champ>
          {case_('opc_par_moe', 'Coordination de chantier (OPC) assurée par la maîtrise d\'œuvre')}
          {case_('habitation_neuve', 'Immeuble neuf d\'habitation (rétractation de 7 jours)')}
          <Champ label="Pénalité de retard (par jour, du montant TTC)">{texte('penalite_retard', PARAMETRES_MARCHE_DEFAUT.penalite_retard)}</Champ>
          <Champ label="Pénalité d'absence à une réunion (€ TTC)">{nombre('penalite_absence_eur')}</Champ>
          <Champ label="Pénalité de retard de documents (€ TTC par jour)">{nombre('penalite_documents_eur')}</Champ>
          <Champ label="Jours d'intempéries prévisibles">{nombre('jours_intemperies', PARAMETRES_MARCHE_DEFAUT.jours_intemperies)}</Champ>
          <Champ label="Délai global d'exécution (mois)">{nombre('delai_execution_mois')}</Champ>
          <Champ label="Période de préparation (jours)">{nombre('periode_preparation_jours')}</Champ>
          <Champ label="Piquetage général assuré par le lot 1">{texte('piquetage_general', 'ex : Gros œuvre')}</Champ>
          <Champ label="Piquetage des ouvrages enterrés par">{texte('piquetage_enterres')}</Champ>
          <Champ label="Retenue de garantie (%)">{nombre('retenue_garantie_pct', PARAMETRES_MARCHE_DEFAUT.retenue_garantie_pct)}</Champ>
          <Champ label="Libération de la caution (mois après réception)">{nombre('caution_delai_mois', PARAMETRES_MARCHE_DEFAUT.caution_delai_mois)}</Champ>
          <Champ label="Paiement des acomptes (jours)">{nombre('acompte_delai_jours', PARAMETRES_MARCHE_DEFAUT.acompte_delai_jours)}</Champ>
          <Champ label="Paiement du solde (jours)">{nombre('solde_delai_jours', PARAMETRES_MARCHE_DEFAUT.solde_delai_jours)}</Champ>
          <Champ label="Seuil de garantie de paiement (€ HT)">{nombre('seuil_garantie_paiement_ht', PARAMETRES_MARCHE_DEFAUT.seuil_garantie_paiement_ht)}</Champ>
          {case_('financement_pret', 'Financement du maître d\'ouvrage par un prêt (article 12)')}
          {p.financement_pret && (
            <>
              <Champ label="Seuil de l'opération (€ TTC)">{nombre('seuil_pret_ttc', PARAMETRES_MARCHE_DEFAUT.seuil_pret_ttc)}</Champ>
              <Champ label="Validité de l'offre de l'entrepreneur (jours)">{nombre('validite_offre_pret_jours')}</Champ>
              <Champ label="Délai de la condition suspensive de prêt (jours)">{nombre('delai_condition_pret_jours')}</Champ>
            </>
          )}
          <Champ label="Conditions diverses (article 17)" large>
            <textarea rows={3} className={CHAMP} value={consultation.marche?.conditions_diverses ?? ''} onChange={e => maj({ conditions_diverses: e.target.value })} />
          </Champ>
          <Champ label="Lieu de signature">{texte('lieu_signature')}</Champ>
          <Champ label="Date de signature"><input type="date" className={CHAMP} value={consultation.marche?.date_signature ?? ''} onChange={e => maj({ date_signature: e.target.value })} /></Champ>
          <Boutons id="ccap" />
        </>
      ),
    },
    {
      id: 'acte', titre: 'Acte d\'engagement (formulaire)', icone: IconSignature,
      aide: 'Un seul formulaire PDF, identique pour toutes les entreprises : chacune le remplit (identité, lots chiffrés, délais), le signe et le retourne. Le formulaire rempli peut ensuite être relu ici.',
      contenu: (
        <>
          <Champ label="Maître d'ouvrage">{texte('moa_nom', operation.maitreOuvrage)}</Champ>
          <Champ label="Représenté par">{texte('moa_representant')}</Champ>
          <Champ label="Adresse du maître d'ouvrage" large>{texte('moa_adresse')}</Champ>
          <Champ label="Délai global d'exécution (mois)">{nombre('delai_execution_mois')}</Champ>
          <Champ label="Lieu de signature (maître d'ouvrage)">{texte('lieu_signature')}</Champ>
          <div className="flex flex-wrap items-center gap-2 pt-2 md:col-span-2">
            <button type="button" className={BOUTON} disabled={!!enCours} onClick={genererFormulaire}>
              <IconDownload size={13} /> {enCours === 'acte-pdf' ? 'Génération…' : 'Générer le formulaire (PDF à remplir)'}
            </button>
            <button type="button" className={BOUTON} disabled={!!enCours} onClick={() => champFichier.current?.click()}>
              <IconUpload size={13} /> {enCours === 'acte-lecture' ? 'Lecture…' : 'Lire un formulaire rempli'}
            </button>
            <input ref={champFichier} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Acte d'engagement rempli (PDF)"
              onChange={e => { const fichier = e.target.files?.[0]; e.target.value = ''; if (fichier) lireFormulaire(fichier); }} />
          </div>
          {acteLu && (
            <RecapActe
              lu={acteLu}
              apercu={appliquerActeAuxOffres(
                { entreprises: consultation.entreprises, offres: consultation.offres },
                acteLu.acte, lots, contacts,
                { aujourdhui: new Date().toISOString().slice(0, 10), genererId: () => crypto.randomUUID() },
              )}
              onImporter={res => { onImporterOffres(res); setActeLu(null); setImporte(res.resume.entrepriseNom); }}
            />
          )}
          {importe && <p role="status" className="md:col-span-2 text-xs text-green-600 dark:text-green-400 font-bold">Offres de {importe} importées : elles figurent dans la phase Offres.</p>}
        </>
      ),
    },
  ];

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="p-5 border-b border-[var(--tblr-border)]">
        <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
          <IconFileText size={15} /> Documents du marché
        </h3>
        <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">
          Règlement de consultation, CCAP et acte d'engagement, établis d'après les critères, pièces et lots de cette consultation. Les champs vides restent en pointillés dans le document.
        </p>
      </div>
      <div className="divide-y divide-[var(--tblr-border)]">
        {volets.map(v => {
          const Icone = v.icone;
          const ouvertIci = ouvert === v.id;
          return (
            <section key={v.id}>
              <button type="button" aria-expanded={ouvertIci} onClick={() => setOuvert(ouvertIci ? null : v.id)}
                className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--tblr-surface-2)]">
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--tblr-text)]"><Icone size={15} /> {v.titre}</span>
                <IconChevronDown size={15} className={cn('transition-transform', ouvertIci && 'rotate-180')} />
              </button>
              {ouvertIci && (
                <div className="px-5 pb-5">
                  <p className="text-[0.6875rem] text-[var(--tblr-muted)] mb-3">{v.aide}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{v.contenu}</div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {erreur && <p role="alert" className="px-5 py-3 text-xs text-red-600 border-t border-[var(--tblr-border)]">{erreur}</p>}
    </div>
  );
}
