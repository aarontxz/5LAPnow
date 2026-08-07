import type {
  CreateGameGenerationRequestBody,
  CreateGuestSessionRequest,
  CreateGuestSessionResponse,
  CreateTableRequest,
  GameGenerationRequestView,
  TableLedgerResponse,
  TableSnapshot,
  TableSummary,
} from "@5lapnow/shared-types";
import type { GameDefinition } from "@5lapnow/game-engine";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
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
  listGames: (userId?: string) => request<Array<{ id: string; name: string; description: string; source: string; definition: GameDefinition }>>(
    `/games${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`
  ),
  createTable: (body: CreateTableRequest) => request<TableSummary>("/tables", { method: "POST", body: JSON.stringify(body) }),
  requestGameGeneration: (body: CreateGameGenerationRequestBody) =>
    request<GameGenerationRequestView>("/games/generate", { method: "POST", body: JSON.stringify(body) }),
  listGameGenerationRequests: () => request<GameGenerationRequestView[]>("/games/generate-requests"),
  getTableSnapshot: (id: string, viewerUserId?: string) =>
    request<TableSnapshot>(`/tables/${id}${viewerUserId ? `?viewerUserId=${encodeURIComponent(viewerUserId)}` : ""}`),
  getLedger: (id: string) => request<TableLedgerResponse>(`/tables/${id}/ledger`),
};
