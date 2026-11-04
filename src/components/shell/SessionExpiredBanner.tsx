"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/States";
import { SESSION_EXPIRED_EVENT, signInUrl } from "@/lib/api/client";

/**
 * Shown when a save fails because the session expired while a form is open. The form stays on
 * screen with its text; the user signs in in a new tab and then retries Save.
 */
export function SessionExpiredBanner() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!expired) return null;
  return (
    <div className="mb-4" data-testid="session-expired">
      <Banner kind="warning">
        <strong>Your session expired.</strong> Your typed text is still here.{" "}
        <a href={signInUrl()} target="_blank" rel="noreferrer" className="font-semibold underline">
          Sign in again
        </a>{" "}
        in a new tab, then come back and save.
      </Banner>
    </div>
  );
}
