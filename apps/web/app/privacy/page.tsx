import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Gambonow",
  description: "How Gambonow collects, uses, and stores your data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/40">Last updated September 22, 2026</p>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="text-lg font-medium">What we collect</h2>
        <p className="text-sm text-white/70">
          Visiting Gambonow automatically creates a guest account tied to an httpOnly cookie in your
          browser — no sign-up is required. If you choose to link a Google account, we store your
          Google account ID and email address so you can host tables and request custom games. If you
          set a display name, it&apos;s stored against your account and shown to other players at your table.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="text-lg font-medium">Gameplay data</h2>
        <p className="text-sm text-white/70">
          Table and hand history — seats, stacks, actions, and results — is stored so you can review
          past hands and so tables survive server restarts. Live hole cards are only ever shown to the
          player holding them, or to everyone once a hand completes.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="text-lg font-medium">What we don&apos;t do</h2>
        <p className="text-sm text-white/70">
          We don&apos;t sell your data or share it with third parties for advertising. Your Google
          credential is used only to verify your identity — we don&apos;t read your contacts, files, or
          other Google account data.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-6">
        <h2 className="text-lg font-medium">Contact</h2>
        <p className="text-sm text-white/70">
          Questions about this policy or your data? Reach out to us directly and we&apos;ll help.
        </p>
      </section>
    </main>
  );
}
