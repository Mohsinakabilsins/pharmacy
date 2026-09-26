import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/cn';
import { useFieldId } from './field';

export const inputBase =
  'w-full rounded-lg border border-input bg-card text-[13.5px] text-foreground shadow-xs outline-none transition-[border,box-shadow] placeholder:text-muted-foreground/70 hover:border-border-strong focus:border-ring focus:ring-[3px] focus:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  inputSize?: 'sm' | 'md' | 'lg' | 'xl';
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leading, trailing, inputSize = 'md', invalid, id, ...props }, ref) => {
  const fieldId = useFieldId(id);
  const h = { sm: 'h-8', md: 'h-9', lg: 'h-11 text-[15px]', xl: 'h-14 text-lg' }[inputSize];
  if (!leading && !trailing) {
    return <input ref={ref} id={fieldId} aria-invalid={invalid || undefined} className={cn(inputBase, h, 'px-3', className)} {...props} />;
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute start-3 flex items-center text-muted-foreground [&_svg]:size-4">{leading}</span>}
      <input ref={ref} id={fieldId} aria-invalid={invalid || undefined} className={cn(inputBase, h, leading ? 'ps-9' : 'ps-3', trailing ? 'pe-10' : 'pe-3')} {...props} />
      {trailing && <span className="absolute end-2 flex items-center text-muted-foreground">{trailing}</span>}
    </div>
  );
});
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(({ className, invalid, id, ...props }, ref) => (
  <textarea ref={ref} id={useFieldId(id)} aria-invalid={invalid || undefined} className={cn(inputBase, 'min-h-[76px] resize-y px-3 py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';
