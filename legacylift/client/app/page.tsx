// app/page.tsx — Landing page. Assembles Hero, HowItWorks, PipelineShowcase, CTA.
// All components are client components so this server component just composes them.
//
// TODO: Add <head> Open Graph tags for social sharing before the hackathon submission.

import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { PipelineShowcase } from "@/components/landing/PipelineShowcase";
import { CTASection } from "@/components/landing/CTASection";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <PipelineShowcase />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
