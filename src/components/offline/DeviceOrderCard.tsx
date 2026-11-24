"use client";

import { AlertTriangle, HardDrive, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import type { SyncItem } from "@/lib/device/sync-center";
import { useOffline } from "./OfflineProvider";

const LABELS: Record<SyncItem["state"], string> = {
  waiting: "Saved on this device, not yet sent",
  blocked: "Saved on this device, waiting for its store",
  syncing: "Sending…",
  failed: "Could not be sent",
  conflict: "Needs your decision",
  similar: "Needs your decision",
};

/** The address that opens an order that is kept on this phone (a never-sent order needs its store in the address). */
export function deviceOrderHref(item: Pick<SyncItem, "orderId" | "storeId" | "neverSent">): string {
  return item.neverSent ? `/orders/${item.orderId}?store=${item.storeId}` : `/orders/${item.orderId}`;
}

/** One order that is not yet confirmed by the server, with its own honest state (Module 009, FR-014). */
export function DeviceOrderCard({ item }: { item: SyncItem }) {
  const { storeNames, center } = useOffline();
  const tone = item.state === "failed" || item.state === "conflict" ? "text-danger" : "text-warning";
  const Icon = item.state === "syncing" ? Loader2 : item.state === "failed" || item.state === "conflict" ? AlertTriangle : HardDrive;
  const lines = `${item.lines} ${item.lines === 1 ? "line" : "lines"}`;
  return (
    <li data-testid="device-order" data-state={item.state}>
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
        <Link href={deviceOrderHref(item)} data-testid="order-list-item" className="block min-h-11 space-y-1">
          <span className="block font-semibold">{item.neverSent ? "New order" : "Order with changes not yet sent"}</span>
          <span className="block font-medium" dir="auto">
            {storeNames[item.storeId] ?? "Store on this phone"}
          </span>
          <span className="block text-sm">{lines}</span>
        </Link>
        <p data-testid="draft-state" data-state={item.state} className={`flex flex-wrap items-center gap-2 text-sm font-medium ${tone}`}>
          <Icon size={18} className={item.state === "syncing" ? "animate-spin" : undefined} aria-hidden="true" />
          {LABELS[item.state]}
        </p>
        {item.reason && item.state !== "syncing" ? (
          <p className="text-sm text-muted" dir="auto">
            {item.reason}
          </p>
        ) : null}
        {item.state === "failed" || item.state === "waiting" ? (
          <Button variant="secondary" onClick={() => center?.retry(item.orderId)} data-testid="sync-retry">
            {item.state === "failed" ? "Retry" : "Send now"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
