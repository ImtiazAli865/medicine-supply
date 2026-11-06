import { notFound } from "next/navigation";
import { ProductForm } from "@/components/products/ProductForm";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { getProduct } from "@/lib/products/repository";

export const metadata = { title: "Edit medicine · Medicine Supply" };

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(id)) notFound();
  const product = await getProduct(supabase, id);
  if (!product) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit medicine</h1>
      <ProductForm initial={product} />
    </div>
  );
}
