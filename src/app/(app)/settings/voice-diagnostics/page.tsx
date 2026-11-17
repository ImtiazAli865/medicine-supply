import { VoiceDiagnosticsScreen } from "@/components/voice/VoiceDiagnosticsScreen";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Voice diagnostics · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function VoiceDiagnosticsPage() {
  await requirePageContext();
  return <VoiceDiagnosticsScreen />;
}
