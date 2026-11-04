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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
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
      <TextInput
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextInput
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" loading={busy} disabled={!email || !password} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
