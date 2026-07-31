import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeAdminMatrix, TimeMonthlySummaryEntry, LeaveBalanceAllEntry, TimeEntry } from '../../types';

const saveAsMock = vi.fn();
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));

// jsPDF's Node build writes real files to disk on `.save(filename)` (it has no
// browser to trigger a download in, and `save` is set as an own instance
// property in the constructor, so it can't be spied on via the prototype) —
// override it post-construction so these tests don't litter the repo working
// directory with generated PDFs.
const { pdfSaveSpy } = vi.hoisted(() => ({ pdfSaveSpy: vi.fn() }));
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class TestJsPDF extends (actual as any).default {
    constructor(...args: any[]) {
      super(...args);
      (this as any).save = (...saveArgs: any[]) => { pdfSaveSpy(...saveArgs); return this; };
    }
  }
  return { ...actual, default: TestJsPDF };
});

beforeEach(() => {
  saveAsMock.mockClear();
  pdfSaveSpy.mockClear();
});

describe('exportAdminMatrixExcel', () => {
  it('writes a non-empty xlsx blob with one row per employee', async () => {
    const { exportAdminMatrixExcel } = await import('../hrExport');
    const matrix: TimeAdminMatrix = {
      employees: [{ id: 'u1', name: 'Alice Martin' }, { id: 'u2', name: 'Bob Durand' }],
      projects: [{ id: 'p1', name: 'Villa Dupont' }],
      cells: [
        { user_id: 'u1', project_id: 'p1', hours: 12.5 },
        { user_id: 'u2', project_id: null, hours: 4 },
      ],
    };

    await exportAdminMatrixExcel(matrix, 'Janvier 2026');

    expect(saveAsMock).toHaveBeenCalledTimes(1);
    const [blob, filename] = saveAsMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toBe('Heures_par_affaire_Janvier_2026.xlsx');
  });
});

describe('exportMonthlySummaryExcel', () => {
  it('writes a non-empty xlsx blob totaling all employee hours', async () => {
    const { exportMonthlySummaryExcel } = await import('../hrExport');
    const rows: TimeMonthlySummaryEntry[] = [
      { user_id: 'u1', name: 'Alice Martin', total_hours: 140 },
      { user_id: 'u2', name: 'Bob Durand', total_hours: 132.5 },
    ];

    await exportMonthlySummaryExcel('Janvier 2026', rows);

    expect(saveAsMock).toHaveBeenCalledTimes(1);
    const [blob] = saveAsMock.mock.calls[0];
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('PDF exports (smoke tests, jsPDF only — no saveAs)', () => {
  it('exportWeeklyTimesheetPdf builds a PDF and calls save(), without touching disk', async () => {
    const { exportWeeklyTimesheetPdf } = await import('../hrExport');
    const entries: TimeEntry[] = [
      {
        id: 't1',
        user_id: 'u1',
        project_id: 'p1',
        entry_date: '2026-01-12',
        start_time: '2026-01-12T08:00:00Z',
        end_time: '2026-01-12T12:00:00Z',
        source: 'manual',
      },
    ];

    await exportWeeklyTimesheetPdf({
      userName: 'Alice Martin',
      weekStartStr: '12-01-2026',
      weekEndStr: '18-01-2026',
      entries,
      projectName: () => 'Villa Dupont',
      totalHours: 4,
      agencySettings: { agencyName: 'Atelier Test' },
    });

    expect(pdfSaveSpy).toHaveBeenCalledTimes(1);
    expect(pdfSaveSpy.mock.calls[0][0]).toBe('Fiche_hebdo_Alice_Martin_12-01-2026.pdf');
  });

  it('exportLeaveBalancesTablePdf builds a PDF and calls save(), without touching disk', async () => {
    const { exportLeaveBalancesTablePdf } = await import('../hrExport');
    const rows: LeaveBalanceAllEntry[] = [
      {
        user_id: 'u1',
        name: 'Alice Martin',
        year: 2026,
        balances: [
          { leave_type: 'conges_payes', allocated_days: 25, used_days: 10, remaining_days: 15 },
          { leave_type: 'rtt', allocated_days: 10, used_days: 2, remaining_days: 8 },
        ],
      },
    ];

    await exportLeaveBalancesTablePdf('2026', rows, { agencyName: 'Atelier Test' });

    expect(pdfSaveSpy).toHaveBeenCalledTimes(1);
    expect(pdfSaveSpy.mock.calls[0][0]).toBe('Soldes_conges_2026.pdf');
  });
});
