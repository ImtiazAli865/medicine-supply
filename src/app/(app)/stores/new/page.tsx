import { StoreForm } from "@/components/stores/StoreForm";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Add store · Medicine Supply" };

export default async function NewStorePage() {
  await requirePageContext();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Add store</h1>
      <StoreForm />
    </div>
  );
}
