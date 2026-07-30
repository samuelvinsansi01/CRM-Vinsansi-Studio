import { Archive, Check, Edit2, Eye, Instagram, MessageCircle, Power, PowerOff, RefreshCcw, RotateCcw, Send, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { IconButton } from '../action/IconButton';

export type TableAction = 'view' | 'edit' | 'delete' | 'archive' | 'activate' | 'deactivate' | 'invalidate' | 'refresh' | 'whatsapp' | 'instagram' | 'cancel' | 'restore' | 'approve' | 'unapprove' | 'sent' | 'validate';

export type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  width?: string;
  render?: (row: T, index: number) => ReactNode;
};

type DataTableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  actions?: TableAction[];
  selectable?: boolean;
  selectedRows?: number[];
  onSelectedRowsChange?: (selectedRows: number[]) => void;
  onAction?: (action: TableAction, row: T, index: number) => void;
  getRowActions?: (row: T, index: number) => TableAction[];
};

const actionIcon = {
  view: Eye,
  edit: Edit2,
  delete: Trash2,
  archive: Archive,
  activate: Power,
  deactivate: PowerOff,
  invalidate: X,
  refresh: RefreshCcw,
  whatsapp: MessageCircle,
  instagram: Instagram,
  cancel: X,
  restore: RotateCcw,
  approve: Check,
  unapprove: X,
  sent: Send,
  validate: Check,
};

const actionLabel = {
  view: 'Visualizar',
  edit: 'Editar',
  delete: 'Excluir',
  archive: 'Arquivar',
  activate: 'Ativar',
  deactivate: 'Desativar',
  invalidate: 'Invalidar',
  refresh: 'Sincronizar',
  whatsapp: 'Enviar para WhatsApp',
  instagram: 'Enviar para Instagram',
  cancel: 'Cancelar',
  restore: 'Restaurar',
  approve: 'Aprovar',
  unapprove: 'Desaprovar',
  sent: 'Marcar como enviado',
  validate: 'Validar',
};

const actionTone = {
  view: 'neutral',
  edit: 'neutral',
  delete: 'danger',
  archive: 'danger',
  activate: 'success',
  deactivate: 'danger',
  invalidate: 'danger',
  refresh: 'neutral',
  whatsapp: 'success',
  instagram: 'primary',
  cancel: 'danger',
  restore: 'neutral',
  approve: 'success',
  unapprove: 'warning',
  sent: 'success',
  validate: 'success',
} as const;

export function DataTable<T extends Record<string, ReactNode>>({
  columns,
  rows,
  actions = ['view', 'edit', 'delete'],
  selectable = true,
  selectedRows,
  onSelectedRowsChange,
  onAction,
  getRowActions,
}: DataTableProps<T>) {
  const [internalSelectedRows, setInternalSelectedRows] = useState<number[]>([]);
  const currentSelectedRows = selectedRows ?? internalSelectedRows;
  const selectedSet = useMemo(() => new Set(currentSelectedRows), [currentSelectedRows]);
  const allSelected = rows.length > 0 && rows.every((_, index) => selectedSet.has(index));
  const partiallySelected = currentSelectedRows.length > 0 && !allSelected;

  const setSelection = (nextRows: number[]) => {
    if (selectedRows === undefined) {
      setInternalSelectedRows(nextRows);
    }
    onSelectedRowsChange?.(nextRows);
  };

  const toggleAll = () => {
    setSelection(allSelected ? [] : rows.map((_, index) => index));
  };

  const toggleRow = (index: number) => {
    const nextSet = new Set(currentSelectedRows);
    if (nextSet.has(index)) {
      nextSet.delete(index);
    } else {
      nextSet.add(index);
    }
    setSelection(Array.from(nextSet).sort((a, b) => a - b));
  };

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {selectable ? (
              <th className="data-table__check">
                <button
                  className={`checkbox ${allSelected ? 'checkbox--checked' : ''} ${partiallySelected ? 'checkbox--mixed' : ''}`}
                  type="button"
                  aria-label="Selecionar todos"
                  aria-pressed={allSelected}
                  onClick={toggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={String(column.key)} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
            {actions.length ? <th className="data-table__actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className={selectedSet.has(rowIndex) ? 'data-table__row--selected' : ''} key={rowIndex}>
              {selectable ? (
                <td className="data-table__check">
                  <button
                    className={`checkbox ${selectedSet.has(rowIndex) ? 'checkbox--checked' : ''}`}
                    type="button"
                    aria-label={`Selecionar linha ${rowIndex + 1}`}
                    aria-pressed={selectedSet.has(rowIndex)}
                    onClick={() => toggleRow(rowIndex)}
                  />
                </td>
              ) : null}
              {columns.map((column) => (
                <td key={String(column.key)}>
                  {column.render ? column.render(row, rowIndex) : row[column.key as keyof T]}
                </td>
              ))}
              {actions.length ? (
                <td className="data-table__actions">
                  {(getRowActions?.(row, rowIndex) ?? actions).map((action) => {
                    const Icon = actionIcon[action];
                    return (
                      <IconButton
                        icon={Icon}
                        label={actionLabel[action]}
                        size="sm"
                        tone={actionTone[action]}
                        key={action}
                        onClick={() => onAction?.(action, row, rowIndex)}
                      />
                    );
                  })}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
