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
