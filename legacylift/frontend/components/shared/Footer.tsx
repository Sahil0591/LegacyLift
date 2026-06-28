// Footer — Minimal dark footer shown on landing and demo pages.
// TODO: Add links to docs, GitHub repo, and hackathon track info.

export function Footer() {
  return (
    <footer className="border-t border-[#222222] bg-[#0a0a0a] py-8">
      <div className="mx-auto max-w-screen-2xl px-6 flex flex-col items-center gap-2 text-center text-sm text-[#888888]">
        <p>
          <span className="text-white font-medium">LegacyLift</span>
          {" — "}Built for the{" "}
          <span className="text-[#2563EB]">Conduct AI Hackathon 2026</span>
        </p>
        <p>Legacy code. Finally understood.</p>
      </div>
    </footer>
  );
}
