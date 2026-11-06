import { createHash } from "node:crypto";

/**
 * Deterministic conversion: WorkOS user ID → UUID format.
 * SHA-256 hash formatted as UUID with version/variant bits set.
 * Server-only (uses node:crypto).
 */
export const toStableUUID = (workosId: string): string => {
  const hex = createHash("sha256")
    .update(`workos:${workosId}`)
    .digest("hex")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
};
