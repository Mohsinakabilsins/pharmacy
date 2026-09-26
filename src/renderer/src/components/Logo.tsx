import { cn } from '@renderer/lib/cn';

/** PharmaDesk mark: a rounded tile with a stylised capsule + cross. */
export function LogoMark({ className, logo }: { className?: string; logo?: string }) {
  if (logo) return <img src={logo} alt="" className={cn('size-8 rounded-lg object-contain', className)} />;
  return (
    <div className={cn('relative flex size-8 items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-teal-500 via-teal-600 to-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(13,148,136,0.35)]', className)}>
      <svg viewBox="0 0 24 24" className="size-[60%] text-white" fill="none">
        <rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.2 15.8l7.6-7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="pointer-events-none absolute -right-2 -top-2 size-5 rounded-full bg-white/20 blur-[2px]" />
    </div>
  );
}
