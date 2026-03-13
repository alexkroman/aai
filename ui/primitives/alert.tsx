// Copyright 2025 the AAI authors. MIT license.
import type { ComponentChildren, JSX } from "preact";
import { cva } from "class-variance-authority";
import { cn } from "./cn.ts";

/** @internal */
const alertVariants = cva(
  "relative w-full rounded-aai border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-aai-text [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-aai-surface text-aai-text border-aai-surface-light",
        destructive:
          "border-aai-error/50 text-aai-error [&>svg]:text-aai-error",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertVariant = "default" | "destructive";

export type AlertProps =
  & JSX.HTMLAttributes<HTMLDivElement>
  & {
    variant?: AlertVariant | null;
    children?: ComponentChildren;
  };

export function Alert(
  { className, variant, children, ...props }: AlertProps,
): JSX.Element {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className as string)}
      {...props}
    >
      {children}
    </div>
  );
}

export function AlertTitle(
  { className, children, ...props }:
    & JSX.HTMLAttributes<HTMLHeadingElement>
    & { children?: ComponentChildren },
): JSX.Element {
  return (
    <h5
      className={cn(
        "mb-1 font-medium leading-none tracking-tight",
        className as string,
      )}
      {...props}
    >
      {children}
    </h5>
  );
}

export function AlertDescription(
  { className, children, ...props }:
    & JSX.HTMLAttributes<HTMLParagraphElement>
    & { children?: ComponentChildren },
): JSX.Element {
  return (
    <div
      className={cn("text-sm [&_p]:leading-relaxed", className as string)}
      {...props}
    >
      {children}
    </div>
  );
}
