"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { MIN_PASSWORD, NETWORK_MESSAGE, validateNewPassword } from "@/lib/auth/reset";
import { createClient } from "@/lib/supabase/browser";

/** Two fields for the new password. The old password is never asked for, shown or sent. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 2500);
    return () => clearTimeout(timer);
  }, [done, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const checked = validateNewPassword(password, confirm);
    setError(null);
    if (!checked.ok) {
      setFields({ [checked.field]: checked.message });
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const { error: authError } = await createClient().auth.updateUser({ password });
      if (authError) {
        const unreachable = authError.name === "AuthRetryableFetchError" || authError.status === 0;
        setError(unreachable ? NETWORK_MESSAGE : "The password could not be changed. Ask for a new link and try again.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError(NETWORK_MESSAGE);
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4" data-testid="reset-done">
        <Banner kind="info">Your password was changed. You are signed in.</Banner>
        <Link href="/" className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-white" data-testid="reset-go-home">
          Go to Home
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate data-testid="reset-password-form">
      {error ? <Banner kind="error">{error}</Banner> : null}
      <TextInput
        id="password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD} characters.`}
        error={fields.password}
        required
      />
      <TextInput id="confirm" name="confirm" label="New password again" type="password" autoComplete="new-password" error={fields.confirm} required />
      <Button type="submit" loading={busy} className="w-full">
        Change password
      </Button>
    </form>
  );
}
