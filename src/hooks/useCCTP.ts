import { useState, useEffect } from 'react';
import { CCTP } from '../types/cctp';

export const useCCTP = (projectId: string) => {
  const [cctp, setCctp] = useState<CCTP | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCCTP = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cctp`);
      if (res.ok) {
        setCctp(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch CCTP:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCCTP();
  }, [projectId]);

  const saveCCTP = async (data: CCTP) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/cctp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setCctp(data);
      }
    } catch (err) {
      console.error('Failed to save CCTP:', err);
    }
  };

  return { cctp, loading, saveCCTP };
};
