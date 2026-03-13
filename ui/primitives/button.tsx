// Copyright 2025 the AAI authors. MIT license.
import type { ComponentChildren, JSX } from "preact";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "./cn.ts";

/** @internal */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-aai text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aai-primary disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-aai-primary text-aai-text shadow hover:opacity-90",
        destructive: "bg-aai-error text-aai-text shadow-sm hover:opacity-90",
        outline:
          "border border-aai-surface-light bg-transparent text-aai-text-muted shadow-sm hover:bg-aai-surface",
        secondary: "bg-aai-surface text-aai-text shadow-sm hover:opacity-80",
        ghost: "text-aai-text-muted hover:bg-aai-surface",
        link: "text-aai-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-aai px-3 text-xs",
        lg: "h-11 rounded-aai px-8 text-lg font-medium",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export type ButtonProps =
  & JSX.HTMLAttributes<HTMLButtonElement>
  & {
    variant?: ButtonVariant | null;
    size?: ButtonSize | null;
    asChild?: boolean;
    children?: ComponentChildren;
  };

export function Button(
  { className, variant, size, asChild = false, children, ...props }:
    ButtonProps,
): JSX.Element {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      type="button"
      className={cn(
        buttonVariants({ variant, size }),
        className as string,
      )}
      style={{ WebkitTapHighlightColor: "transparent" }}
      {...props}
    >
      {children}
    </Comp>
  );
}
