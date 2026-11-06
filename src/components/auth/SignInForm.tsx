"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { createClient } from "@/lib/supabase/browser";

/** Only same-origin relative paths are accepted as a post-sign-in destination. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

export function SignInForm({ next, expired }: { next?: string; expired?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Read the values from the form at submit time, not from React state: browser autofill and
    // password managers fill the fields without always triggering change events.
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
      if (authError) {
        // The same message for an unknown email and a wrong password: never reveal which one.
        const isCredentials = authError.status === 400 || authError.code === "invalid_credentials";
        setError(
          isCredentials
            ? "Incorrect email or password."
            : "Can't reach the server. Check your connection and try again.",
        );
        setBusy(false);
        return;
      }
      router.replace(safeNextPath(next));
      router.refresh();
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {expired ? <Banner kind="warning">Your session expired. Please sign in again.</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <TextInput id="email" name="email" label="Email" type="email" autoComplete="username" inputMode="email" required />
      <TextInput
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" loading={busy} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
