"use client";

import { CloudOff, WifiOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { NewOrderStart } from "@/components/orders/NewOrderStart";
import { OrderHistory } from "@/components/orders/OrderHistory";
import { OrderScreen } from "@/components/orders/OrderScreen";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Banner, EmptyState } from "@/components/ui/States";
import { parseGo, shellHref, type ShellRoute } from "@/lib/device/shell-route";
import { useOffline } from "./OfflineProvider";
import { SyncStatusSection } from "./SyncStatusSection";

// The offline app (Module 009, plan D3): the screens that work without the internet, shown inside the same header and
// bottom navigation as the app. The service worker sends a failed page request here with `?go=<the path>`.

function Blocked({ area }: { area: string }) {
  return (
    <div data-testid="offline-blocked">
      <EmptyState
        icon={CloudOff}
        title="This needs the internet"
        description={`${area} needs the internet. You can still take orders: they are kept on this phone and sent when the connection returns.`}
        action={<ButtonLink href={shellHref({ kind: "new_order" })}>Take an order</ButtonLink>}
      />
    </div>
  );
}

function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Offline</h1>
      <p className="text-muted">The app could not reach the server. These screens still work on this phone.</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={shellHref({ kind: "new_order" })}>New order</ButtonLink>
        <ButtonLink href={shellHref({ kind: "orders" })} variant="secondary">
          Orders on this phone
        </ButtonLink>
        <ButtonLink href={shellHref({ kind: "settings" })} variant="secondary">
          Sync status
        </ButtonLink>
      </div>
    </div>
  );
}

function Screen({ route }: { route: ShellRoute }) {
  switch (route.kind) {
    case "home":
      return <Home />;
    case "orders":
      return <OrderHistory />;
    case "new_order":
      return <NewOrderStart />;
    case "order":
      return <OrderScreen id={route.id} storeParam={route.store} />;
    case "settings":
      return (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <SyncStatusSection />
        </div>
      );
    case "blocked":
      return <Blocked area={route.area} />;
  }
}

export function OfflineShell() {
  const search = useSearchParams();
  const go = search.get("go");
  const route = parseGo(go);
  const { mode, message, online, runtime } = useOffline();

  if (mode === "starting") return <LoadingBlock label="Opening the offline app…" />;

  if (mode === "needs_sign_in") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8" data-testid="offline-needs-sign-in">
        <EmptyState
          icon={WifiOff}
          title="Sign in to see this device's orders"
          description="Connect to the internet and sign in. Orders that are waiting on this phone stay here and are not lost."
          action={
            <ButtonLink href="/sign-in" variant="secondary">
              Open sign-in
            </ButtonLink>
          }
        />
      </main>
    );
  }

  if (mode === "unavailable" || mode === "newer_schema") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8" data-testid="offline-unavailable">
        <EmptyState
          icon={CloudOff}
          title="Offline orders cannot be kept here"
          description={message ?? "This browser cannot keep data on this phone (for example in a private window). The app works only while online."}
        />
      </main>
    );
  }

  const businessName = runtime?.identity.status === "ok" ? runtime.identity.businessName : "Medicine Supply";
  return (
    <AppShell businessName={businessName}>
      {online && route.kind !== "blocked" ? (
        <div className="mb-3">
          <Banner kind="info">
            The connection is back.{" "}
            <a href={go ?? "/orders"} className="inline-flex min-h-11 items-center font-semibold underline">
              Open the full app
            </a>
          </Banner>
        </div>
      ) : null}
      <Screen route={route} />
    </AppShell>
  );
}
