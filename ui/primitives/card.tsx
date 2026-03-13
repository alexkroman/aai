// Copyright 2025 the AAI authors. MIT license.
import type { ComponentChildren, JSX } from "preact";
import { cn } from "./cn.ts";

export type CardProps = JSX.HTMLAttributes<HTMLDivElement> & {
  children?: ComponentChildren;
};

export function Card(
  { className, children, ...props }: CardProps,
): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-aai border border-aai-surface-light bg-aai-surface text-aai-text shadow",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader(
  { className, children, ...props }: CardProps,
): JSX.Element {
  return (
    <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle(
  { className, children, ...props }: CardProps,
): JSX.Element {
  return (
    <h3
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent(
  { className, children, ...props }: CardProps,
): JSX.Element {
  return (
    <div className={cn("p-6 pt-0", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter(
  { className, children, ...props }: CardProps,
): JSX.Element {
  return (
    <div
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    >
      {children}
    </div>
  );
}
