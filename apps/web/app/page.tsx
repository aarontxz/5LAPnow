"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GameDefinition } from "@5lapnow/game-engine";
import { validateGameGenerationPrompt, type GameGenerationRequestView } from "@5lapnow/shared-types";
import { api } from "@/lib/api";
import { clearSession, saveSession, type Session } from "@/lib/session";
import { HoverBorderGradient } from "@/components/aceternity/hover-border-gradient";
import { GameSelect } from "@/components/table/GameSelect";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

/** Sells Premium/game-request/promotion tiers — see PREMIUM_PRICING.md for the full offer text. */
const PREMIUM_FORM_URL = "https://forms.gle/bbYYd8v6RXEHaaaFA";

function extractErrorMessage(err: unknown): string {
  const raw = (err as Error).message ?? "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart === -1) return raw;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) return parsed.message.join(" ");
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON, fall through to the raw text
  }
  return raw;
}

const GENERATION_STATUS_LABEL: Record<GameGenerationRequestView["status"], string> = {
  pending: "Generating…",
  ready: "Ready",
  rejected: "Not built",
};

const GENERATION_STATUS_CLASS: Record<GameGenerationRequestView["status"], string> = {
  pending: "text-amber-400",
  ready: "text-emerald-400",
  rejected: "text-red-400",
};

interface GameOption {
  id: string;
  name: string;
  description: string;
  source: string;
  engine: "poker" | "clang" | "cardflip";
  definition: GameDefinition | null;
  /** True if this game needs a premium unlock the current account doesn't have — shown, not hidden, with a paywall badge. */
  locked: boolean;
}

export default function LobbyPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [games, setGames] = useState<GameOption[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [genPrompt, setGenPrompt] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);
  const [genSubmitting, setGenSubmitting] = useState(false);
  const [genRequests, setGenRequests] = useState<GameGenerationRequestView[]>([]);

  // Always verify the cookie is alive; create a new session if it isn't.
  useEffect(() => {
    void api.me().then((me) => {
      if (me) {
        saveSession(me);
        setSession(me);
      } else {
        void api.createGuestSession({}).then((s) => {
          saveSession(s);
          setSession(s);
        });
      }
    });
  }, []);

  async function refresh(userId?: string) {
    const gamesRes = await api.listGames(userId);
    setGames(gamesRes);
    setSelectedGameId((prev) => prev || gamesRes.find((g) => !g.locked)?.id || gamesRes[0]?.id || "");
  }

  useEffect(() => {
    if (!session) return;
    void refresh(session.userId);
    void api.listGameGenerationRequests().then(setGenRequests);
  }, [session]);

  async function submitGeneration() {
    setGenError(null);
    setGenSuccess(null);
    const validation = validateGameGenerationPrompt(genPrompt);
    if (!validation.ok) {
      setGenError(validation.message);
      return;
    }
    setGenSubmitting(true);
    try {
      const created = await api.requestGameGeneration({ prompt: genPrompt });
      setGenRequests((prev) => [created, ...prev]);
      setGenPrompt("");
      setGenSuccess("Request submitted — this can take a while, we'll add it to your Game list once it's ready.");
    } catch (err) {
      setGenError(extractErrorMessage(err));
    } finally {
      setGenSubmitting(false);
    }
  }

  async function handleGoogleCredential(idToken: string) {
    try {
      const updated = await api.signInWithGoogle({ idToken });
      saveSession(updated);
      setSession(updated);
      void refresh(updated.userId);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }

  async function handleSignOut() {
    await api.logout().catch(() => {});
    clearSession();
    setSelectedGameId("");
    const fresh = await api.createGuestSession({});
    saveSession(fresh);
    setSession(fresh);
    void refresh(fresh.userId);
  }

  async function createTable() {
    const game = games.find((g) => g.id === selectedGameId);
    if (!game) {
      setError("Pick a game first");
      return;
    }
    if (game.locked) {
      setError(`"${game.name}" needs premium access — reach out to unlock it.`);
      return;
    }
    try {
      const table = await api.createTable({
        gameDefinitionId: game.id,
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 100,
        maxBuyIn: 500,
      });
      router.push(`/table/${table.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!session) return null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-12">
      <section className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:p-6">
        {session.googleLinked ? (
          <p className="text-sm text-white/60">
            Signed in as <span className="text-white">{session.email}</span>
          </p>
        ) : (
          <p className="text-sm text-white/60">Sign in with Google to host a table or generate a custom game.</p>
        )}
        <div className="flex items-center gap-4">
          <a
            href={PREMIUM_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-amber-300 hover:text-amber-200"
          >
            ⭐ Get Premium
          </a>
          {session.googleLinked ? (
            <button onClick={handleSignOut} className="text-sm text-white/40 hover:text-white/70">
              Sign out
            </button>
          ) : (
            <GoogleSignInButton onCredential={handleGoogleCredential} />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-medium">Create a table</h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-white/50">Game</label>
            <GameSelect
              games={games}
              value={selectedGameId}
              onChange={setSelectedGameId}
            />
          </div>
          <HoverBorderGradient
            onClick={createTable}
            disabled={!session.googleLinked}
            className="w-full sm:w-auto"
            containerClassName={`w-full sm:w-auto ${!session.googleLinked ? "opacity-40" : ""}`}
          >
            Create table
          </HoverBorderGradient>
        </div>
        {!session.googleLinked && <p className="mt-3 text-sm text-white/40">Sign in with Google above to host a table.</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="mb-1 text-lg font-medium">✨ Generate a custom game with AI</h2>
        <p className="mb-4 text-sm text-white/50">
          Describe the rules you want and our AI will build a playable variant for you. Once the game is generated, it will appear in your Game list and you can create a table with it. You will need to pay a fee of $5 a month to keep the generated game in your list after the first 7 days.
        </p>
        <label className="mb-1 block text-xs text-white/50">Describe your game&apos;s rules</label>
        <textarea
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. Texas Hold'em, but every player gets 3 hole cards and the lowest hand also wins half the pot..."
          className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2.5 text-base text-white"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <HoverBorderGradient
            onClick={submitGeneration}
            disabled={genSubmitting || !session.googleLinked}
            className="w-full sm:w-auto"
            containerClassName={`w-full sm:w-auto ${!session.googleLinked ? "opacity-40" : ""}`}
          >
            {genSubmitting ? "Submitting…" : "Generate game"}
          </HoverBorderGradient>
          {!session.googleLinked && <p className="text-sm text-white/40">Sign in with Google above to generate a game.</p>}
        </div>
        {genError && <p className="mt-3 text-sm text-red-400">{genError}</p>}
        {genSuccess && <p className="mt-3 text-sm text-emerald-400">{genSuccess}</p>}

        {genRequests.length > 0 && (
          <ul className="mt-5 divide-y divide-white/10 border-t border-white/10">
            {genRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-white/70">{r.prompt}</span>
                <span className={`shrink-0 text-xs font-medium ${GENERATION_STATUS_CLASS[r.status]}`}>
                  {GENERATION_STATUS_LABEL[r.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
