// Copyright 2025 the AAI authors. MIT license.
import type { ComponentChildren, JSX } from "preact";
import { cva } from "class-variance-authority";
import { cn } from "./cn.ts";

/** @internal */
const badgeVariants = cva(
  "inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize transition-colors focus:outline-none focus:ring-2 focus:ring-aai-primary focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-aai-surface text-aai-text-muted shadow",
        secondary:
          "border-transparent bg-aai-surface-light text-aai-text-muted",
        destructive: "border-transparent bg-aai-error text-aai-text shadow",
        outline: "border-aai-surface-light text-aai-text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export type BadgeProps =
  & JSX.HTMLAttributes<HTMLDivElement>
  & {
    variant?: BadgeVariant | null;
    children?: ComponentChildren;
  };

export function Badge(
  { className, variant, children, ...props }: BadgeProps,
): JSX.Element {
  return (
    <div
      className={cn(badgeVariants({ variant }), className as string)}
      {...props}
    >
      {children}
    </div>
  );
}
