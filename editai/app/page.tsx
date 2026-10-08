import { Hero } from "@/components/landing/hero";
import { LiveDemo } from "@/components/landing/live-demo";
import { Audience, Faq, Features, FinalCta, HowItWorks, Pricing, SiteFooter } from "@/components/landing/sections";
import { SiteHeader } from "@/components/landing/site-header";
import { isSupabaseConfigured } from "@/config/env";

async function isSignedIn() {
  if (!isSupabaseConfigured()) return false;
  const { getCurrentUser } = await import("@/lib/auth");
  return Boolean(await getCurrentUser().catch(() => null));
}

export default async function LandingPage() {
  const signedIn = await isSignedIn();
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main>
        <Hero />
        <HowItWorks />
        <LiveDemo />
        <Features />
        <Audience />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
