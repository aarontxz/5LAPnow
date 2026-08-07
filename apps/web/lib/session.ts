"use client";

const STORAGE_KEY = "5lapnow_session";

export interface Session {
  userId: string;
  /** Null until the guest has requested a seat at a table for the first time. */
  displayName: string | null;
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
