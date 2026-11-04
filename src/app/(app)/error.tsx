"use client";

import { ErrorState } from "@/components/ui/States";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The real error is logged on the server; the user only sees a safe message and a Retry action.
  return <ErrorState message="Something went wrong while loading this screen." onRetry={reset} />;
}
