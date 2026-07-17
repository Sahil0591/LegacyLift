import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { Hero } from "@/components/landing/Hero";
import { ProductDemo } from "@/components/landing/ProductDemo";
import { WhyDifferent } from "@/components/landing/WhyDifferent";
import { CTASection } from "@/components/landing/CTASection";

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <Navbar />
        <main>
          <Hero />
          <ProductDemo />
          <WhyDifferent />
          <CTASection />
        </main>
        <Footer />
      </div>
    </div>
  );
}
