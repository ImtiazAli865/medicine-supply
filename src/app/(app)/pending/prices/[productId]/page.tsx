import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriceFillReview } from "@/components/pending/PriceFillReview";
import { Banner } from "@/components/ui/States";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";
import { getProduct } from "@/lib/products/repository";

export const metadata = { title: "Set a price · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function PriceFillPage({ params }: PageProps<"/pending/prices/[productId]">) {
  const { productId } = await params;
  const { supabase } = await requirePageContext();
  if (!isUuid(productId)) notFound();
  const p = await getProduct(supabase, productId);
  if (!p) notFound();

  return (
    <div className="space-y-4">
      <Link href="/pending?tab=prices" className="inline-flex min-h-11 items-center gap-1 text-primary">
        <ChevronLeft size={20} aria-hidden="true" /> Pending
      </Link>
      {p.is_active ? (
        // Only the public facts go to the browser: never the purchase price or MRP.
        <PriceFillReview
          product={{
            id: p.id,
            name: p.name,
            unit: p.unit,
            strength: p.strength,
            dosage_form: p.dosage_form,
            pack_size: p.pack_size,
            manufacturer: p.manufacturer,
            selling_price: p.selling_price,
            is_active: p.is_active,
          }}
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold" dir="auto">
            {p.name}
          </h1>
          <Banner kind="warning">This medicine is inactive. Reactivate it on its page before setting a price.</Banner>
        </>
      )}
    </div>
  );
}
