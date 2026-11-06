import { ImportHistory } from "@/components/import/ImportHistory";
import { ImportSummaryView } from "@/components/import/SummaryCard";
import { ImportWizard } from "@/components/import/ImportWizard";
import { requirePageContext } from "@/lib/api/auth";
import { isUuid } from "@/lib/ids";

export const metadata = { title: "Import medicines · Medicine Supply" };
export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: PageProps<"/products/import">) {
  await requirePageContext();
  const params = await searchParams;
  const importId = typeof params.import === "string" && isUuid(params.import) ? params.import : null;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Import medicines</h1>
      {importId ? (
        <ImportSummaryView id={importId} />
      ) : (
        <>
          <ImportWizard />
          <ImportHistory />
        </>
      )}
    </div>
  );
}
