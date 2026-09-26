import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, Boxes, CalendarClock, KeyRound, Lock, LogOut, ShieldCheck, User, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@renderer/lib/api';
import { useApiQuery } from '@renderer/lib/query';
import { useSession } from '@renderer/stores/session';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Field } from '@renderer/components/ui/field';
import { Alert } from '@renderer/components/ui/display';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { LogoMark } from '@renderer/components/Logo';

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-200 ring-1 ring-white/15 [&_svg]:size-[18px]">{icon}</div>
      <div>
        <div className="text-[14px] font-semibold text-white">{title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-teal-100/70">{text}</div>
      </div>
    </div>
  );
}

export function LoginScreen() {
  const { t } = useTranslation();
  const boot = useApiQuery('app.bootstrap');
  const setSession = useSession((s) => s.set);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api('auth.login', { username, password }));
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full">
      <div className="drag relative hidden w-[46%] max-w-[680px] flex-col justify-between overflow-hidden bg-[#062623] p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-teal-500/25 blur-[120px]" />
          <div className="absolute -bottom-48 right-[-120px] size-[520px] rounded-full bg-emerald-400/15 blur-[120px]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        </div>
        <div className="relative flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-white">PharmaDesk</div>
            <div className="text-[12px] text-teal-100/60">Pharmacy management suite</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-white">
            Run your pharmacy with <span className="bg-gradient-to-r from-teal-200 to-emerald-200 bg-clip-text text-transparent">clarity and control.</span>
          </h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-teal-50/70">Point of sale, batch-level inventory, purchasing, expiry tracking and accounting — all on this computer, no internet required.</p>
          <div className="mt-10 space-y-5">
            <Feature icon={<Boxes />} title="Batch-level inventory with FEFO" text="Every unit traced from purchase to sale, first-expiry-first-out." />
            <Feature icon={<CalendarClock />} title="Expiry & reorder intelligence" text="Know what expires, what's running low and what to order." />
            <Feature icon={<ShieldCheck />} title="Audit-grade records" text="Role-based access, supervisor overrides and a tamper-proof audit trail." />
          </div>
        </div>
        <div className="relative flex items-center gap-2 text-[12px] text-teal-100/50">
          <WifiOff className="size-3.5" /> Works fully offline · Data stored securely on this computer
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center bg-background">
        <div className="drag absolute inset-x-0 top-0 h-12" />
        <div className="w-[380px]">
          <div className="mb-8 lg:hidden">
            <LogoMark className="size-11" />
          </div>
          <div className="text-[13px] font-medium text-primary">{boot.data?.pharmacyName ?? 'PharmaDesk'}</div>
          <h2 className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{t('login.title', 'Welcome back')}</h2>
          <p className="mt-1.5 text-[14px] text-muted-foreground">{t('login.subtitle', 'Sign in to continue to your workspace.')}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label={t('login.username', 'Username')} htmlFor="username">
              <Input id="username" inputSize="lg" leading={<User />} autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={t('login.password', 'Password')} htmlFor="password">
              <Input id="password" inputSize="lg" type="password" leading={<KeyRound />} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
              {t('login.submit', 'Sign in')}
              {!busy && <ArrowRight />}
            </Button>
          </form>
          {boot.data?.defaultAdminActive && (
            <Alert tone="info" className="mt-6" icon={<BadgeCheck />} title="First-time setup">
              Sign in with username <b className="font-mono">admin</b> and password <b className="font-mono">admin123</b>. You will be asked to choose a new password immediately.
            </Alert>
          )}
          <div className="mt-10 text-[12px] text-muted-foreground">PharmaDesk v{boot.data?.version ?? ''}</div>
        </div>
      </div>
    </div>
  );
}

export function LockScreen() {
  const session = useSession((s) => s.session)!;
  const setSession = useSession((s) => s.set);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api('auth.unlock', { password }));
      void qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-xl">
      <div className="drag absolute inset-x-0 top-0 h-12" />
      <div className="w-[360px] rounded-2xl border border-border bg-card p-8 text-center shadow-dialog">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-lg font-semibold text-white">
          {session.user.fullName
            .split(/\s+/)
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="mt-4 text-[16px] font-semibold">{session.user.fullName}</div>
        <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock className="size-3.5" /> Screen locked
        </div>
        <form onSubmit={submit} className="mt-6 space-y-3 text-start">
          <Input type="password" inputSize="lg" autoFocus placeholder="Enter your password" leading={<KeyRound />} value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!password}>
            Unlock
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          onClick={async () => {
            await api('auth.logout').catch(() => undefined);
            setSession(null);
            qc.clear();
          }}
        >
          <LogOut className="size-3.5" /> Sign in as a different user
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordDialog({ open, onClose, forced }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const setSession = useSession((s) => s.set);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await api('auth.changePassword', { currentPassword: current, newPassword: next }));
      setCurrent('');
      setNext('');
      setConfirm('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !forced && onClose()}>
      <DialogContent size="sm" hideClose={forced} onEscapeKeyDown={(e) => forced && e.preventDefault()} onPointerDownOutside={(e) => forced && e.preventDefault()}>
        <DialogHeader icon={<KeyRound />} title={forced ? 'Choose a new password' : 'Change password'} description={forced ? 'For security, you must replace the temporary password before continuing.' : 'Use at least 8 characters with letters and numbers.'} />
        <form onSubmit={submit}>
          <DialogBody className="space-y-3.5">
            <Field label="Current password">
              <Input type="password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters, including letters and numbers">
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password" error={mismatch ? 'Passwords do not match' : null}>
              <Input type="password" invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
          </DialogBody>
          <DialogFooter>
            {forced ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  await api('auth.logout').catch(() => undefined);
                  setSession(null);
                }}
              >
                Sign out
              </Button>
            ) : (
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" loading={busy} disabled={!current || !next || next !== confirm}>
              Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
