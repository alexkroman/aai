// Copyright 2025 the AAI authors. MIT license.

/**
 * OC-2 dark theme palette for terminal output.
 * Uses 24-bit RGB color (truecolor) via `@std/fmt/colors` `rgb24`.
 * @module
 */

import { rgb24 } from "@std/fmt/colors";

/** Primary brand color — warm peach `#fab283`. */
export function primary(s: string): string {
  return rgb24(s, 0xfab283);
}

/** Interactive/info color — soft blue `#9dbefe`. */
export function interactive(s: string): string {
  return rgb24(s, 0x9dbefe);
}

/** Error color — coral red `#fc533a`. */
export function error(s: string): string {
  return rgb24(s, 0xfc533a);
}

/** Warning color — golden yellow `#fcd53a`. */
export function warning(s: string): string {
  return rgb24(s, 0xfcd53a);
}
