import { Download, FileSpreadsheet, FileText, Printer, Sheet as SheetIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { ReportParamsSchema } from '@shared/schemas/reports';
import { api, errorMessage } from '@renderer/lib/api';
import { Button } from './ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui/menu';

export function ExportMenu({ reportId, params, label = 'Export' }: { reportId: string; params: z.input<typeof ReportParamsSchema>; label?: string }) {
  const run = async (format: 'csv' | 'xlsx' | 'pdf' | 'print') => {
    try {
      const r = await api('reports.export', { reportId, params, format });
      if (r.filePath) toast.success('Export saved', { description: r.filePath });
      else if (r.printed) toast.success('Sent to printer');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button icon={<Download />}>{label}</Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<FileSpreadsheet />} onSelect={() => void run('xlsx')}>
          Excel workbook (.xlsx)
        </MenuItem>
        <MenuItem icon={<SheetIcon />} onSelect={() => void run('csv')}>
          CSV
        </MenuItem>
        <MenuItem icon={<FileText />} onSelect={() => void run('pdf')}>
          PDF
        </MenuItem>
        <MenuItem icon={<Printer />} onSelect={() => void run('print')}>
          Print
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
