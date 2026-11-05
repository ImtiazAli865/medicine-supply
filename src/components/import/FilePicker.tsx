"use client";

import { FileSpreadsheet } from "lucide-react";
import { useId, useRef } from "react";

export function FilePicker({ disabled, onFile }: { disabled?: boolean; onFile: (file: File) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        data-testid="import-file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Allow choosing the same file again after an error or a change elsewhere.
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-6 text-center hover:border-primary focus-within:border-primary ${
          disabled ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <FileSpreadsheet size={32} className="text-primary" aria-hidden="true" />
        <span className="text-base font-medium">Choose a CSV or Excel (.xlsx) file</span>
        <span className="text-sm text-muted">Up to 10,000 medicines and 5 MB. The file stays on your device; only the text rows are sent.</span>
      </label>
    </div>
  );
}
