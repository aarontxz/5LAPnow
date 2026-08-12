"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** Renders Google's own "Sign in with Google" button via Google Identity Services — loads the GIS script on demand (no npm dependency), then hands the resulting ID token to `onCredential` for the server to verify. */
export function GoogleSignInButton({ onCredential }: { onCredential: (idToken: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref so the GIS callback (registered once, on mount) always calls the latest handler
  // without needing to re-run script loading/button rendering on every parent re-render.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      // eslint-disable-next-line no-console
      console.warn("[GoogleSignInButton] NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset in this running process — restart `pnpm dev` after editing .env.local, a hot-reload won't pick it up.");
      return;
    }

    function render() {
      if (!window.google || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: clientId!,
        callback: (response) => onCredentialRef.current(response.credential),
      });
      window.google.accounts.id.renderButton(containerRef.current, { theme: "filled_black", size: "medium", text: "signin_with", shape: "pill" });
      // eslint-disable-next-line no-console
      console.log("[GoogleSignInButton] rendered");
    }

    function onLoadError() {
      // eslint-disable-next-line no-console
      console.error("[GoogleSignInButton] Failed to load", GIS_SCRIPT_SRC, "— likely blocked by an ad blocker/privacy extension, or a network/firewall issue.");
    }

    if (window.google) {
      render();
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render, { once: true });
    script.addEventListener("error", onLoadError, { once: true });
    return () => {
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", onLoadError);
    };
  }, []);

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;

  return <div ref={containerRef} />;
}
