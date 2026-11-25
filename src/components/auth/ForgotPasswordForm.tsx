"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Banner } from "@/components/ui/States";
import { NETWORK_MESSAGE, resetRequestMessage } from "@/lib/auth/reset";
import { createClient } from "@/lib/supabase/browser";

/**
 * Asks the authentication service to email a link for choosing a new password. The answer on screen is the same whether the
 * address has an account or not (and when the service limited the request): it never says who has an account.
 */
export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) {
      setMessage({ text: "Enter your email.", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/confirm` });
      const text = resetRequestMessage(error ? { status: error.status, name: error.name, code: error.code } : null);
      setMessage({ text, error: text === NETWORK_MESSAGE });
    } catch {
      setMessage({ text: NETWORK_MESSAGE, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate data-testid="forgot-password-form">
      {message ? (
        <div data-testid="forgot-password-message">
          <Banner kind={message.error ? "error" : "info"}>{message.text}</Banner>
        </div>
      ) : null}
      <TextInput id="email" name="email" label="Email" type="email" autoComplete="username" inputMode="email" required />
      <Button type="submit" loading={busy} className="w-full">
        Send the link
      </Button>
    </form>
  );
}
