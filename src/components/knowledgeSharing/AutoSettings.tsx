import { useState } from 'react';

export interface AutoState { enabled: boolean; categories: string[]; available: { name: string; count: number }[]; daily_cap: number }

interface Props {
  optedIn: boolean;
  auto: AutoState;
  busy: boolean;
  onConsent: (enabled: boolean) => void;
  onEnableAuto: (categories: string[]) => void;
  onDisableAuto: () => void;
  onBackfill: () => void;
}

/**
 * Deux autorisations distinctes, expliquées avant d'être demandées : la contribution
 * anonymisée, puis le partage automatique, qui couvre l'analyse du texte par une IA
 * avant toute relecture humaine et l'envoi sans validation.
 */
export function AutoSettings({ optedIn, auto, busy, onConsent, onEnableAuto, onDisableAuto, onBackfill }: Props) {
  const [picked, setPicked] = useState<string[]>(auto.categories);
  const [understood, setUnderstood] = useState(false);
  const toggle = (name: string) => setPicked(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]);
  const existing = auto.available.filter(t => auto.categories.includes(t.name)).reduce((n, t) => n + t.count, 0);

  return <div className="space-y-3">
    <label className="flex items-start gap-2 text-sm">
      <input aria-label="Autoriser la préparation de contributions anonymisées" type="checkbox"
        checked={optedIn} disabled={busy} onChange={e => onConsent(e.target.checked)} />
      <span>J’autorise la contribution d’extraits techniques anonymisés à la base commune. Choix indépendant des CGU, retirable à tout moment : les extraits non envoyés sont alors effacés et ceux déjà envoyés retirés de Mistral.</span>
    </label>

    {optedIn && !auto.enabled && <fieldset className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--tblr-border)' }}>
      <legend className="px-1 text-sm font-medium">Partage automatique</legend>
      <p className="text-sm">Choisissez les types de documents concernés. Chaque nouveau document de ces types sera traité sans que vous ayez rien à faire.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Types de documents à partager">
        {auto.available.map(t => <label key={t.name} className="flex items-center gap-2 rounded border px-3 py-2 text-sm" style={{ borderColor: 'var(--tblr-border)' }}>
          <input type="checkbox" checked={picked.includes(t.name)} onChange={() => toggle(t.name)} />
          <span>{t.name}</span>
          <span style={{ color: 'var(--tblr-muted)' }}>({t.count} document{t.count > 1 ? 's' : ''})</span>
        </label>)}
      </div>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        Les contrats, devis, ordres de service, comptes rendus et plans ne peuvent jamais être partagés.
        Plafond : {auto.daily_cap} extraits par 24 heures.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
        <span>
          Je comprends que le texte de ces documents est <strong>analysé par Mistral avant toute relecture humaine</strong>, puis
          envoyé automatiquement à la bibliothèque commune, sans validation de ma part. Les paragraphes douteux sont retenus,
          mais aucune détection n’est parfaite. Je confirme disposer des droits pour partager ce contenu.
        </span>
      </label>
      <button type="button" className="btn btn-primary" disabled={busy || !understood || !picked.length}
        onClick={() => onEnableAuto(picked)}>Activer le partage automatique</button>
    </fieldset>}

    {optedIn && auto.enabled && <div className="rounded-lg border p-3 space-y-2 text-sm" style={{ borderColor: 'var(--tblr-border)' }}>
      <p><strong>Partage automatique actif</strong> pour : {auto.categories.join(', ')}. Plafond de {auto.daily_cap} extraits par 24 heures.</p>
      <div className="flex flex-wrap gap-2">
        {existing > 0 && <button type="button" className="btn btn-secondary whitespace-normal text-left" disabled={busy} onClick={onBackfill}>
          Traiter aussi les {existing} document{existing > 1 ? 's' : ''} déjà présent{existing > 1 ? 's' : ''}
        </button>}
        <button type="button" className="btn btn-secondary whitespace-normal text-left" disabled={busy} onClick={onDisableAuto}>Désactiver le partage automatique</button>
      </div>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        Désactiver supprime ce qui n’est pas encore parti. Les textes déjà envoyés restent, jusqu’à ce que vous les retiriez ci-dessous.
      </p>
    </div>}
  </div>;
}
