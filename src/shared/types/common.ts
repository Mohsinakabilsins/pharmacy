export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Option {
  id: number;
  name: string;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET';
export type SalePaymentMethod = PaymentMethod | 'CREDIT';
export type PartyPaymentMethod = PaymentMethod | 'CHEQUE';
export type RefundMethod = PaymentMethod | 'CUSTOMER_ACCOUNT';

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  MOBILE_WALLET: 'Mobile wallet',
  CREDIT: 'Customer credit',
  CHEQUE: 'Cheque',
  CUSTOMER_ACCOUNT: 'Customer account',
};
