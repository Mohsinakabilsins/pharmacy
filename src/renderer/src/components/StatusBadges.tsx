import type { StockStatus, ExpiryBucket } from '@shared/calc/stock';
import { Badge, type Tone } from './ui/display';
import { PAYMENT_METHOD_LABELS } from '@shared/types/common';
import { Banknote, CreditCard, Landmark, Smartphone, UserRound, FileCheck2 } from 'lucide-react';

const STOCK: Record<StockStatus, [Tone, string]> = {
  OUT_OF_STOCK: ['danger', 'Out of stock'],
  LOW_STOCK: ['warning', 'Low stock'],
  REORDER: ['info', 'Reorder'],
  OVERSTOCK: ['violet', 'Overstock'],
  OK: ['success', 'In stock'],
};

export function StockBadge({ status }: { status: StockStatus }) {
  const [tone, label] = STOCK[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export function ExpiryBadge({ bucket, days }: { bucket: ExpiryBucket; days?: number }) {
  if (bucket === 'EXPIRED') return <Badge tone="danger" dot>Expired{days !== undefined && days < 0 ? ` ${-days}d ago` : ''}</Badge>;
  if (bucket === 'D30') return <Badge tone="danger" dot>{days !== undefined ? `${days}d left` : '≤ 30 days'}</Badge>;
  if (bucket === 'D60') return <Badge tone="warning" dot>{days !== undefined ? `${days}d left` : '31–60 days'}</Badge>;
  if (bucket === 'D90') return <Badge tone="info" dot>{days !== undefined ? `${days}d left` : '61–90 days'}</Badge>;
  return <Badge tone="success" dot>Good</Badge>;
}

const DOC: Record<string, [Tone, string]> = {
  COMPLETED: ['success', 'Completed'],
  POSTED: ['success', 'Posted'],
  DRAFT: ['warning', 'Draft'],
  VOID: ['danger', 'Void'],
  OPEN: ['info', 'Open'],
  CLOSED: ['neutral', 'Closed'],
  ACTIVE: ['success', 'Active'],
  ARCHIVED: ['neutral', 'Archived'],
  QUARANTINED: ['warning', 'Quarantined'],
  RECALLED: ['danger', 'Recalled'],
  SUCCESS: ['success', 'Success'],
  FAILED: ['danger', 'Failed'],
  INFO: ['info', 'Info'],
  WARNING: ['warning', 'Warning'],
  CRITICAL: ['danger', 'Critical'],
  EXPIRED: ['danger', 'Expired'],
};

export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = DOC[status] ?? ['neutral', status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

const METHOD_ICON: Record<string, typeof Banknote> = { CASH: Banknote, CARD: CreditCard, BANK_TRANSFER: Landmark, MOBILE_WALLET: Smartphone, CREDIT: UserRound, CUSTOMER_ACCOUNT: UserRound, CHEQUE: FileCheck2 };

export function MethodLabel({ method, className }: { method: string; className?: string }) {
  const Icon = METHOD_ICON[method] ?? Banknote;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <Icon className="size-3.5 text-muted-foreground" />
      {PAYMENT_METHOD_LABELS[method] ?? method}
    </span>
  );
}

export function RxBadges({ rx, controlled }: { rx?: boolean; controlled?: boolean }) {
  return (
    <>
      {controlled && <Badge tone="danger">CD</Badge>}
      {rx && !controlled && <Badge tone="violet">Rx</Badge>}
    </>
  );
}
