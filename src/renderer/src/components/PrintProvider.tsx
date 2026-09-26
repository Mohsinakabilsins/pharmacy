import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { FileDown, Printer, Receipt, FileText } from 'lucide-react';
import { toast } from 'sonner';
import type { PrintResult } from '@shared/types/system';
import { api, errorMessage } from '@renderer/lib/api';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from './ui/dialog';
import { Segmented } from './ui/controls';
import { Spinner } from './ui/display';

type PrintChannel = 'print.sale' | 'print.return' | 'print.cashSession' | 'print.purchase';
interface Job {
  channel: PrintChannel;
  id: number;
  title: string;
  format: 'receipt' | 'a4';
  allowFormats?: boolean;
}

interface PrintApi {
  preview: (job: Job) => void;
  print: (job: Omit<Job, 'title'>) => Promise<void>;
  showHtml: (title: string, result: PrintResult, onPrint?: () => Promise<void>) => void;
}

const Ctx = createContext<PrintApi>({ preview: () => undefined, print: async () => undefined, showHtml: () => undefined });
export function usePrint() {
  return useContext(Ctx);
}

export function PrintProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const [custom, setCustom] = useState<{ title: string; result: PrintResult; onPrint?: () => Promise<void> } | null>(null);
  const [result, setResult] = useState<PrintResult | null>(null);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  const load = useCallback(async (j: Job) => {
    setResult(null);
    try {
      setResult(await api(j.channel, { id: j.id, mode: 'preview', format: j.format }));
    } catch (e) {
      toast.error(errorMessage(e));
      setJob(null);
    }
  }, []);

  const preview = useCallback(
    (j: Job) => {
      setCustom(null);
      setJob(j);
      void load(j);
    },
    [load],
  );

  const print = useCallback(async (j: Omit<Job, 'title'>) => {
    try {
      const r = await api(j.channel, { id: j.id, mode: 'print', format: j.format });
      if (r.printed) toast.success('Sent to printer');
    } catch (e) {
      toast.error(`Printing failed: ${errorMessage(e)}`);
    }
  }, []);

  const showHtml = useCallback((title: string, r: PrintResult, onPrint?: () => Promise<void>) => {
    setJob(null);
    setCustom({ title, result: r, onPrint });
  }, []);

  const run = async (mode: 'print' | 'pdf') => {
    setBusy(mode);
    try {
      if (custom) {
        if (mode === 'print' && custom.onPrint) await custom.onPrint();
        return;
      }
      if (!job) return;
      const r = await api(job.channel, { id: job.id, mode, format: job.format });
      if (mode === 'pdf' && r.filePath) toast.success('PDF saved', { description: r.filePath });
      if (mode === 'print' && r.printed) toast.success('Sent to printer');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const active = custom?.result ?? result;
  const open = !!job || !!custom;
  const paper = active?.paper ?? 'A4';
  const frameWidth = paper === '58mm' ? 260 : paper === '80mm' ? 340 : paper === 'label' ? 420 : 820;
  return (
    <Ctx.Provider value={{ preview, print, showHtml }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setJob(null);
            setCustom(null);
          }
        }}
      >
        {open && (
          <DialogContent size={paper === 'A4' ? 'xl' : 'md'} className="h-[calc(100vh-48px)]">
            <DialogHeader icon={paper === 'A4' ? <FileText /> : <Receipt />} title={custom?.title ?? job?.title ?? 'Print preview'} description="Preview exactly what will be printed." />
            <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/60 p-6">
              {active?.html ? (
                <iframe title="Print preview" sandbox="" srcDoc={active.html} className="h-full min-h-[70vh] shrink-0 rounded-md bg-white shadow-pop" style={{ width: frameWidth }} />
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner /> Rendering…
                </div>
              )}
            </div>
            <DialogFooter
              aside={
                job?.allowFormats ? (
                  <Segmented
                    size="sm"
                    value={job.format}
                    onChange={(f) => {
                      const next = { ...job, format: f };
                      setJob(next);
                      void load(next);
                    }}
                    options={[
                      { value: 'receipt', label: 'Thermal receipt' },
                      { value: 'a4', label: 'A4 invoice' },
                    ]}
                  />
                ) : undefined
              }
            >
              {!custom && (
                <Button icon={<FileDown />} loading={busy === 'pdf'} onClick={() => void run('pdf')}>
                  Save PDF
                </Button>
              )}
              {(!custom || custom.onPrint) && (
                <Button variant="primary" icon={<Printer />} loading={busy === 'print'} onClick={() => void run('print')}>
                  Print
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}
