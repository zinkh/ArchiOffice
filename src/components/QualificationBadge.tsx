import { IconCheck } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import {
  ORGANISME_LABELS, STATUT_QUALIFICATION_LABELS, formaterDate, statutQualification,
  type Qualification, type ResumeQualifications, type StatutQualification,
} from '../lib/qualifications';

const TONS: Record<StatutQualification | 'aucune', string> = {
  valide: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  bientot: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  expiree: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  sans_date: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  aucune: 'bg-transparent text-[var(--tblr-muted)] border border-dashed border-[var(--tblr-border)]',
};

/** Texte court : « Qualibat · 03/2027 », « Qualibat expirée », « Aucune qualification ». */
export function texteResume(resume: ResumeQualifications): string {
  const q = resume.principale;
  if (resume.statut === 'aucune' || !q) return 'Aucune qualification';
  const organisme = ORGANISME_LABELS[q.organisme];
  const fin = formaterDate(q.date_fin);
  if (resume.statut === 'expiree') return `${organisme} expirée${fin ? ` le ${fin}` : ''}`;
  if (resume.statut === 'sans_date') return `${organisme} · sans échéance`;
  return `${organisme} · jusqu'au ${fin}`;
}

/** Texte d'une ligne de liste, où l'organisme est déjà écrit à côté : « Valide jusqu'au 15/03/2027 ». */
export function texteStatut(q: Qualification, resume: ResumeQualifications): string {
  const fin = formaterDate(q.date_fin);
  switch (resume.statut) {
    case 'valide': return `Valide jusqu'au ${fin}`;
    case 'bientot': return `Expire le ${fin}`;
    case 'expiree': return `Expirée le ${fin}`;
    default: return "Sans date d'échéance";
  }
}

/** Détail en infobulle : toutes les qualifications, et si elles ont été contrôlées. */
export function infobulle(liste: Qualification[], resume: ResumeQualifications): string {
  if (liste.length === 0) return "Aucune qualification enregistrée sur la fiche de l'entreprise.";
  const lignes = liste.map(q => {
    const statut = STATUT_QUALIFICATION_LABELS[statutQualification(q)];
    const fin = formaterDate(q.date_fin);
    return `${ORGANISME_LABELS[q.organisme]}${q.reference ? ` ${q.reference}` : ''} : ${statut.toLowerCase()}${fin ? ` (${fin})` : ''}`;
  });
  lignes.push(resume.verifiee ? 'Contrôlée sur le certificat.' : 'Pas encore contrôlée sur le certificat.');
  return lignes.join('\n');
}

export function QualificationBadge({ resume, liste = [], className, enLigne = false }: {
  resume: ResumeQualifications;
  liste?: Qualification[];
  className?: string;
  /** Pour une ligne de liste qui nomme déjà l'organisme : n'écrit que le statut et la date. */
  enLigne?: boolean;
}) {
  return (
    <span
      title={infobulle(liste, resume)}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-bold whitespace-nowrap',
        TONS[resume.statut], className,
      )}
    >
      {enLigne && resume.principale ? texteStatut(resume.principale, resume) : texteResume(resume)}
      {resume.verifiee && resume.statut !== 'aucune' && <IconCheck size={11} aria-label="Contrôlée" />}
    </span>
  );
}
