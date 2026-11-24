"use client";

import { ArrowLeft, Download, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { LoadingBlock } from "@/components/ui/Spinner";
import type { PeriodApi } from "./usePeriod";
import { PeriodChooser } from "./PeriodChooser";
import { GroupSwitch } from "./GroupSwitch";

export type ReportStatus = "loading" | "error" | "empty" | "ready";

export interface ReportEmpty {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * The frame of every report screen: a way back, the title, the period controls, the three honest states (loading,
 * an error with Retry that never shows a zero, an empty state with the next action) and the Export CSV button, which
 * exists only while the report is loaded and has rows.
 */
export function ReportShell({
  title,
  description,
  period,
  showGroup = false,
  status,
  errorMessage,
  onRetry,
  empty,
  exportHref,
  controls,
  children,
}: {
  title: string;
  description?: string;
  /** The period controls; leave out for a report that has no period (outstanding balances). */
  period?: PeriodApi;
  showGroup?: boolean;
  status: ReportStatus;
  errorMessage?: string;
  onRetry: () => void;
  empty: ReportEmpty;
  /** Address of the CSV for exactly what is on the screen; null or missing hides the button. */
  exportHref?: string | null;
  /** Controls that stay on the screen in every state (a search box, a sort), shown under the period. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports" className="inline-flex min-h-11 items-center gap-1 text-primary">
          <ArrowLeft size={18} aria-hidden="true" />
          Reports
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-muted">{description}</p> : null}
      </div>

      {period ? <PeriodChooser range={period.range} onChange={period.setRange} /> : null}
      {period && showGroup ? <GroupSwitch group={period.group} onChange={period.setGroup} /> : null}

      {controls}

      {status === "loading" ? <LoadingBlock label="Loading the report…" /> : null}
      {status === "error" ? (
        <div data-testid="report-error">
          <ErrorState message={errorMessage ?? "Something went wrong. Please try again."} onRetry={onRetry} />
        </div>
      ) : null}
      {status === "empty" ? (
        <div data-testid="report-empty">
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
        </div>
      ) : null}
      {status === "ready" ? children : null}

      {status === "ready" && exportHref ? (
        <a href={exportHref} download className={buttonClass("secondary", "w-full sm:w-auto")} data-testid="report-export">
          <Download size={20} aria-hidden="true" />
          Export CSV
        </a>
      ) : null}
    </div>
  );
}
