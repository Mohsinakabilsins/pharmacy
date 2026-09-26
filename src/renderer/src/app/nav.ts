import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ScanBarcode,
  ReceiptText,
  Undo2,
  Users,
  FileHeart,
  Pill,
  Boxes,
  CalendarClock,
  PackageSearch,
  Truck,
  Building2,
  Wallet,
  HandCoins,
  ArrowLeftRight,
  BarChart3,
  UserCog,
  ScrollText,
  DatabaseBackup,
  Settings,
} from 'lucide-react';
import type { PermissionKey } from '@shared/permissions';

export interface NavItem {
  to: string;
  label: string;
  i18n: string;
  icon: LucideIcon;
  perms: PermissionKey[];
  shortcut?: string;
}

export interface NavGroup {
  label: string;
  i18n: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    i18n: 'nav.overview',
    items: [{ to: '/', label: 'Dashboard', i18n: 'nav.dashboard', icon: LayoutDashboard, perms: ['dashboard.view'] }],
  },
  {
    label: 'Sales',
    i18n: 'nav.sales',
    items: [
      { to: '/pos', label: 'Point of Sale', i18n: 'nav.pos', icon: ScanBarcode, perms: ['pos.access'], shortcut: 'F2' },
      { to: '/sales', label: 'Sales history', i18n: 'nav.salesHistory', icon: ReceiptText, perms: ['sales.view', 'sales.view_own'] },
      { to: '/returns', label: 'Returns', i18n: 'nav.returns', icon: Undo2, perms: ['returns.manage'] },
      { to: '/customers', label: 'Customers', i18n: 'nav.customers', icon: Users, perms: ['customers.view'] },
      { to: '/prescriptions', label: 'Prescriptions', i18n: 'nav.prescriptions', icon: FileHeart, perms: ['prescriptions.view'] },
    ],
  },
  {
    label: 'Inventory',
    i18n: 'nav.inventory',
    items: [
      { to: '/products', label: 'Products', i18n: 'nav.products', icon: Pill, perms: ['products.view'] },
      { to: '/stock', label: 'Stock & batches', i18n: 'nav.stock', icon: Boxes, perms: ['inventory.view'] },
      { to: '/expiry', label: 'Expiry', i18n: 'nav.expiry', icon: CalendarClock, perms: ['inventory.view'] },
      { to: '/reorder', label: 'Reorder', i18n: 'nav.reorder', icon: PackageSearch, perms: ['inventory.view'] },
    ],
  },
  {
    label: 'Purchasing',
    i18n: 'nav.purchasing',
    items: [
      { to: '/purchases', label: 'Purchases', i18n: 'nav.purchases', icon: Truck, perms: ['purchases.view'] },
      { to: '/suppliers', label: 'Suppliers', i18n: 'nav.suppliers', icon: Building2, perms: ['suppliers.view'] },
    ],
  },
  {
    label: 'Finance',
    i18n: 'nav.finance',
    items: [
      { to: '/cash', label: 'Cash register', i18n: 'nav.cash', icon: Wallet, perms: ['cash.operate', 'cash.view_all'] },
      { to: '/expenses', label: 'Expenses', i18n: 'nav.expenses', icon: HandCoins, perms: ['expenses.view'] },
      { to: '/payments', label: 'Payments', i18n: 'nav.payments', icon: ArrowLeftRight, perms: ['payments.view'] },
    ],
  },
  {
    label: 'Insights',
    i18n: 'nav.insights',
    items: [{ to: '/reports', label: 'Reports', i18n: 'nav.reports', icon: BarChart3, perms: ['reports.sales', 'reports.inventory', 'reports.purchases', 'reports.financial'] }],
  },
  {
    label: 'Administration',
    i18n: 'nav.admin',
    items: [
      { to: '/users', label: 'Users & roles', i18n: 'nav.users', icon: UserCog, perms: ['users.manage', 'roles.manage'] },
      { to: '/audit', label: 'Audit log', i18n: 'nav.audit', icon: ScrollText, perms: ['audit.view'] },
      { to: '/backup', label: 'Backup & restore', i18n: 'nav.backup', icon: DatabaseBackup, perms: ['backup.manage'] },
      { to: '/settings', label: 'Settings', i18n: 'nav.settings', icon: Settings, perms: ['settings.manage'] },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);
