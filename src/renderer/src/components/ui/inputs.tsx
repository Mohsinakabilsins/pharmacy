import { forwardRef, useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, Search, X } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { inputToPaisa, paisaToInput } from '@renderer/lib/money-input';
import { parseExpiryInput, isIsoDate } from '@shared/dates';
import { formatDate } from '@shared/format';
import { Input, inputBase } from './input';
import { useFieldId } from './field';

/** Money field that edits rupees and emits paisa. */
export const MoneyInput = forwardRef<
  HTMLInputElement,
  { value: number | null | undefined; onChange: (paisa: number | null) => void; symbol?: string; decimals?: number; placeholder?: string; className?: string; invalid?: boolean; disabled?: boolean; size?: 'sm' | 'md' | 'lg' | 'xl'; autoFocus?: boolean; id?: string; onEnter?: () => void }
>(({ value, onChange, symbol = 'Rs', decimals = 2, placeholder = '0', className, invalid, disabled, size = 'md', autoFocus, id, onEnter }, ref) => {
  const fieldId = useFieldId(id);
  const [text, setText] = useState(paisaToInput(value, decimals));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(paisaToInput(value, decimals));
  }, [value, decimals, focused]);
  return (
    <div className={cn('relative flex items-center', className)}>
      <span className={cn('pointer-events-none absolute start-3 font-medium text-muted-foreground', size === 'xl' ? 'text-base' : 'text-[12.5px]')}>{symbol}</span>
      <input
        ref={ref}
        id={fieldId}
        autoFocus={autoFocus}
        disabled={disabled}
        inputMode="decimal"
        aria-invalid={invalid || undefined}
        className={cn(inputBase, 'num text-end', { sm: 'h-8', md: 'h-9', lg: 'h-11 text-[15px]', xl: 'h-14 text-2xl font-semibold' }[size], size === 'xl' ? 'ps-12 pe-4' : 'ps-10 pe-3')}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          setText(paisaToInput(value, decimals));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          onChange(inputToPaisa(t));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';

/** Integer input with optional suffix. */
export const NumberInput = forwardRef<
  HTMLInputElement,
  { value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; suffix?: ReactNode; className?: string; invalid?: boolean; placeholder?: string; size?: 'sm' | 'md' | 'lg'; allowDecimal?: boolean; disabled?: boolean; id?: string; autoFocus?: boolean; onEnter?: () => void }
>(({ value, onChange, min, max, suffix, className, invalid, placeholder, size = 'md', allowDecimal, disabled, id, autoFocus, onEnter }, ref) => {
  const fieldId = useFieldId(id);
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null || value === undefined ? '' : String(value));
  }, [value, focused]);
  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        ref={ref}
        id={fieldId}
        autoFocus={autoFocus}
        disabled={disabled}
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        className={cn(inputBase, 'num text-end', { sm: 'h-8', md: 'h-9', lg: 'h-11 text-[15px]' }[size], suffix ? 'pe-14 ps-3' : 'px-3')}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const t = e.target.value.replace(allowDecimal ? /[^\d.]/g : /[^\d]/g, '');
          setText(t);
          if (t === '') return onChange(null);
          let n = Number(t);
          if (Number.isNaN(n)) return;
          if (max !== undefined) n = Math.min(max, n);
          if (min !== undefined) n = Math.max(min, n);
          onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute end-3 text-[12px] text-muted-foreground">{suffix}</span>}
    </div>
  );
});
NumberInput.displayName = 'NumberInput';

/** Date field (native picker, styled). */
export function DateInput({ value, onChange, className, invalid, max, min, size = 'md', id }: { value: string | null | undefined; onChange: (v: string | null) => void; className?: string; invalid?: boolean; max?: string; min?: string; size?: 'sm' | 'md'; id?: string }) {
  const fieldId = useFieldId(id);
  return (
    <div className={cn('relative flex items-center', className)}>
      <CalendarDays className="pointer-events-none absolute start-3 size-4 text-muted-foreground" />
      <input
        id={fieldId}
        type="date"
        max={max}
        min={min}
        aria-invalid={invalid || undefined}
        className={cn(inputBase, size === 'sm' ? 'h-8' : 'h-9', 'num ps-9 pe-2 [&::-webkit-calendar-picker-indicator]:opacity-60')}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}

/** Expiry field accepting MM/YYYY (as printed on packs) or a full date. Emits YYYY-MM-DD. */
export function ExpiryInput({ value, onChange, invalid, className, placeholder = 'MM/YYYY', size = 'md', id }: { value: string | null | undefined; onChange: (v: string | null) => void; invalid?: boolean; className?: string; placeholder?: string; size?: 'sm' | 'md'; id?: string }) {
  const fieldId = useFieldId(id);
  const toText = (v: string | null | undefined) => (v && isIsoDate(v) ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : '');
  const [text, setText] = useState(toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(toText(value));
  }, [value, focused]);
  const parsed = parseExpiryInput(text);
  return (
    <div className={cn('relative', className)}>
      <input
        id={fieldId}
        aria-invalid={invalid || (text !== '' && !parsed) || undefined}
        className={cn(inputBase, size === 'sm' ? 'h-8' : 'h-9', 'num px-3')}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (parsed) setText(toText(parsed));
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseExpiryInput(e.target.value));
        }}
      />
      {focused && parsed && <span className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{formatDate(parsed)}</span>}
    </div>
  );
}

export const SearchInput = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; size?: 'sm' | 'md' | 'lg'; shortcut?: string }>(
  ({ value, onChange, placeholder = 'Search…', className, autoFocus, size = 'md', shortcut }, ref) => (
    <Input
      ref={ref}
      autoFocus={autoFocus}
      inputSize={size}
      className={cn('w-72', className)}
      leading={<Search />}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation();
          onChange('');
        }
      }}
      trailing={
        value ? (
          <button type="button" onClick={() => onChange('')} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-3.5" />
          </button>
        ) : shortcut ? (
          <kbd className="me-1 rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>
        ) : undefined
      }
    />
  ),
);
SearchInput.displayName = 'SearchInput';
