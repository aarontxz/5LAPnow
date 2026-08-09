"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

const SIZE_CLASS = {
  sm: "w-full max-w-xs p-5",
  md: "w-[95vw] max-w-2xl p-5 sm:p-6",
  lg: "h-[90vh] w-[95vw] max-w-6xl p-5 sm:p-6",
  // Deliberately small footprint, no padding (content manages its own) — leaves
  // most of the translucent backdrop visible so whatever's behind (the table)
  // still shows through dimmed, instead of the card blocking nearly the
  // whole screen the way `lg` does.
  chat: "h-[65vh] w-[88vw] max-w-sm p-0",
} as const;

/**
 * Renders via a portal to document.body so `position: fixed` centers on the
 * real viewport — several seat wrappers on the table use CSS transforms
 * (for the oval layout), which would otherwise hijack fixed positioning for
 * anything rendered inside them.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "sm",
  variant = "dark",
  overlayClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "chat";
  variant?: "dark" | "light";
  /** Extra classes merged onto the fixed backdrop — e.g. to hide this modal presentation at a breakpoint where a caller renders an alternative. */
  overlayClassName?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", overlayClassName)}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex flex-col rounded-2xl border shadow-2xl",
              variant === "light" ? "border-neutral-200 bg-white" : "border-white/10 bg-neutral-900",
              SIZE_CLASS[size]
            )}
          >
            {title && (
              <div className="mb-4 flex shrink-0 items-start justify-between gap-2">
                <h2 className={cn("text-base font-semibold sm:text-xl", variant === "light" ? "text-neutral-900" : "text-white")}>
                  {title}
                  {subtitle && (
                    <span className={cn("ml-2 text-xs font-medium sm:text-sm", variant === "light" ? "text-neutral-400" : "text-white/40")}>
                      {subtitle}
                    </span>
                  )}
                </h2>
                <button
                  onClick={onClose}
                  className={cn(
                    "shrink-0 rounded-lg p-1 text-lg leading-none transition-colors",
                    variant === "light" ? "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" : "text-white/30 hover:bg-white/10 hover:text-white"
                  )}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
