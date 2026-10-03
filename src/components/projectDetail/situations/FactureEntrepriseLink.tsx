import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBuildingBank, IconLink, IconLoader2, IconPaperclip } from '@tabler/icons-react';
import { apiFetch } from '../../../lib/api';
import type { MarcheTravaux, SituationTravaux } from '../../../lib/certificatPaiement';
import { inputClass, boutonSecondaire, formatEuros } from './DialogShell';

// La facture de situation, l'entreprise la dépose elle-même : Chorus Pro pour un
// maître d'ouvrage public, Super PDP pour un privé. L'architecte ne dépose
// jamais de facture : il retrouve celle de l'entreprise, la lie à la situation,
// puis y joint son certificat de paiement.
export type Plateforme = 'chorus_pro' | 'superpdp';

const PLATEFORMES: Record<Plateforme, { label: string; apiBase: string; cle: 'chorus_pro_id' | 'superpdp_id' }> = {
  chorus_pro: { label: 'Chorus Pro', apiBase: '/api/chorus-pro', cle: 'chorus_pro_id' },
  superpdp: { label: 'Super PDP', apiBase: '/api/superpdp', cle: 'superpdp_id' },
};

interface FactureCandidate {
  identifiantFactureCPP: string;
  numeroFacture?: string | null;
  dateFacture?: string | null;
  montantTtc?: number | null;
  statut?: string | null;
}

export type SituationLiee = SituationTravaux & {
  chorus_pro_id?: string | null;
  superpdp_id?: number | string | null;
  buyer_siret?: string | null;
  etat_acompte_joint_at?: string | null;
};

export function FactureEntrepriseLink({
  plateforme, situation, marche, clientSiret, onUpdated,
}: {
  plateforme: Plateforme;
  situation: SituationLiee;
  marche: MarcheTravaux;
  clientSiret?: string;
  onUpdated: (s: SituationLiee) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const info = PLATEFORMES[plateforme];
  const lie = situation[info.cle];
  const [siret, setSiret] = useState(situation.buyer_siret || clientSiret || '');
  const [candidats, setCandidats] = useState<FactureCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const rechercher = async () => {
    setBusy('search'); setMessage(null);
    try {
      const res = await apiFetch<{ factures: FactureCandidate[] }>(
        `${info.apiBase}/search-situation-facture/${situation.id}`,
        { method: 'POST', body: JSON.stringify({ buyer_siret: siret }) },
      );
      setCandidats(res.factures || []);
    } catch (e: any) {
      setMessage({ ok: false, texte: e?.message || t('situations_travaux_platform_error') });
      setCandidats(null);
    } finally { setBusy(null); }
  };

  const lier = async (c: FactureCandidate) => {
    setBusy(c.identifiantFactureCPP); setMessage(null);
    try {
      const res = await apiFetch<{ success: boolean; situation?: SituationLiee; error?: string }>(
        `${info.apiBase}/link-situation/${situation.id}`,
        { method: 'POST', body: JSON.stringify({ [info.cle]: c.identifiantFactureCPP, statut: c.statut, buyer_siret: siret }) },
      );
      if (!res.success || !res.situation) throw new Error(res.error || t('situations_travaux_platform_error'));
      onUpdated({ ...situation, ...res.situation });
      setCandidats(null);
      setMessage({ ok: true, texte: t('situations_travaux_platform_linked', { platform: info.label }) });
    } catch (e: any) {
      setMessage({ ok: false, texte: e?.message || t('situations_travaux_platform_error') });
    } finally { setBusy(null); }
  };

  const joindre = async () => {
    setBusy('attach'); setMessage(null);
    try {
      const res = await apiFetch<{ success: boolean; situation?: SituationLiee; error?: string }>(
        `${info.apiBase}/attach-etat-acompte/${situation.id}`, { method: 'POST' },
      );
      if (!res.success || !res.situation) throw new Error(res.error || t('situations_travaux_platform_error'));
      onUpdated({ ...situation, ...res.situation });
      setMessage({ ok: true, texte: t('situations_travaux_platform_attached', { platform: info.label }) });
    } catch (e: any) {
      setMessage({ ok: false, texte: e?.message || t('situations_travaux_platform_error') });
    } finally { setBusy(null); }
  };

  return (
    <section aria-labelledby={`${uid}-titre`} className="rounded-lg border border-[var(--tblr-border)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <IconBuildingBank size={16} className="text-[var(--tblr-muted)]" />
        <h3 id={`${uid}-titre`} className="text-sm font-bold text-[var(--tblr-text)]">
          {t('situations_travaux_platform_title', { platform: info.label })}
        </h3>
      </div>
      {lie ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--tblr-muted)]">
            {t('situations_travaux_platform_invoice', { id: String(lie) })}
            {situation.etat_acompte_joint_at && ` · ${t('situations_travaux_platform_attached_on', { date: new Date(situation.etat_acompte_joint_at).toLocaleDateString('fr-FR') })}`}
          </span>
          <button type="button" className={boutonSecondaire} onClick={joindre} disabled={!!busy}>
            {busy === 'attach' ? <IconLoader2 size={14} className="animate-spin" /> : <IconPaperclip size={14} />}
            {situation.etat_acompte_joint_at ? t('situations_travaux_platform_reattach') : t('situations_travaux_platform_attach')}
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_platform_desc', { platform: info.label })}</p>
          {!marche.entreprise_siret && <p className="text-xs text-[var(--tblr-danger)]">{t('situations_travaux_platform_no_siret')}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 flex-1 min-w-[12rem]">
              <label htmlFor={`${uid}-siret`} className="block text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{t('situations_travaux_platform_buyer_siret')}</label>
              <input id={`${uid}-siret`} inputMode="numeric" className={inputClass + ' font-mono'} value={siret} onChange={(e) => setSiret(e.target.value)} />
            </div>
            <button type="button" className={boutonSecondaire} onClick={rechercher} disabled={!!busy || !siret || !marche.entreprise_siret}>
              {busy === 'search' ? <IconLoader2 size={14} className="animate-spin" /> : <IconBuildingBank size={14} />}
              {t('situations_travaux_platform_search', { platform: info.label })}
            </button>
          </div>
          {candidats !== null && (candidats.length === 0 ? (
            <p className="text-xs text-[var(--tblr-muted)]">{t('situations_travaux_platform_none')}</p>
          ) : (
            <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
              {candidats.map((c) => (
                <li key={c.identifiantFactureCPP} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--tblr-text)] truncate">{c.numeroFacture || c.identifiantFactureCPP}</p>
                    <p className="text-[var(--tblr-muted)]">
                      {[c.dateFacture ? new Date(c.dateFacture).toLocaleDateString('fr-FR') : '', c.montantTtc != null ? `${formatEuros(Number(c.montantTtc))} TTC` : '', c.statut ?? ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button type="button" className={boutonSecondaire} onClick={() => lier(c)} disabled={!!busy}>
                    {busy === c.identifiantFactureCPP ? <IconLoader2 size={14} className="animate-spin" /> : <IconLink size={14} />}
                    {t('situations_travaux_platform_link')}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </>
      )}
      {message && <p role="status" className={message.ok ? 'text-xs text-[var(--tblr-success)]' : 'text-xs text-[var(--tblr-danger)]'}>{message.texte}</p>}
    </section>
  );
}
