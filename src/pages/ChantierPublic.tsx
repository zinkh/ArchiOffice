// Liste des entreprises intervenant sur un chantier : la page qu'ouvre le QR code
// du panneau. Publique, sans compte, lisible sur téléphone (on la consulte depuis
// la rue). N'affiche que le nom et l'adresse des entreprises, rien d'autre.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';

interface Liste {
  operation: string;
  adresse: string | null;
  permis: string | null;
  architecte: string | null;
  entreprises: Array<{ lot: string; intitule: string; nom: string; adresse: string[] }>;
}

export default function ChantierPublic() {
  const { token = '' } = useParams();
  const [liste, setListe] = useState<Liste | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch(`/api/public/chantier/${encodeURIComponent(token)}`)
      .then(async r => {
        const corps = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(corps.error || 'Liste introuvable.');
        return corps as Liste;
      })
      .then(l => { if (vivant) setListe(l); })
      .catch(e => { if (vivant) setErreur(e.message); });
    return () => { vivant = false; };
  }, [token]);

  return (
    <main className="min-h-dvh px-4 py-8 mx-auto max-w-2xl" style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)' }}>
      {!liste && !erreur && <div className="flex items-center gap-2 text-sm"><IconLoader2 className="animate-spin" size={18} />Chargement…</div>}
      {erreur && <div role="alert" className="flex items-center gap-2 text-sm"><IconAlertTriangle size={18} />{erreur}</div>}
      {liste && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest opacity-70">Entreprises intervenant sur le chantier</p>
          <h1 className="text-2xl font-bold mt-1">{liste.operation}</h1>
          {liste.adresse && <p className="text-sm mt-1">{liste.adresse}</p>}
          {liste.permis && <p className="text-sm opacity-80">Permis de construire {liste.permis}</p>}
          {liste.entreprises.length === 0 ? (
            <p className="mt-6 text-sm">Aucune entreprise n’est encore désignée pour ce chantier.</p>
          ) : (
            <ul className="mt-6 divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
              {liste.entreprises.map(e => (
                <li key={`${e.lot}-${e.nom}`} className="py-3">
                  <div className="text-xs font-bold uppercase tracking-wide opacity-70">Lot {e.lot}{e.intitule ? ` · ${e.intitule}` : ''}</div>
                  <div className="font-bold">{e.nom}</div>
                  {e.adresse.length > 0 && <div className="text-sm opacity-80">{e.adresse.join(', ')}</div>}
                </li>
              ))}
            </ul>
          )}
          {liste.architecte && <p className="mt-8 text-xs opacity-60">Liste établie par {liste.architecte}, maître d’œuvre.</p>}
        </>
      )}
    </main>
  );
}
