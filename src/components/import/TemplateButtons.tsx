"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { templateCsv, templateXlsx } from "@/lib/import/template";

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TemplateButtons() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function xlsx() {
    setBusy(true);
    setError(null);
    try {
      download(await templateXlsx(), "medicine-import-template.xlsx");
    } catch {
      setError("Could not create the Excel template. Please try again, or use the CSV template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-muted">
        The first row must keep these column headings. <strong>Name and unit are required</strong>; every other column is
        optional and stays empty if you leave it empty.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => download(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }), "medicine-import-template.csv")}>
          <Download size={20} aria-hidden="true" />
          Download CSV template
        </Button>
        <Button variant="secondary" onClick={xlsx} loading={busy}>
          <Download size={20} aria-hidden="true" />
          Download Excel template
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
