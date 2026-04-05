import { useState, useEffect, useMemo } from 'react';
import { DPGF } from '../types/dpgf';

export const useDPGF = (projectId: string) => {
  const [dpgf, setDpgf] = useState<DPGF | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDPGF = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/dpgf`);
      if (res.ok) {
        setDpgf(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch DPGF:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDPGF();
  }, [projectId]);

  const saveDPGF = async (data: DPGF) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/dpgf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setDpgf(data);
      }
    } catch (err) {
      console.error('Failed to save DPGF:', err);
    }
  };

  const totalHT = useMemo(() => {
    if (!dpgf) return 0;
    return dpgf.lots.reduce((acc, lot) => acc + lot.sousTotal, 0);
  }, [dpgf]);

  return { dpgf, loading, saveDPGF, totalHT };
};
