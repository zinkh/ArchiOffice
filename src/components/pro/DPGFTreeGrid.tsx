import React, { useMemo } from 'react';
import { useReactTable, getCoreRowModel, getExpandedRowModel, flexRender, createColumnHelper } from '@tanstack/react-table';
import { Lot, Chapitre, Ligne } from '../../types/dpgf';
import { formatCurrency } from '../../lib/utils';

interface DPGFTreeGridProps {
  lots: Lot[];
}

export const DPGFTreeGrid: React.FC<DPGFTreeGridProps> = ({ lots }) => {
  const columnHelper = createColumnHelper<any>();

  const columns = useMemo(() => [
    columnHelper.accessor('designation', {
      header: 'Désignation',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('unite', {
      header: 'Unité',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('quantite', {
      header: 'Quantité',
      cell: info => info.getValue(),
    }),
    columnHelper.accessor('prixUnitaire', {
      header: 'Prix Unitaire (€)',
      cell: info => formatCurrency(info.getValue()),
    }),
    columnHelper.accessor('prixTotal', {
      header: 'Prix Total (€)',
      cell: info => formatCurrency(info.getValue()),
    }),
  ], []);

  const data = useMemo(() => {
    // Flatten structure for react-table with subRows
    return lots.map(lot => ({
      ...lot,
      subRows: lot.chapitres.map(chapitre => ({
        ...chapitre,
        subRows: chapitre.lignes.map(ligne => ({
          ...ligne,
          designation: ligne.designation,
        }))
      }))
    }));
  }, [lots]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: row => row.subRows,
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id} className="p-2 border-b">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id} className={row.original.type === 'titre' ? 'bg-gray-100' : ''}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="p-2 border-b">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
