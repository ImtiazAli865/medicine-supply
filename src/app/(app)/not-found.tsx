import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

export default function AppNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <SearchX size={40} className="text-muted" aria-hidden="true" />
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="max-w-sm text-muted">This record does not exist, or you do not have access to it.</p>
      <ButtonLink href="/">Go to Home</ButtonLink>
    </div>
  );
}
