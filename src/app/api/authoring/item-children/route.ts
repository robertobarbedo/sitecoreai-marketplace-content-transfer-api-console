import { NextResponse } from "next/server";
import {
  TransferApiRequestError,
  transferFetch,
} from "@/src/lib/transfer/client";
import {
  readEnvironment,
  missingCredentialsResponse,
  jsonError,
  transferErrorResponse,
} from "@/src/lib/transfer/request";
import type { ContentTreeItem, ItemChildrenResult } from "@/src/types/transfer";

const AUTHORING_GRAPHQL_PATH = "/sitecore/api/authoring/graphql/v1";

const CHILDREN_QUERY = `
  query ItemChildren($path: String!, $database: String!, $language: String!) {
    item(where: { database: $database, path: $path, language: $language }) {
      itemId
      name
      path
      hasChildren
      children(first: 100) {
        nodes {
          itemId
          name
          path
          hasChildren
        }
      }
    }
  }
`;

interface GraphQLItem extends ContentTreeItem {
  children?: { nodes?: ContentTreeItem[] };
}

/**
 * Returns an item and its children from the environment's Authoring GraphQL
 * API — used by the content tree picker to browse the SOURCE environment.
 * The automation client JWT authorizes the authoring endpoint directly.
 */
export async function POST(request: Request) {
  const env = readEnvironment(request);
  if (!env) {
    return missingCredentialsResponse();
  }

  let body: { path?: string; database?: string; language?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("validation", 400, { detail: "Invalid JSON body" });
  }

  const path = body.path?.trim();
  if (!path || !path.startsWith("/sitecore")) {
    return jsonError("validation", 400, {
      field: "path",
      detail: "path must start with /sitecore",
    });
  }

  try {
    const response = await transferFetch(env, AUTHORING_GRAPHQL_PATH, {
      method: "POST",
      body: JSON.stringify({
        query: CHILDREN_QUERY,
        variables: {
          path,
          database: body.database?.trim() || "master",
          language: body.language?.trim() || "en",
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new TransferApiRequestError(response.status, detail);
    }

    const payload = (await response.json()) as {
      data?: { item?: GraphQLItem | null };
      errors?: { message?: string }[];
    };

    if (payload.errors?.length) {
      return jsonError("transfer_api_error", 502, {
        detail: payload.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; "),
      });
    }

    const item = payload.data?.item ?? null;
    const result: ItemChildrenResult = item
      ? {
          item: {
            itemId: item.itemId,
            name: item.name,
            path: item.path,
            hasChildren: item.hasChildren,
          },
          children: item.children?.nodes ?? [],
        }
      : { item: null, children: [] };

    return NextResponse.json(result);
  } catch (error) {
    return transferErrorResponse(error);
  }
}
