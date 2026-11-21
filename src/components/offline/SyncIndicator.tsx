"use client";

import { AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useOffline } from "./OfflineProvider";

/**
 * Online or offline and how many orders are not yet sent, on every screen (Module 009, FR-006). It only says what is true:
 * "waiting" means kept on this phone and not confirmed by the server. It opens the Settings sync section.
 */
export function SyncIndicator() {
  const { mode, online, status } = useOffline();
  if (mode !== "ready" || !status) return null;

  const { counts } = status;
  const waiting = counts.waiting + counts.blocked;
  const attention = counts.failed + counts.conflict;

  let label: string;
  let tone: "ok" | "warn" | "bad" | "off";
  let Icon = Wifi;

  if (status.needsSignIn && waiting + attention > 0) {
    label = `Sign in to send ${waiting + attention}`;
    tone = "bad";
    Icon = AlertTriangle;
  } else if (attention > 0) {
    label = counts.conflict > 0 ? `${counts.conflict} need${counts.conflict === 1 ? "s" : ""} a decision` : `${counts.failed} failed`;
    tone = "bad";
    Icon = AlertTriangle;
  } else if (!online) {
    label = waiting > 0 ? `Offline · ${waiting} waiting` : "Offline";
    tone = "off";
    Icon = WifiOff;
  } else if (counts.syncing > 0) {
    label = `Sending ${counts.syncing}`;
    tone = "warn";
    Icon = RefreshCw;
  } else if (waiting > 0) {
    label = status.paused ? `${waiting} waiting · paused` : `${waiting} waiting`;
    tone = "warn";
    Icon = RefreshCw;
  } else {
    label = "Online";
    tone = "ok";
  }

  const color = tone === "bad" ? "text-danger" : tone === "warn" ? "text-warning" : tone === "off" ? "text-foreground" : "text-primary-strong";
  return (
    <Link
      href="/settings"
      data-testid="sync-indicator"
      data-online={online ? "true" : "false"}
      data-waiting={waiting}
      aria-label={`Connection and sending: ${label}. Open sync status.`}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium ${color}`}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}
