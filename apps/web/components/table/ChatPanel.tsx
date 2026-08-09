"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatMessageView } from "@5lapnow/shared-types";
import { cn } from "@/lib/cn";
import { Modal } from "./Modal";

const MESSAGE_MAX_LENGTH = 500;

function ChatMessages({ messages, viewerUserId, listRef }: { messages: ChatMessageView[]; viewerUserId: string | null; listRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 ? (
        <p className="text-center text-sm text-white/30">No messages yet — say hi!</p>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((m) => {
            const isMine = m.userId === viewerUserId;
            return (
              <div key={m.id} className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
                <span className="text-[10px] text-white/40">{m.displayName}</span>
                <span
                  className={cn(
                    "max-w-[85%] break-words rounded-2xl px-3 py-1.5 text-sm",
                    isMine ? "bg-purple-600 text-white" : "bg-white/10 text-white/90"
                  )}
                >
                  {m.body}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChatComposer({ onSend }: { onSend: (body: string) => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <input
        type="text"
        value={draft}
        maxLength={MESSAGE_MAX_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Message the table..."
        className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={!draft.trim()}
        className="shrink-0 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}

function ChatHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
      <h2 className="text-sm font-semibold text-white">Chat</h2>
      <button onClick={onClose} className="rounded-lg p-1 text-lg leading-none text-white/30 hover:bg-white/10 hover:text-white" aria-label="Close">
        ✕
      </button>
    </div>
  );
}

/**
 * An overlay in both presentations — never affects layout, never moves the
 * table:
 *  - Mobile: a centered card over a translucent backdrop, same presentation
 *    as LedgerModal (via the shared `Modal` component) — tap outside or the
 *    ✕ to close.
 *  - Desktop (sm+): a floating card docked bottom-left, opening upward from
 *    the Chat button's own corner — `fixed`, so it sits on top of that empty
 *    space without pushing or resizing anything.
 */
export function ChatPanel({
  open,
  onClose,
  messages,
  viewerUserId,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessageView[];
  viewerUserId: string | null;
  onSend: (body: string) => void;
}) {
  const mobileListRef = useRef<HTMLDivElement>(null);
  const desktopListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    mobileListRef.current?.scrollTo({ top: mobileListRef.current.scrollHeight });
    desktopListRef.current?.scrollTo({ top: desktopListRef.current.scrollHeight });
  }, [open, messages.length]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Mobile: full-screen, covers the table */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed inset-0 z-50 flex flex-col bg-neutral-900 sm:hidden"
          >
            <ChatHeader onClose={onClose} />
            <ChatMessages messages={messages} viewerUserId={viewerUserId} listRef={mobileListRef} />
            <ChatComposer onSend={onSend} />
          </motion.div>

          {/* Desktop: floating card docked bottom-left, opening upward from
              the Chat button's own corner — fixed, so it overlaps the empty
              space beside the felt instead of pushing anything over. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-20 left-4 z-40 hidden h-[65vh] w-72 flex-col rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl sm:flex sm:bottom-24 sm:left-6 sm:w-80"
          >
            <ChatHeader onClose={onClose} />
            <ChatMessages messages={messages} viewerUserId={viewerUserId} listRef={desktopListRef} />
            <ChatComposer onSend={onSend} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
