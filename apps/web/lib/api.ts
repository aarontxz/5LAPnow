import type {
  CardFlipRoundReplayResponse,
  ClangRoundReplayResponse,
  CreateGameGenerationRequestBody,
  CreateGuestSessionRequest,
  CreateGuestSessionResponse,
  CreateTableRequest,
  EffectiveGameConfig,
  GameGenerationRequestView,
  GoogleSignInRequest,
  HandReplayResponse,
  TableLedgerResponse,
  TableSnapshot,
  TableSummary,
} from "@5lapnow/shared-types";
import type { GameDefinition } from "@5lapnow/game-engine";
import type { Card } from "@5lapnow/cards";
import { loadSession } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Bearer token (the guest's own user id, stored client-side after
  // guest-session/me) is the primary auth path — some browsers (Safari,
  // Firefox strict mode, Brave) block the cross-origin cookie fallback by
  // default whenever the web app and API are on different origins.
  const token = loadSession()?.userId;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  createGuestSession: (body: CreateGuestSessionRequest) =>
    request<CreateGuestSessionResponse>("/auth/guest-session", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<CreateGuestSessionResponse | null>("/auth/me"),
  signInWithGoogle: (body: GoogleSignInRequest) => request<CreateGuestSessionResponse>("/auth/google", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listGames: (userId?: string) =>
    request<
      Array<{ id: string; name: string; description: string; source: string; engine: "poker" | "clang" | "cardflip"; definition: GameDefinition | null; locked: boolean }>
    >(`/games${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`),
  createTable: (body: CreateTableRequest) => request<TableSummary>("/tables", { method: "POST", body: JSON.stringify(body) }),
  requestGameGeneration: (body: CreateGameGenerationRequestBody) =>
    request<GameGenerationRequestView>("/games/generate", { method: "POST", body: JSON.stringify(body) }),
  listGameGenerationRequests: () => request<GameGenerationRequestView[]>("/games/generate-requests"),
  getTableSnapshot: (id: string) => request<TableSnapshot>(`/tables/${id}`),
  getLedger: (id: string) => request<TableLedgerResponse>(`/tables/${id}/ledger`),
  getGameConfig: (id: string) => request<EffectiveGameConfig>(`/tables/${id}/game-config`),
  getHandReplay: (tableId: string, handNumber: number) =>
    request<HandReplayResponse>(`/tables/${tableId}/hands/${handNumber}/replay`),
  replayRevealRabbit: (tableId: string, handNumber: number) =>
    request<{ rabbitBoard: Card[]; rabbitBoards: Card[][] | null }>(`/tables/${tableId}/hands/${handNumber}/replay/reveal-rabbit`, {
      method: "POST",
    }),
  getClangRoundReplay: (tableId: string, roundNumber: number) =>
    request<ClangRoundReplayResponse>(`/tables/${tableId}/clang-rounds/${roundNumber}/replay`),
  getCardFlipRoundReplay: (tableId: string, roundNumber: number) =>
    request<CardFlipRoundReplayResponse>(`/tables/${tableId}/cardflip-rounds/${roundNumber}/replay`),
};
