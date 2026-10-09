import { Header } from "@/components/app/header";
import { MobileNav, Sidebar } from "@/components/app/sidebar";
import { SetupNotice } from "@/components/app/setup-notice";
import { missingRequiredEnv } from "@/config/env";
import { requireUserOrRedirect } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const missing = missingRequiredEnv();
  if (missing.length) return <SetupNotice missing={missing} />;
  const user = await requireUserOrRedirect();
  const supabase = await createSupabaseServerClient();
  const [{ data: credits }, { data: profile }] = await Promise.all([
    supabase.from("credits").select("balance").maybeSingle(),
    supabase.from("users").select("full_name").maybeSingle(),
  ]);
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <Header email={user.email ?? ""} name={profile?.full_name ?? null} balance={credits?.balance ?? 0} renderedAt={Date.now()} />
        <main className="flex-1">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
