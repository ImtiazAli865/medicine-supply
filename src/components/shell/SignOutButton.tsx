"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setBusy(false);
      toast.show("Could not sign out. Check your connection and try again.", "error");
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <Button variant="ghost" onClick={signOut} loading={busy} aria-label="Sign out">
      <LogOut size={20} aria-hidden="true" />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
