import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Display form of `strategies.version`: always one leading "v". Rows store both
 * "1.0.0" and "v1.0", so prefixing blindly rendered "vv1.0".
 */
export function formatVersion(version: string | null | undefined): string {
  const v = (version ?? "").trim();
  if (!v) return "";
  return /^v/i.test(v) ? `v${v.slice(1)}` : `v${v}`;
}
