import { SyncStatusSection } from "@/components/offline/SyncStatusSection";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { ButtonLink } from "@/components/ui/Button";
import { requirePageContext } from "@/lib/api/auth";
import { getSettings } from "@/lib/settings/repository";

export const metadata = { title: "Settings · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { supabase } = await requirePageContext();
  const settings = await getSettings(supabase);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ButtonLink href="/reports" variant="secondary" className="w-full sm:w-auto" testId="settings-reports-link">
        Reports
      </ButtonLink>
      <SettingsForm initial={settings} />
      <SyncStatusSection />
    </div>
  );
}
