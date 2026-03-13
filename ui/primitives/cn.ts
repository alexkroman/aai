// Copyright 2025 the AAI authors. MIT license.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names with Tailwind-aware deduplication. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
