import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, UserCog, UserPlus, Users, Lock, Trash2 } from 'lucide-react';
import type { RoleRow, UserRow } from '@shared/types/auth';
import { PERMISSIONS, PERMISSION_MODULES, type PermissionKey } from '@shared/permissions';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useCan, useSession } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, EmptyState } from '@renderer/components/ui/display';
import { Checkbox, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { DataTable } from '@renderer/components/DataTable';
import { useConfirm } from '@renderer/components/ui/confirm';

export function UsersPage() {
  const can = useCan();
  return (
    <Page>
      <PageHeader title="Users & roles" description="Who can sign in and what each role is allowed to do. Every change is audit-logged." icon={<UserCog />} />
      <Tabs defaultValue={can('users.manage') ? 'users' : 'roles'}>
        <TabsList className="mb-4">
          {can('users.manage') && (
            <TabsTrigger value="users">
              <Users /> Users
            </TabsTrigger>
          )}
          <TabsTrigger value="roles">
            <ShieldCheck /> Roles & permissions
          </TabsTrigger>
        </TabsList>
        {can('users.manage') && (
          <TabsContent value="users">
            <UserList />
          </TabsContent>
        )}
        <TabsContent value="roles">
          <RoleMatrix />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function UserList() {
  const f = useFormat();
  const users = useApiQuery('users.list');
  const roles = useApiQuery('roles.list');
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [reset, setReset] = useState<UserRow | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[13px] text-muted-foreground">{users.data?.filter((u) => u.isActive).length ?? 0} active users</span>
        <Button size="sm" variant="primary" icon={<UserPlus />} onClick={() => setEdit('new')}>
          Add user
        </Button>
      </div>
      <DataTable
        rows={users.data}
        loading={users.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEdit(r)}
        rowClassName={(r) => (r.isActive ? undefined : 'opacity-55')}
        columns={[
          {
            key: 'name',
            header: 'User',
            cell: (r) => (
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-[11px] font-semibold text-white">
                  {r.fullName
                    .split(/\s+/)
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div>
                  <div className="font-semibold">{r.fullName}</div>
                  <div className="font-mono text-[12px] text-muted-foreground">{r.username}</div>
                </div>
              </div>
            ),
          },
          { key: 'role', header: 'Role', cell: (r) => <Badge tone={r.roleName === 'Administrator' ? 'violet' : 'neutral'}>{r.roleName}</Badge> },
          { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
          { key: 'last', header: 'Last sign-in', cell: (r) => <span className="text-[12.5px]">{r.lastLoginAt ? f.dateTime(r.lastLoginAt) : 'Never'}</span> },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="flex gap-1.5">
                {r.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge>Deactivated</Badge>}
                {r.mustChangePassword && <Badge tone="warning">Password reset pending</Badge>}
                {r.lockedUntil && new Date(r.lockedUntil) > new Date() && <Badge tone="danger" icon={<Lock />}>Locked</Badge>}
              </div>
            ),
          },
          {
            key: 'act',
            header: '',
            cell: (r) => (
              <Button
                size="xs"
                variant="ghost"
                icon={<KeyRound />}
                onClick={(e) => {
                  e.stopPropagation();
                  setReset(r);
                }}
              >
                Reset password
              </Button>
            ),
          },
        ]}
      />
      <UserDialog value={edit} roles={roles.data ?? []} onClose={() => setEdit(null)} />
      <ResetDialog user={reset} onClose={() => setReset(null)} />
    </Card>
  );
}

function UserDialog({ value, roles, onClose }: { value: UserRow | 'new' | null; roles: RoleRow[]; onClose: () => void }) {
  const me = useSession((s) => s.session?.user.id);
  const editing = value && value !== 'new' ? value : null;
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [isActive, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setUsername(editing?.username ?? '');
    setFullName(editing?.fullName ?? '');
    setPhone(editing?.phone ?? '');
    setRoleId(editing?.roleId ?? roles.find((r) => r.name === 'Cashier')?.id ?? null);
    setPassword('');
    setActive(editing?.isActive ?? true);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useApiMutation('users.create', { success: 'User created', onSuccess: onClose, onError: (e) => setErrors(e.fields ?? {}) });
  const update = useApiMutation('users.update', { success: 'User updated', onSuccess: onClose, onError: (e) => setErrors(e.fields ?? {}) });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<UserCog />} title={editing ? `Edit ${editing.fullName}` : 'Add user'} description={editing ? `Username ${editing.username}` : 'The user must choose their own password at first sign-in.'} />
        <DialogBody className="grid grid-cols-2 gap-4">
          {!editing && (
            <Field label="Username" required error={errors.username}>
              <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className="font-mono" />
            </Field>
          )}
          <Field label="Full name" required error={errors.fullName} className={editing ? 'col-span-2' : undefined}>
            <Input autoFocus={!!editing} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Role" required>
            <Select value={roleId ? String(roleId) : null} onChange={(v) => setRoleId(v ? Number(v) : null)} options={roles.map((r) => ({ value: String(r.id), label: r.name }))} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          {!editing && (
            <Field label="Temporary password" required error={errors.password} hint="At least 8 characters with letters and numbers" className="col-span-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {editing && (
            <div className="col-span-2">
              <SwitchRow label="Active" description={editing.id === me ? 'You cannot deactivate your own account.' : 'Deactivated users cannot sign in. Their history is kept.'} checked={isActive} onChange={setActive} disabled={editing.id === me} />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending || update.isPending}
            disabled={!fullName.trim() || !roleId || (!editing && (!username.trim() || !password))}
            onClick={() => (editing ? update.mutate({ id: editing.id, fullName, phone: phone || null, roleId: roleId!, isActive }) : create.mutate({ username, fullName, phone: phone || null, roleId: roleId!, password, mustChangePassword: true }))}
          >
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const m = useApiMutation('users.resetPassword', { success: 'Password reset — the user must change it at next sign-in', onSuccess: () => (onClose(), setPw('')) });
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      {user && (
        <DialogContent size="sm">
          <DialogHeader icon={<KeyRound />} tone="warning" title={`Reset password for ${user.fullName}`} description="Also unlocks the account if it was locked after failed attempts." />
          <DialogBody>
            <Field label="Temporary password" hint="At least 8 characters with letters and numbers">
              <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={!pw} onClick={() => m.mutate({ id: user.id, newPassword: pw })}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function RoleMatrix() {
  const can = useCan();
  const confirm = useConfirm();
  const roles = useApiQuery('roles.list');
  const [selected, setSelected] = useState<number | null>(null);
  const role = roles.data?.find((r) => r.id === selected) ?? roles.data?.[0];
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (role && !creating) {
      setPerms(new Set(role.permissions));
      setName(role.name);
      setDescription(role.description ?? '');
    }
  }, [role, creating]);
  const save = useApiMutation('roles.save', { success: 'Role saved', onSuccess: (r) => (setCreating(false), setSelected(r.id)) });
  const del = useApiMutation('roles.delete', { success: 'Role deleted', onSuccess: () => setSelected(null) });
  const byModule = useMemo(() => PERMISSION_MODULES.map((m) => ({ module: m, keys: (Object.keys(PERMISSIONS) as PermissionKey[]).filter((k) => PERMISSIONS[k].module === m) })), []);
  const editable = can('roles.manage') && !(role?.isSystem && !creating);
  const dirty = creating || (role && (name !== role.name || (description || '') !== (role.description ?? '') || perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p))));
  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <Card className="h-fit overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-[13px] font-semibold">Roles</span>
          {can('roles.manage') && (
            <Button
              size="xs"
              variant="soft"
              icon={<Plus />}
              onClick={() => {
                setCreating(true);
                setName('');
                setDescription('');
                setPerms(new Set(['pos.access']));
              }}
            >
              New
            </Button>
          )}
        </div>
        <div className="p-1.5">
          {roles.data?.map((r) => (
            <button key={r.id} type="button" onClick={() => (setCreating(false), setSelected(r.id))} className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-start transition', !creating && role?.id === r.id ? 'bg-primary-soft/70' : 'hover:bg-muted')}>
              <span>
                <span className="block text-[13.5px] font-medium">{r.name}</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {r.permissions.length} permissions · {r.userCount} users
                </span>
              </span>
              {r.isSystem && <Lock className="size-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Field label="Role name">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable || role?.isSystem} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} />
            </Field>
          </div>
          {can('roles.manage') && (
            <div className="flex gap-2">
              {!creating && role && !role.isSystem && (
                <Button
                  variant="ghost"
                  icon={<Trash2 />}
                  onClick={async () => {
                    if ((await confirm({ title: `Delete role "${role.name}"?`, description: role.userCount ? 'Reassign its users first.' : 'This cannot be undone.', tone: 'danger', confirmLabel: 'Delete role' })) !== false) del.mutate({ id: role.id });
                  }}
                >
                  Delete
                </Button>
              )}
              <Button variant="primary" loading={save.isPending} disabled={!dirty || !name.trim() || !editable} onClick={() => save.mutate({ id: creating ? undefined : role?.id, name, description: description || null, permissions: Array.from(perms) as PermissionKey[] })}>
                {creating ? 'Create role' : 'Save permissions'}
              </Button>
            </div>
          )}
        </div>
        {role?.isSystem && !creating && <Alert tone="info" className="m-5 mb-0">The Administrator role always has every permission and cannot be changed or deleted.</Alert>}
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 p-5">
          {byModule.map(({ module, keys }) => {
            const all = keys.every((k) => perms.has(k));
            const some = keys.some((k) => perms.has(k));
            return (
              <div key={module}>
                <label className="mb-2 flex items-center gap-2.5 border-b border-border pb-2">
                  <Checkbox
                    checked={all ? true : some ? 'indeterminate' : false}
                    disabled={!editable}
                    onChange={(v) =>
                      setPerms((s) => {
                        const n = new Set(s);
                        for (const k of keys) {
                          if (v) n.add(k);
                          else n.delete(k);
                        }
                        return n;
                      })
                    }
                  />
                  <span className="text-[13px] font-semibold">{module}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {keys.filter((k) => perms.has(k)).length}/{keys.length}
                  </span>
                </label>
                <div className="space-y-1.5">
                  {keys.map((k) => (
                    <label key={k} className={cn('flex items-center gap-2.5 rounded-md px-1 py-0.5 text-[13px]', editable && 'cursor-pointer hover:bg-subtle')}>
                      <Checkbox
                        checked={perms.has(k)}
                        disabled={!editable}
                        onChange={(v) =>
                          setPerms((s) => {
                            const n = new Set(s);
                            if (v) n.add(k);
                            else n.delete(k);
                            return n;
                          })
                        }
                      />
                      <span className="flex-1">{PERMISSIONS[k].label}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground/70">{k}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {!roles.data && <EmptyState title="Loading roles" />}
      </Card>
    </div>
  );
}
