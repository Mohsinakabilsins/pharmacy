import { createContext, useContext, useId, type ReactNode } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';
import { cn } from '@renderer/lib/cn';

const FieldIdContext = createContext<string | undefined>(undefined);
/** Id of the enclosing <Field>, so its <label> is associated with the control. */
export function useFieldId(explicit?: string) {
  const ctx = useContext(FieldIdContext);
  return explicit ?? ctx;
}

export function Label({ className, ...props }: LabelPrimitive.LabelProps) {
  return <LabelPrimitive.Root className={cn('text-[12.5px] font-medium text-foreground/85', className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
  aside,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  return (
    <FieldIdContext.Provider value={id}>
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={id}>
              {label}
              {required && <span className="ms-0.5 text-danger">*</span>}
            </Label>
          )}
          {aside}
        </div>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-[12px] text-danger">
          <AlertCircle className="size-3.5" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
    </FieldIdContext.Provider>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-4', className)}>
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
