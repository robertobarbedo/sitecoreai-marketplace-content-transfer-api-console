"use client";

import { cn } from "@/lib/utils";
import { SHARED_VALUE_KEY } from "@/src/utils/reconciliation";
import type {
  ApplyRow,
  ApplyRowStatus,
} from "@/src/utils/reconciliation-apply";

const statusPills: Record<ApplyRowStatus, { label: string; className: string }> = {
  "will-update": { label: "will update", className: "bg-primary-bg text-primary-fg" },
  unchanged: { label: "unchanged", className: "bg-neutral-bg text-neutral-fg" },
  "item-missing": { label: "item missing", className: "bg-[#ffe6bd] text-[#953d00]" },
  "no-version": { label: "no version", className: "bg-[#ffe6bd] text-[#953d00]" },
  updated: { label: "✓ updated", className: "bg-success-bg text-success-fg" },
  failed: { label: "✗ failed", className: "bg-danger-bg text-danger-fg" },
};

function truncate(value: string | null, max = 80): string {
  if (value === null) return "—";
  if (value === "") return "(empty)";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Preview/result table shared by the Reconciliation tab and saved transfers. */
export function ApplyRowsTable({ rows }: { rows: ApplyRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-muted">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border-muted bg-surface-grey">
            {[
              "Item",
              "Field",
              "Language",
              "Current value",
              "Desired value",
              "Status",
            ].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn(
                "border-b border-border-muted last:border-b-0",
                row.status === "unchanged" && "opacity-55",
              )}
            >
              <td
                className="max-w-[260px] truncate px-3 py-2 font-mono"
                title={row.itemPath}
              >
                {row.itemPath}
              </td>
              <td className="px-3 py-2">{row.fieldName}</td>
              <td className="px-3 py-2">
                {row.valueKey === SHARED_VALUE_KEY ? "shared" : row.valueKey}
              </td>
              <td
                className="max-w-[240px] truncate px-3 py-2 font-mono"
                title={row.current ?? undefined}
              >
                {truncate(row.current)}
              </td>
              <td
                className="max-w-[240px] truncate px-3 py-2 font-mono"
                title={row.desired}
              >
                {truncate(row.desired)}
              </td>
              <td className="px-3 py-2" title={row.error}>
                <span
                  className={cn(
                    "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
                    statusPills[row.status].className,
                  )}
                >
                  {statusPills[row.status].label}
                </span>
                {row.error && (
                  <span className="mt-0.5 block text-xs text-danger">
                    {row.error}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
