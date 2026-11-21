import { Suspense } from "react";
import { OfflineProvider } from "@/components/offline/OfflineProvider";
import { OfflineShell } from "@/components/offline/OfflineShell";
import { LoadingBlock } from "@/components/ui/Spinner";

// The offline shell (Module 009). A client-only page with no server data and no sign-in check, so the service worker can keep
// it on the phone and show it when the network is gone. Which business's orders it shows is decided on the device
// (src/lib/device/identity.ts); every request it makes still needs the real session.

export const metadata = { title: "Offline · Medicine Supply" };

export default function OfflinePage() {
  return (
    <OfflineProvider server={null}>
      <Suspense fallback={<LoadingBlock label="Opening the offline app…" />}>
        <OfflineShell />
      </Suspense>
    </OfflineProvider>
  );
}
