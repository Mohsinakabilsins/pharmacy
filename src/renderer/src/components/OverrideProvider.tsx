import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, KeyRound, User } from 'lucide-react';
import { PERMISSIONS, type PermissionKey } from '@shared/permissions';
import { api, errorMessage } from '@renderer/lib/api';
import { Button } from './ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from './ui/dialog';
import { Field } from './ui/field';
import { Input } from './ui/input';
import { Alert } from './ui/display';

type RequestFn = (permission: string, context?: string) => Promise<string | null>;
const Ctx = createContext<RequestFn>(async () => null);

/** Ask a supervisor to authorise a protected action. Resolves to a single-use token or null. */
export function useOverride() {
  return useContext(Ctx);
}

export function OverrideProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<{ permission: string; context?: string } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<(t: string | null) => void>(() => undefined);

  const request = useCallback<RequestFn>((permission, context) => {
    setReq({ permission, context });
    setUsername('');
    setPassword('');
    setReason('');
    setError(null);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (token: string | null) => {
    resolver.current(token);
    setReq(null);
  };

  const submit = async () => {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api('auth.override', { username, password, permission: req.permission as PermissionKey, reason });
      close(res.token);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const label = req ? (PERMISSIONS[req.permission as PermissionKey]?.label ?? req.permission) : '';
  return (
    <Ctx.Provider value={request}>
      {children}
      <Dialog open={!!req} onOpenChange={(o) => !o && close(null)}>
        {req && (
          <DialogContent size="sm">
            <DialogHeader icon={<ShieldCheck />} tone="warning" title="Supervisor authorisation" description={<>This action needs approval: <b className="text-foreground">{label}</b>. It will be recorded in the audit log.</>} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <DialogBody className="space-y-3.5">
                {req.context && <Alert tone="warning">{req.context}</Alert>}
                <Field label="Supervisor username">
                  <Input autoFocus leading={<User />} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Password">
                  <Input type="password" leading={<KeyRound />} value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Field label="Reason (optional)">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer request" />
                </Field>
                {error && <p className="text-[12.5px] text-danger">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => close(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy} disabled={!username || !password}>
                  Authorise
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </Ctx.Provider>
  );
}
