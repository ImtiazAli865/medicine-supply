import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { SessionExpiredBanner } from "./SessionExpiredBanner";
import { SignOutButton } from "./SignOutButton";

export function AppShell({ businessName, children }: { businessName: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b border-border bg-surface px-4">
        <p className="truncate text-base font-semibold" dir="auto" data-testid="business-name">
          {businessName}
        </p>
        <SignOutButton />
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <BottomNav />
        <main className="flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-3xl">
            <SessionExpiredBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
