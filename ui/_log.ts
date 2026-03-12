// Copyright 2025 the AAI authors. MIT license.

/**
 * Minimal log shim matching the `@std/log` surface used by `@aai/ui`.
 * Uses `console` under the hood so the package has no Deno-specific
 * dependencies and works in browsers, Node, and Bun.
 */

// deno-lint-ignore no-console
export const debug = console.debug;
// deno-lint-ignore no-console
export const info = console.info;
// deno-lint-ignore no-console
export const warn = console.warn;
// deno-lint-ignore no-console
export const error = console.error;
