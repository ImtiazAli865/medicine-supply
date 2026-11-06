import { ProductForm } from "@/components/products/ProductForm";
import { requirePageContext } from "@/lib/api/auth";

export const metadata = { title: "Add medicine · Medicine Supply" };

export default async function NewProductPage() {
  await requirePageContext();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Add medicine</h1>
      <ProductForm />
    </div>
  );
}
