import { useEffect, useRef, useState } from 'react';
import { IconMapPin, IconTrash } from '@tabler/icons-react';
import { GeoportailMap } from '../LocationMaps';
import { InfoPanelBoundary } from '../InfoPanelBoundary';
import { parcelReference, formatSurface } from '../../lib/cadastreSelection';
import {
  fetchParcelAddress, parcelCentroid, sameAddress, totalSurface,
  type ParcelAddress, type StoredParcel,
} from '../../lib/terrainParcelles';

interface TerrainParcellesProps {
  /** Adresse telle que saisie (sert à savoir si la parcelle en propose une autre). */
  currentAddress: string;
  /** Adresse stabilisée (fin de saisie) sur laquelle la carte se centre. */
  mapAddress: string;
  banId?: string;
  parcels: StoredParcel[];
  onParcelsChange: (parcels: StoredParcel[]) => void;
  /** La personne a choisi de remplacer son adresse par celle de la parcelle. */
  onAddressAccepted: (address: ParcelAddress) => void;
}

/**
 * Carte cadastrale du terrain, juste sous l'adresse : la parcelle cochée peut
 * proposer sa propre adresse (jamais appliquée sans accord), et les parcelles
 * retenues sont listées avec leur surface et le total.
 */
export function TerrainParcelles({
  currentAddress, mapAddress, banId, parcels, onParcelsChange, onAddressAccepted,
}: TerrainParcellesProps) {
  const [suggestion, setSuggestion] = useState<ParcelAddress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // L'adresse est proposée à la première parcelle cochée : ajouter ensuite les
  // parcelles voisines d'un même terrain ne redemande pas la même chose.
  const suggestFrom = (parcel: StoredParcel) => {
    abortRef.current?.abort();
    const center = parcelCentroid(parcel.geometry);
    if (!center) return;
    const controller = new AbortController();
    abortRef.current = controller;
    fetchParcelAddress(center, controller.signal)
      .then((address) => {
        if (controller.signal.aborted) return;
        setSuggestion(address && !sameAddress(address.label, currentAddress) ? address : null);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') console.warn('[TerrainParcelles] adresse de la parcelle', err);
      });
  };

  const handleMapSelection = (next: StoredParcel[]) => {
    const wasEmpty = parcels.length === 0;
    onParcelsChange(next);
    if (next.length === 0) {
      abortRef.current?.abort();
      setSuggestion(null);
    } else if (wasEmpty) {
      suggestFrom(next[0]);
    }
  };

  const removeParcel = (id: string) => {
    const next = parcels.filter((p) => p.id !== id);
    onParcelsChange(next);
    if (next.length === 0) setSuggestion(null);
  };

  const { total, complete } = totalSurface(parcels);

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        Cliquez sur la parcelle du terrain pour la sélectionner : son adresse peut vous être proposée, et l'adresse saisie reste modifiable à la main.
      </p>

      {suggestion && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between"
          style={{ background: 'var(--tblr-primary-lt)', border: '1px solid var(--tblr-primary)' }}
        >
          <div className="flex items-start gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}>
            <IconMapPin size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              La parcelle sélectionnée se trouve au <strong>{suggestion.label}</strong>.
              {' '}L'adresse saisie est <strong>{currentAddress || 'vide'}</strong>.
              {' '}Souhaitez-vous remplacer l'adresse du terrain ?
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { onAddressAccepted(suggestion); setSuggestion(null); }}
            >
              Changer l'adresse
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setSuggestion(null)}>
              Garder l'adresse saisie
            </button>
          </div>
        </div>
      )}

      <div
        className="relative h-[22rem] overflow-hidden rounded-lg shadow-sm md:h-[28rem]"
        style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
      >
        {mapAddress ? (
          <InfoPanelBoundary label="Cadastre">
            <GeoportailMap
              address={mapAddress}
              banId={banId}
              selection={parcels}
              onSelectionChange={handleMapSelection}
            />
          </InfoPanelBoundary>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm" style={{ color: 'var(--tblr-muted)' }}>
            Saisissez l'adresse du terrain pour afficher la carte cadastrale.
          </div>
        )}
      </div>

      {parcels.length > 0 && (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
          <table className="w-full text-sm">
            <caption className="sr-only">Parcelles sélectionnées</caption>
            <thead style={{ background: 'var(--tblr-surface-2)' }}>
              <tr className="text-left text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                <th scope="col" className="px-3 py-2">Parcelle</th>
                <th scope="col" className="px-3 py-2">Commune</th>
                <th scope="col" className="px-3 py-2 text-right">Surface</th>
                <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Retirer</span></th>
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="px-3 py-2 font-medium">{parcelReference(p) || p.id}</td>
                  <td className="px-3 py-2">{p.commune || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {typeof p.contenance === 'number' ? formatSurface(p.contenance) : '—'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeParcel(p.id)}
                      className="rounded p-1.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      style={{ color: 'var(--tblr-muted)' }}
                      aria-label={`Retirer la parcelle ${parcelReference(p) || p.id}`}
                      title="Retirer la parcelle"
                    >
                      <IconTrash size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold" style={{ borderTop: '2px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <th scope="row" colSpan={2} className="px-3 py-2 text-left">
                  Surface totale ({parcels.length} parcelle{parcels.length > 1 ? 's' : ''})
                </th>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatSurface(total)}
                  {!complete && (
                    <span className="block text-[0.6875rem] font-normal" style={{ color: 'var(--tblr-muted)' }}>
                      partielle : contenance inconnue pour certaines parcelles
                    </span>
                  )}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
