export const GUEST_COOKIE_NAME = "5lapnow_uid";

/** Minimal cookie-header parser for contexts without Express's cookie-parser (e.g. the Socket.IO handshake). */
export function parseCookieHeader(header?: string): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}
