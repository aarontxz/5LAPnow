"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, TableSnapshot } from "@5lapnow/shared-types";
import type { PlayerAction } from "@5lapnow/game-engine";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useTableSocket(tableId: string | null) {
  const socketRef = useRef<AppSocket | null>(null);
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!tableId) return; // wait until session is confirmed before connecting
    const socket: AppSocket = io(API_URL, { withCredentials: true, transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("table:join", { tableId });
    });
    socket.on("connect_error", (err) => setError(err.message));
    socket.on("disconnect", () => setConnected(false));
    socket.on("table:snapshot", (snap) => setSnapshot(snap));
    socket.on("action:error", (payload) => setError(payload.message));

    return () => {
      socket.emit("table:leave", { tableId });
      socket.disconnect();
    };
  }, [tableId]);

  const requestSeat = (seatIndex: number, buyIn: number, displayName: string) =>
    socketRef.current?.emit("seat:request", { tableId, seatIndex, buyIn, displayName });
  const approveRequest = (requestId: string, buyIn: number) => socketRef.current?.emit("seat:approve", { tableId, requestId, buyIn });
  const rejectRequest = (requestId: string) => socketRef.current?.emit("seat:reject", { tableId, requestId });
  const cancelRequest = (requestId: string) => socketRef.current?.emit("seat:cancelRequest", { tableId, requestId });
  const adjustStack = (seatIndex: number, newStack: number) => socketRef.current?.emit("seat:adjustStack", { tableId, seatIndex, newStack });
  const removePlayer = (seatIndex: number) => socketRef.current?.emit("seat:remove", { tableId, seatIndex });
  const setSeatAway = (seatIndex: number, away: boolean) => socketRef.current?.emit("seat:setAway", { tableId, seatIndex, away });
  const transferOwnership = (seatIndex: number) => socketRef.current?.emit("table:transferOwnership", { tableId, seatIndex });
  const stand = () => socketRef.current?.emit("seat:stand", { tableId });
  const startHand = () => socketRef.current?.emit("table:startHand", { tableId });
  const setNextGame = (gameDefinitionId: string) => socketRef.current?.emit("table:setNextGame", { tableId, gameDefinitionId });
  const sendAction = (action: PlayerAction) => socketRef.current?.emit("hand:action", { tableId, action });
  const revealRabbit = () => socketRef.current?.emit("hand:revealRabbit", { tableId });
  const clangPlay = (rank: number) => socketRef.current?.emit("clang:play", { tableId, rank });
  const clangEat = () => socketRef.current?.emit("clang:eat", { tableId });
  const clangPassEat = () => socketRef.current?.emit("clang:passEat", { tableId });
  const clangCallClang = () => socketRef.current?.emit("clang:callClang", { tableId });
  const clangCallClangInstant = () => socketRef.current?.emit("clang:callClangInstant", { tableId });

  return {
    snapshot,
    error,
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
    clangPlay,
    clangEat,
    clangPassEat,
    clangCallClang,
    clangCallClangInstant,
  };
}
