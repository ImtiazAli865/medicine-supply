import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <SearchX size={40} className="text-muted" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted">This page does not exist, or you do not have access to it.</p>
      <ButtonLink href="/">Go to Home</ButtonLink>
    </main>
  );
}
