export const GUEST_COOKIE_NAME = "5lapnow_uid";

/**
 * Guest identity is a bearer token (the guest's own user id — same trust
 * model the cookie already had: an unsigned id, just now sendable as a
 * header/socket auth payload instead of a cookie) checked ahead of the
 * cookie everywhere auth is read. This is the primary path — some browsers
 * (Safari ITP, Firefox strict tracking protection, Brave) block third-party
 * cookies by default, which breaks the cookie entirely whenever the web app
 * and API are on different origins. The cookie stays as a same-origin-only
 * fallback for local dev convenience.
 */
export function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

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
