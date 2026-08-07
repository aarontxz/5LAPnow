"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

const movingMap: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  RIGHT: "radial-gradient(16.2% 41.199999999999996% at 100% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
};

/**
 * Aceternity UI's "Hover Border Gradient" button, adapted from
 * https://ui.aceternity.com/components/hover-border-gradient.
 */
export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  duration = 1,
  ...props
}: React.PropsWithChildren<{
  as?: React.ElementType;
  containerClassName?: string;
  className?: string;
  duration?: number;
}> &
  React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [hovered, setHovered] = useState(false);
  const [direction, setDirection] = useState<Direction>("TOP");

  const rotateDirection = (curr: Direction): Direction => {
    const order: Direction[] = ["TOP", "LEFT", "BOTTOM", "RIGHT"];
    const idx = order.indexOf(curr);
    return order[(idx + 1) % order.length] as Direction;
  };

  useEffect(() => {
    if (hovered) return;
    const interval = setInterval(() => setDirection((prev) => rotateDirection(prev)), duration * 1000);
    return () => clearInterval(interval);
  }, [hovered, duration]);

  return (
    <Tag
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full border border-white/20 bg-black/20 px-6 py-2.5 text-sm font-medium text-white transition duration-500",
        containerClassName
      )}
      {...props}
    >
      <div className={cn("z-10", className)}>{children}</div>
      <motion.div
        className="absolute inset-0 z-0 flex-none overflow-hidden rounded-[inherit]"
        style={{ filter: "blur(2px)" }}
        initial={{ background: movingMap[direction] }}
        animate={{ background: movingMap[direction] }}
        transition={{ ease: "linear", duration }}
      />
      <div className="absolute inset-[2px] z-[1] rounded-[inherit] bg-black" />
    </Tag>
  );
}
