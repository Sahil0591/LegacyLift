// WAITLIST MODE: the homepage is temporarily the waitlist landing, and
// middleware.ts redirects every other route here. To restore the full product
// landing, revert this file (and middleware.ts) - the original landing sections
// (Hero, ProductDemo, WhyDifferent, CTASection) are untouched on disk.
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { WaitlistLanding } from "@/components/waitlist/WaitlistLanding";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <WaitlistLanding />
      </div>
    </div>
  );
}
