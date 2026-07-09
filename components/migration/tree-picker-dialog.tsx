"use client";

import { useCallback, useEffect, useState } from "react";
import {
  mdiChevronRight,
  mdiChevronDown,
  mdiLoading,
  mdiFileDocumentOutline,
  mdiAlertCircle,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callTransferApi } from "@/src/utils/transfer-api";
import type {
  EnvironmentConnection,
  ItemChildrenResult,
} from "@/src/types/transfer";

const ROOT_PATH = "/sitecore";

interface TreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  /** null = children not loaded yet */
  children: TreeNode[] | null;
  expanded: boolean;
  loading: boolean;
}

function toNode(item: {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
}): TreeNode {
  return { ...item, children: null, expanded: false, loading: false };
}

/** Returns a copy of the tree with the node at `path` replaced by fn(node). */
function mapNode(
  node: TreeNode,
  path: string,
  fn: (node: TreeNode) => TreeNode,
): TreeNode {
  if (node.path === path) return fn(node);
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => mapNode(child, path, fn)),
  };
}

interface TreePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Environment whose content tree is browsed. */
  source: EnvironmentConnection;
  /** Database to browse, e.g. "master". */
  database: string;
  onSelect: (path: string) => void;
}

/**
 * Lazy-loading content tree picker over the source environment's Authoring
 * GraphQL API. Selecting a node and confirming fills the data-tree path.
 */
export function TreePickerDialog({
  open,
  onOpenChange,
  source,
  database,
  onSelect,
}: TreePickerDialogProps) {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);

  const fetchChildren = useCallback(
    (path: string) =>
      callTransferApi<ItemChildrenResult>(source, "/api/authoring/item-children", {
        method: "POST",
        body: JSON.stringify({ path, database: database.trim() || "master" }),
      }),
    [source, database],
  );

  // Load the root when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRoot(null);
    setSelectedPath(null);
    setError(null);
    setLoadingRoot(true);
    (async () => {
      try {
        const result = await fetchChildren(ROOT_PATH);
        if (cancelled) return;
        if (!result.item) {
          setError(`Item ${ROOT_PATH} was not found in the source database.`);
          return;
        }
        setRoot({
          ...toNode(result.item),
          expanded: true,
          children: result.children.map(toNode),
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not browse the source content tree.",
          );
        }
      } finally {
        if (!cancelled) setLoadingRoot(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fetchChildren]);

  const handleToggle = async (node: TreeNode) => {
    if (!root || !node.hasChildren) return;

    if (node.expanded) {
      setRoot((prev) =>
        prev ? mapNode(prev, node.path, (n) => ({ ...n, expanded: false })) : prev,
      );
      return;
    }
    if (node.children) {
      setRoot((prev) =>
        prev ? mapNode(prev, node.path, (n) => ({ ...n, expanded: true })) : prev,
      );
      return;
    }

    setRoot((prev) =>
      prev ? mapNode(prev, node.path, (n) => ({ ...n, loading: true })) : prev,
    );
    try {
      const result = await fetchChildren(node.path);
      setRoot((prev) =>
        prev
          ? mapNode(prev, node.path, (n) => ({
              ...n,
              loading: false,
              expanded: true,
              children: result.children.map(toNode),
            }))
          : prev,
      );
    } catch (err) {
      setRoot((prev) =>
        prev ? mapNode(prev, node.path, (n) => ({ ...n, loading: false })) : prev,
      );
      setError(
        err instanceof Error ? err.message : "Could not load the item's children.",
      );
    }
  };

  const handleConfirm = () => {
    if (!selectedPath) return;
    onSelect(selectedPath);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select an item from {source.label}</DialogTitle>
          <DialogDescription>
            Browsing the <span className="font-mono">{database.trim() || "master"}</span>{" "}
            database of the source environment. Click an item to select it,
            use the chevrons to expand.
          </DialogDescription>
        </DialogHeader>

        <div className="h-80 overflow-auto rounded-lg border border-border-muted bg-surface-container-low p-2">
          {loadingRoot ? (
            <div className="flex h-full items-center justify-center gap-2 text-text-subtle">
              <Icon path={mdiLoading} className="animate-spin" />
              Loading content tree&hellip;
            </div>
          ) : root ? (
            <TreeNodeRow
              node={root}
              depth={0}
              selectedPath={selectedPath}
              onToggle={handleToggle}
              onSelect={setSelectedPath}
            />
          ) : null}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-danger-fg">
            <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="truncate rounded-lg bg-neutral-bg px-3 py-2 font-mono text-xs text-neutral-fg">
          {selectedPath ?? "No item selected"}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            Use this path
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreeNodeRow({
  node,
  depth,
  selectedPath,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onToggle: (node: TreeNode) => void;
  onSelect: (path: string) => void;
}) {
  const selected = selectedPath === node.path;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md py-1 pr-2",
          selected ? "bg-primary-bg text-primary-fg" : "hover:bg-surface-container",
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => onToggle(node)}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded",
            node.hasChildren
              ? "cursor-pointer text-text-subtle hover:text-on-surface"
              : "invisible",
          )}
          aria-label={node.expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
        >
          <Icon
            path={
              node.loading
                ? mdiLoading
                : node.expanded
                  ? mdiChevronDown
                  : mdiChevronRight
            }
            size={0.7}
            className={node.loading ? "animate-spin" : ""}
          />
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          onDoubleClick={() => onToggle(node)}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left"
          title={node.path}
        >
          <Icon
            path={mdiFileDocumentOutline}
            size={0.7}
            className="shrink-0 opacity-70"
          />
          <span className="truncate text-sm">{node.name}</span>
        </button>
      </div>

      {node.expanded && node.children && (
        <div>
          {node.children.length === 0 ? (
            <p
              className="py-1 text-xs text-text-subtle"
              style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
            >
              No children
            </p>
          ) : (
            node.children.map((child) => (
              <TreeNodeRow
                key={child.itemId}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
