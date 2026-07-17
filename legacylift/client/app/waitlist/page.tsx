// app/waitlist/page.tsx - Public waitlist landing, reachable at /waitlist.
// Not in middleware's protected-route list, so it's open to signed-out visitors.
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { WaitlistLanding } from "@/components/waitlist/WaitlistLanding";

export default function WaitlistPage() {
  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <WaitlistLanding />
      </div>
    </div>
  );
}
