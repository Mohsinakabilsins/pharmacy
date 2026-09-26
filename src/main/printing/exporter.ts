import ExcelJS from 'exceljs';
import type { AppSettings } from '@shared/settings';
import type { ReportColumn, ReportResult } from '@shared/types/reports';
import { formatDate, formatDateTime, formatQty } from '@shared/format';

function plain(c: ReportColumn, row: Record<string, unknown>, s: AppSettings): string | number | null {
  const v = row[c.key];
  if (v === null || v === undefined) return null;
  switch (c.type) {
    case 'money':
      return Number(v) / 100;
    case 'number':
    case 'percent':
      return Math.round(Number(v) * 100) / 100;
    case 'qty':
      return Number(v);
    case 'date':
      return formatDate(String(v), s.locale.dateFormat);
    case 'datetime':
      return formatDateTime(String(v), s.locale.dateFormat, s.locale.timeFormat);
    default:
      return String(v);
  }
}

function csvEscape(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: ReportResult, s: AppSettings): string {
  const lines: string[] = [];
  if (r.statement) {
    lines.push('Line,Amount');
    for (const l of r.statement) lines.push(`${csvEscape(`${'  '.repeat(l.level)}${l.label}`)},${l.value === null ? '' : (l.value / 100).toFixed(2)}`);
  } else {
    lines.push(r.columns.map((c) => csvEscape(c.type === 'money' ? `${c.label} (${s.currency.code})` : c.label)).join(','));
    for (const row of r.rows) lines.push(r.columns.map((c) => csvEscape(plain(c, row, s))).join(','));
    if (r.totals) lines.push(r.columns.map((c) => csvEscape(r.totals![c.key] !== undefined ? plain(c, r.totals as Record<string, unknown>, s) : '')).join(','));
  }
  // BOM so Excel opens UTF-8 correctly
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function reportToXlsx(r: ReportResult, s: AppSettings, user: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PharmaDesk';
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }] });
  const moneyFmt = s.currency.decimals === 0 ? '#,##0' : '#,##0.00';
  ws.mergeCells(1, 1, 1, Math.max(2, r.columns.length));
  ws.getCell(1, 1).value = `${s.pharmacy.name} — ${r.title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF0F766E' } };
  ws.getCell(2, 1).value = r.subtitle;
  ws.getCell(3, 1).value = `Generated ${formatDateTime(r.generatedAt, s.locale.dateFormat, s.locale.timeFormat)} by ${user}`;
  ws.getCell(3, 1).font = { color: { argb: 'FF64748B' }, size: 9 };

  if (r.statement) {
    ws.getRow(5).values = ['Line', `Amount (${s.currency.code})`];
    ws.getRow(5).font = { bold: true };
    r.statement.forEach((l, i) => {
      const row = ws.getRow(6 + i);
      row.getCell(1).value = `${'    '.repeat(l.level)}${l.label}`;
      row.getCell(2).value = l.value === null ? null : l.value / 100;
      row.getCell(2).numFmt = moneyFmt;
      if (l.emphasis === 'total' || l.emphasis === 'grand') row.font = { bold: true };
    });
    ws.getColumn(1).width = 56;
    ws.getColumn(2).width = 18;
  } else {
    const header = ws.getRow(5);
    r.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.type === 'money' ? `${c.label} (${s.currency.code})` : c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left', vertical: 'middle' };
    });
    header.height = 20;
    r.rows.forEach((row, ri) => {
      const xr = ws.getRow(6 + ri);
      r.columns.forEach((c, ci) => {
        const cell = xr.getCell(ci + 1);
        cell.value = plain(c, row, s);
        if (c.type === 'money') cell.numFmt = moneyFmt;
        if (c.type === 'percent') cell.numFmt = '0.0"%"';
        if (c.type === 'qty' && c.packKey) cell.note = formatQty(Number(row[c.key] ?? 0), Number(row[c.packKey] ?? 1));
      });
    });
    if (r.totals) {
      const tr = ws.getRow(6 + r.rows.length);
      r.columns.forEach((c, ci) => {
        const cell = tr.getCell(ci + 1);
        const v = r.totals![c.key];
        cell.value = v === undefined ? null : plain(c, r.totals as Record<string, unknown>, s);
        if (c.type === 'money') cell.numFmt = moneyFmt;
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' } };
      });
    }
    r.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.min(48, Math.max(c.label.length + 4, c.type === 'text' ? 22 : 14));
    });
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: r.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
