/**
 * Permission catalogue. Keys are stable identifiers stored in `role_permissions`.
 * The catalogue is synchronised into the `permissions` table at startup.
 */
export const PERMISSIONS = {
  // Overview
  'dashboard.view': { module: 'Dashboard', label: 'View dashboard' },
  'dashboard.financials': { module: 'Dashboard', label: 'See profit & financial figures on dashboard' },

  // POS & sales
  'pos.access': { module: 'Sales', label: 'Use point of sale' },
  'sales.view': { module: 'Sales', label: 'View all sales' },
  'sales.view_own': { module: 'Sales', label: 'View own sales' },
  'sales.discount': { module: 'Sales', label: 'Give discounts (up to limit)' },
  'sales.discount_unlimited': { module: 'Sales', label: 'Give discounts above limit' },
  'sales.price_override': { module: 'Sales', label: 'Override selling price' },
  'sales.credit': { module: 'Sales', label: 'Sell on customer credit' },
  'sales.sell_expired': { module: 'Sales', label: 'Authorise sale of expired stock' },
  'sales.void': { module: 'Sales', label: 'Void sales' },
  'sales.reprint': { module: 'Sales', label: 'Reprint receipts' },
  'returns.manage': { module: 'Sales', label: 'Process sales returns' },
  'returns.override': { module: 'Sales', label: 'Returns outside return window' },

  // Catalogue & inventory
  'products.view': { module: 'Inventory', label: 'View products' },
  'products.manage': { module: 'Inventory', label: 'Create / edit products' },
  'products.price_change': { module: 'Inventory', label: 'Change product & batch prices' },
  'inventory.view': { module: 'Inventory', label: 'View stock & batches' },
  'stock.adjust': { module: 'Inventory', label: 'Stock adjustments & write-offs' },
  'stock.opening': { module: 'Inventory', label: 'Enter opening stock' },
  'batches.manage': { module: 'Inventory', label: 'Edit batch details / quarantine' },
  'inventory.cost_view': { module: 'Inventory', label: 'See cost prices & stock value' },

  // Purchasing
  'purchases.view': { module: 'Purchasing', label: 'View purchases' },
  'purchases.manage': { module: 'Purchasing', label: 'Create & post purchases' },
  'purchases.void': { module: 'Purchasing', label: 'Void posted purchases' },
  'suppliers.view': { module: 'Purchasing', label: 'View suppliers' },
  'suppliers.manage': { module: 'Purchasing', label: 'Create / edit suppliers' },

  // Customers & prescriptions
  'customers.view': { module: 'Customers', label: 'View customers' },
  'customers.manage': { module: 'Customers', label: 'Create / edit customers' },
  'prescriptions.view': { module: 'Customers', label: 'View prescriptions' },
  'prescriptions.manage': { module: 'Customers', label: 'Record prescriptions' },

  // Finance
  'expenses.view': { module: 'Finance', label: 'View expenses' },
  'expenses.manage': { module: 'Finance', label: 'Record / void expenses' },
  'payments.view': { module: 'Finance', label: 'View payments & ledgers' },
  'payments.manage': { module: 'Finance', label: 'Record supplier / customer payments' },
  'cash.operate': { module: 'Finance', label: 'Open / close own shift, cash in/out' },
  'cash.view_all': { module: 'Finance', label: 'View all shifts & cash reports' },

  // Reports
  'reports.sales': { module: 'Reports', label: 'Sales reports' },
  'reports.inventory': { module: 'Reports', label: 'Inventory reports' },
  'reports.purchases': { module: 'Reports', label: 'Purchase reports' },
  'reports.financial': { module: 'Reports', label: 'Financial reports (profit, cash, balances)' },

  // Administration
  'users.manage': { module: 'Administration', label: 'Manage users' },
  'roles.manage': { module: 'Administration', label: 'Manage roles & permissions' },
  'settings.manage': { module: 'Administration', label: 'Change settings' },
  'backup.manage': { module: 'Administration', label: 'Backup & restore database' },
  'audit.view': { module: 'Administration', label: 'View audit log' },
} as const satisfies Record<string, { module: string; label: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const PERMISSION_MODULES = Array.from(new Set(Object.values(PERMISSIONS).map((p) => p.module)));

export interface DefaultRole {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[] | 'ALL';
}

export const ADMIN_ROLE_NAME = 'Administrator';

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: ADMIN_ROLE_NAME,
    description: 'Owner / administrator — full access',
    isSystem: true,
    permissions: 'ALL',
  },
  {
    name: 'Pharmacist',
    description: 'Dispensing, stock, prescriptions and operational reports',
    isSystem: false,
    permissions: [
      'dashboard.view',
      'pos.access',
      'sales.view',
      'sales.view_own',
      'sales.discount',
      'sales.credit',
      'sales.sell_expired',
      'sales.reprint',
      'returns.manage',
      'products.view',
      'products.manage',
      'inventory.view',
      'stock.adjust',
      'batches.manage',
      'purchases.view',
      'suppliers.view',
      'customers.view',
      'customers.manage',
      'prescriptions.view',
      'prescriptions.manage',
      'cash.operate',
      'reports.sales',
      'reports.inventory',
    ],
  },
  {
    name: 'Cashier',
    description: 'Point of sale and customer service',
    isSystem: false,
    permissions: [
      'pos.access',
      'sales.view_own',
      'sales.discount',
      'sales.reprint',
      'products.view',
      'inventory.view',
      'customers.view',
      'customers.manage',
      'cash.operate',
    ],
  },
  {
    name: 'Inventory Staff',
    description: 'Products, stock, purchasing and suppliers',
    isSystem: false,
    permissions: [
      'dashboard.view',
      'products.view',
      'products.manage',
      'products.price_change',
      'inventory.view',
      'inventory.cost_view',
      'stock.adjust',
      'stock.opening',
      'batches.manage',
      'purchases.view',
      'purchases.manage',
      'suppliers.view',
      'suppliers.manage',
      'reports.inventory',
      'reports.purchases',
    ],
  },
  {
    name: 'Accountant',
    description: 'Expenses, payments, cash and financial reporting',
    isSystem: false,
    permissions: [
      'dashboard.view',
      'dashboard.financials',
      'sales.view',
      'purchases.view',
      'suppliers.view',
      'customers.view',
      'inventory.cost_view',
      'expenses.view',
      'expenses.manage',
      'payments.view',
      'payments.manage',
      'cash.view_all',
      'reports.sales',
      'reports.purchases',
      'reports.financial',
      'reports.inventory',
      'audit.view',
    ],
  },
];

export function hasPermission(granted: ReadonlySet<string> | readonly string[], key: PermissionKey): boolean {
  return Array.isArray(granted) ? granted.includes(key) : (granted as ReadonlySet<string>).has(key);
}
