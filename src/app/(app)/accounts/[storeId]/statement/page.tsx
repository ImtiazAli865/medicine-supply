import { notFound } from "next/navigation";
import { StatementToolbar } from "@/components/accounts/StatementToolbar";
import { StatementView } from "@/components/accounts/StatementView";
import { getStatement } from "@/lib/accounts/repository";
import { requirePageContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { isUuid } from "@/lib/ids";
import { todayInPakistan } from "@/lib/orders/dates";
import { StatementQuerySchema } from "@/lib/validation/account";

export const metadata = { title: "Store statement · Medicine Supply" };
export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export default async function StatementPage({ params, searchParams }: PageProps<"/accounts/[storeId]/statement">) {
  const { storeId } = await params;
  const raw = await searchParams;
  const { supabase } = await requirePageContext();
  if (!isUuid(storeId)) notFound();

  // Without a range the statement starts on the first day of the current month and ends today (Pakistan time).
  const today = todayInPakistan();
  const parsed = StatementQuerySchema.safeParse({ from: first(raw.from) ?? `${today.slice(0, 8)}01`, to: first(raw.to) ?? today });
  const from = first(raw.from) ?? `${today.slice(0, 8)}01`;
  const to = first(raw.to) ?? today;

  let statement = null;
  if (parsed.success) {
    try {
      statement = await getStatement(supabase, storeId, parsed.data);
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") notFound();
      if (!(error instanceof ApiError && error.code === "validation_error")) throw error;
    }
  }

  return (
    <div className="space-y-4">
      <StatementToolbar storeId={storeId} from={from} to={to} canPrint={statement !== null} />
      {statement ? (
        <StatementView statement={statement} />
      ) : (
        <p role="alert" className="rounded-lg border border-danger/40 px-3 py-2 text-danger" data-testid="statement-invalid">
          {parsed.success ? "The start date must not be after the end date." : (parsed.error.issues[0]?.message ?? "Choose a valid date range.")} Choose the dates again.
        </p>
      )}
    </div>
  );
}
