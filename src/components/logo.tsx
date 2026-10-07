import { cn } from "@/lib/cn";

/**
 * Original monogram mark — a rounded square holding a speech bubble with a
 * spark, for "posts written automatically". Deliberately not a recolour or
 * trace of Facebook's own logo or wordmark.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="fap-brand-gradient" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1877F2" />
          <stop offset="1" stopColor="#0866FF" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#fap-brand-gradient)" />
      {/* Speech bubble / post container */}
      <path
        d="M11.5 14.5A3 3 0 0 1 14.5 11.5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H19.8l-4.8 4v-4h-.5a3 3 0 0 1-3-3v-8Z"
        fill="#ffffff"
        fillOpacity="0.98"
      />
      {/* Dynamic post auto-spark / send indicator */}
      <path
        d="m20 14.5 1.3 2.9 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3L20 14.5Z"
        fill="#1877F2"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-heading text-lg font-bold tracking-tight text-foreground">
        Facebook Auto Post
      </span>
    </div>
  );
}
