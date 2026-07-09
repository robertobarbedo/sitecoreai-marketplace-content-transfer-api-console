import { CONTENT_TRANSFER_BASE } from "@/src/lib/transfer/client";
import { jsonError, proxyJsonRequest } from "@/src/lib/transfer/request";
import type { CreateTransferInput } from "@/src/types/transfer";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Creates a content transfer operation. Runs against the SOURCE environment.
 */
export async function POST(request: Request) {
  let input: CreateTransferInput;
  try {
    input = (await request.json()) as CreateTransferInput;
  } catch {
    return jsonError("validation", 400, { detail: "Invalid JSON body" });
  }

  if (!input.TransferId || !UUID_PATTERN.test(input.TransferId)) {
    return jsonError("validation", 400, {
      field: "TransferId",
      detail:
        "TransferId must be a lowercase hexadecimal UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)",
    });
  }
  if (!input.Configuration?.Database) {
    return jsonError("validation", 400, {
      field: "Database",
      detail: "Configuration.Database is required",
    });
  }
  const trees = input.Configuration?.DataTrees;
  if (!Array.isArray(trees) || trees.length === 0) {
    return jsonError("validation", 400, {
      field: "DataTrees",
      detail: "At least one data tree is required",
    });
  }
  for (const tree of trees) {
    if (!tree.ItemPath || !tree.ItemPath.startsWith("/sitecore")) {
      return jsonError("validation", 400, {
        field: "ItemPath",
        detail: "Each data tree needs an item path starting with /sitecore",
      });
    }
  }

  return proxyJsonRequest(request, `${CONTENT_TRANSFER_BASE}/transfers`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
