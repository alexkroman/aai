// Copyright 2025 the AAI authors. MIT license.
import type { ComponentChildren, JSX } from "preact";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "./cn.ts";

export type ScrollAreaProps = JSX.HTMLAttributes<HTMLDivElement> & {
  children?: ComponentChildren;
};

export function ScrollArea(
  { className, children, ...props }: ScrollAreaProps,
): JSX.Element {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar(
  { className, orientation = "vertical", ...props }:
    & ScrollAreaPrimitive.ScrollAreaScrollbarProps
    & { className?: string },
): JSX.Element {
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-aai-surface-light" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
