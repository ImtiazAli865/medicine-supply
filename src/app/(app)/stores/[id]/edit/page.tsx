import { notFound } from "next/navigation";
import { StoreForm } from "@/components/stores/StoreForm";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { getStore } from "@/lib/stores/repository";

export const metadata = { title: "Edit store · Medicine Supply" };

export default async function EditStorePage({ params }: PageProps<"/stores/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit store</h1>
      <StoreForm initial={store} />
    </div>
  );
}
