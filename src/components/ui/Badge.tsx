import type { ReactNode } from "react";

type Tone = "neutral" | "warning" | "success";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-200 text-slate-800",
  warning: "bg-warning-soft text-warning",
  success: "bg-primary-soft text-primary-strong",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-sm font-medium ${tones[tone]}`}>{children}</span>;
}
