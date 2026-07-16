import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const BASE =
  "inline-flex items-center justify-center gap-2 font-mono text-xs font-medium uppercase tracking-wider " +
  "transition-[background-color,color,border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-1 " +
  "focus-visible:ring-offset-surface-0 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 select-none";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-text-1 text-surface-1 hover:bg-accent-ink border border-transparent",
  outline: "border border-line-strong text-text-1 hover:border-text-1 hover:bg-surface-2",
  ghost: "border border-transparent text-text-2 hover:text-text-1 hover:bg-surface-2",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5",
  md: "h-9 px-4",
};

export function Button({ variant = "outline", size = "md", className = "", children, ...rest }: Props) {
  return (
    <button {...rest} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}>
      {children}
    </button>
  );
}
