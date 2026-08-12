"use client";

const STORAGE_KEY = "5lapnow_session";

export interface Session {
  userId: string;
  /** Null until the guest has requested a seat at a table for the first time. */
  displayName: string | null;
  /** True once this account has linked a Google sign-in — required to host a table or request AI game generation. */
  googleLinked: boolean;
  /** The linked Google account's email, for display — null until googleLinked. */
  email: string | null;
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
