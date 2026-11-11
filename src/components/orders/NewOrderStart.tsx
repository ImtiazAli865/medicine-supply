"use client";

import { useRouter } from "next/navigation";
import { StoreSelector } from "@/components/orders/StoreSelector";
import { newId } from "@/lib/ids";

/**
 * Step one of a new order: choose (or add) the store. Nothing is saved yet; the order is created on the
 * server by the first change on the next screen. The order id is made here and goes into the address.
 */
export function NewOrderStart() {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">New order</h1>
        <p className="text-muted">Choose the store this order is for.</p>
      </div>
      <StoreSelector onSelect={(store) => router.replace(`/orders/${newId()}?store=${store.id}`)} />
    </div>
  );
}
