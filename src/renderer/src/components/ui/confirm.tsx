import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from './dialog';
import { Field } from './field';
import { Textarea } from './input';

interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary' | 'warning';
  /** Ask for a mandatory reason (voids, write-offs). The reason is returned. */
  requireReason?: boolean;
  reasonLabel?: string;
  body?: ReactNode;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<string | false>;
const Ctx = createContext<ConfirmFn>(async () => false);

/** `const confirm = useConfirm(); if (await confirm({...}) !== false) …` — resolves to the reason ('' when none) or false. */
export function useConfirm() {
  return useContext(Ctx);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<(v: string | false) => void>(() => undefined);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setReason('');
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: string | false) => {
    resolver.current(v);
    setOpts(null);
  };

  const tone = opts?.tone ?? 'primary';
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
        {opts && (
          <DialogContent size="sm">
            <DialogHeader icon={tone === 'primary' ? <HelpCircle /> : <AlertTriangle />} tone={tone === 'primary' ? 'primary' : tone} title={opts.title} description={opts.description} />
            {(opts.requireReason || opts.body) && (
              <DialogBody className="space-y-4">
                {opts.body}
                {opts.requireReason && (
                  <Field label={opts.reasonLabel ?? 'Reason'} required hint="Recorded in the audit log">
                    <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why…" />
                  </Field>
                )}
              </DialogBody>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </Button>
              <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={opts.requireReason && reason.trim().length < 3} onClick={() => close(reason.trim())} autoFocus={!opts.requireReason}>
                {opts.confirmLabel ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}
