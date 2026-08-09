"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, TableSnapshot } from "@5lapnow/shared-types";
import type { PlayerAction } from "@5lapnow/game-engine";
import { api } from "./api";
import { loadSession } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useTableSocket(tableId: string | null) {
  const socketRef = useRef<AppSocket | null>(null);
  const healRef = useRef<() => void>(() => {});
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!tableId) return; // wait until session is confirmed before connecting
    const socket: AppSocket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket"],
      // Re-evaluated on every (re)connection attempt — not a static object —
      // so a heal() that mints a fresh session mid-connection is picked up
      // immediately, without needing to recreate the socket.
      auth: (cb) => cb({ token: loadSession()?.userId }),
    });
    socketRef.current = socket;
    let healing = false;

    // The gateway's connection middleware rejects the handshake if the
    // guest-session cookie doesn't resolve to a real user. Page load
    // guarantees a valid cookie before ever connecting (see page.tsx's
    // bootstrap), but socket.io's own auto-reconnect (after a server
    // restart, sleep/wake, etc.) replays the handshake directly, skipping
    // that bootstrap — so a cookie that went stale in the meantime (DB
    // reset, cookies cleared) gets stuck retrying the same failure forever
    // with no recovery. Minting a fresh guest session and reconnecting fixes
    // that without requiring a full page reload. Also exposed as `retry` so
    // the UI can offer a manual retry button if the automatic heal fails too
    // (e.g. the server itself is unreachable).
    const heal = () => {
      if (healing) return;
      healing = true;
      void api
        .createGuestSession({})
        .then(() => socket.connect())
        .catch(() => {
          /* leave the error displayed; the user (or the next auto-reconnect) can retry */
        })
        .finally(() => {
          healing = false;
        });
    };
    healRef.current = heal;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      setIsAuthError(false);
      socket.emit("table:join", { tableId });
    });
    socket.on("connect_error", (err) => {
      setError(err.message);
      const authError = err.message.includes("No valid guest session");
      setIsAuthError(authError);
      if (authError) heal();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("table:snapshot", (snap) => setSnapshot(snap));
    socket.on("action:error", (payload) => setError(payload.message));

    return () => {
      socket.emit("table:leave", { tableId });
      socket.disconnect();
    };
  }, [tableId]);

  const retry = () => healRef.current();

  const requestSeat = (seatIndex: number, buyIn: number, displayName: string) =>
    tableId && socketRef.current?.emit("seat:request", { tableId, seatIndex, buyIn, displayName });
  const approveRequest = (requestId: string, buyIn: number) =>
    tableId && socketRef.current?.emit("seat:approve", { tableId, requestId, buyIn });
  const rejectRequest = (requestId: string) => tableId && socketRef.current?.emit("seat:reject", { tableId, requestId });
  const cancelRequest = (requestId: string) => tableId && socketRef.current?.emit("seat:cancelRequest", { tableId, requestId });
  const adjustStack = (seatIndex: number, mode: "add" | "remove" | "set", amount: number) =>
    tableId && socketRef.current?.emit("seat:adjustStack", { tableId, seatIndex, mode, amount });
  const removePlayer = (seatIndex: number) => tableId && socketRef.current?.emit("seat:remove", { tableId, seatIndex });
  const setSeatAway = (seatIndex: number, away: boolean) =>
    tableId && socketRef.current?.emit("seat:setAway", { tableId, seatIndex, away });
  const transferOwnership = (seatIndex: number) => tableId && socketRef.current?.emit("table:transferOwnership", { tableId, seatIndex });
  const stand = () => tableId && socketRef.current?.emit("seat:stand", { tableId });
  const startHand = () => tableId && socketRef.current?.emit("table:startHand", { tableId });
  const setNextGame = (gameDefinitionId: string) =>
    tableId && socketRef.current?.emit("table:setNextGame", { tableId, gameDefinitionId });
  const sendAction = (action: PlayerAction) => tableId && socketRef.current?.emit("hand:action", { tableId, action });
  const revealRabbit = () => tableId && socketRef.current?.emit("hand:revealRabbit", { tableId });
  const showCards = () => tableId && socketRef.current?.emit("hand:showCards", { tableId });
  const clangPlay = (rank: number) => tableId && socketRef.current?.emit("clang:play", { tableId, rank });
  const clangEat = () => tableId && socketRef.current?.emit("clang:eat", { tableId });
  const clangPassEat = () => tableId && socketRef.current?.emit("clang:passEat", { tableId });
  const clangCallClang = () => tableId && socketRef.current?.emit("clang:callClang", { tableId });
  const clangCallClangInstant = () => tableId && socketRef.current?.emit("clang:callClangInstant", { tableId });
  const cardFlipDraw = (pileIndex: number) => tableId && socketRef.current?.emit("cardflip:draw", { tableId, pileIndex });

  return {
    snapshot,
    error,
    isAuthError,
    retry,
    connected,
    requestSeat,
    approveRequest,
    rejectRequest,
    cancelRequest,
    adjustStack,
    removePlayer,
    setSeatAway,
    transferOwnership,
    stand,
    startHand,
    setNextGame,
    sendAction,
    revealRabbit,
    showCards,
    clangPlay,
    clangEat,
    clangPassEat,
    clangCallClang,
    clangCallClangInstant,
    cardFlipDraw,
  };
}
