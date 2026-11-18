"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  mdiChevronRight,
  mdiChevronDown,
  mdiLoading,
  mdiFileDocumentOutline,
  mdiAlertCircle,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
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
import { fetchItemChildren } from "@/src/utils/environment-client";
import type { EnvironmentConnection } from "@/src/types/transfer";

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

/** One item picked in multi-select mode. */
export interface PickedTreeItem {
  path: string;
  includeSubitems: boolean;
}

interface TreePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Environment whose content tree is browsed. */
  source: EnvironmentConnection;
  /** Database to browse, e.g. "master". */
  database: string;
  /**
   * `includeSubitems` is the "All subitems" switch shown next to the
   * selected item (only with `showSubitemsToggle`; always true otherwise).
   */
  onSelect: (path: string, includeSubitems: boolean) => void;
  /** Show the "All subitems" switch next to the selected item (default on). */
  showSubitemsToggle?: boolean;
  /**
   * Multi-select mode: every item gets a checkbox and several items can be
   * picked before closing. Confirming calls this (in the order the items
   * were checked) instead of `onSelect`.
   */
  onSelectMany?: (items: PickedTreeItem[]) => void;
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
  showSubitemsToggle = false,
  onSelectMany,
}: TreePickerDialogProps) {
  const multiSelect = Boolean(onSelectMany);
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [includeSubitems, setIncludeSubitems] = useState(true);
  // Multi-select: checked path -> its "All subitems" switch, in check order.
  const [checked, setChecked] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);

  const fetchChildren = useCallback(
    (path: string) =>
      fetchItemChildren(source, path, database.trim() || "master"),
    [source, database],
  );

  // Load the root when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRoot(null);
    setSelectedPath(null);
    setIncludeSubitems(true);
    setChecked(new Map());
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

  /** Multi-select: checking adds the item (subitems on), unchecking drops it. */
  const toggleChecked = (path: string) =>
    setChecked((prev) => {
      const next = new Map(prev);
      if (next.has(path)) next.delete(path);
      else next.set(path, true);
      return next;
    });

  const setCheckedSubitems = (path: string, value: boolean) =>
    setChecked((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.set(path, value);
      return next;
    });

  const checkedPaths = Array.from(checked.keys());
  const canConfirm = multiSelect
    ? checkedPaths.length > 0
    : Boolean(selectedPath);

  const handleConfirm = () => {
    if (multiSelect) {
      if (checkedPaths.length === 0) return;
      onSelectMany?.(
        Array.from(checked, ([path, subitems]) => ({
          path,
          includeSubitems: showSubitemsToggle ? subitems : true,
        })),
      );
      onOpenChange(false);
      return;
    }
    if (!selectedPath) return;
    onSelect(selectedPath, showSubitemsToggle ? includeSubitems : true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {multiSelect ? "Select items" : "Select an item"} from{" "}
            {source.label}
          </DialogTitle>
          <DialogDescription>
            Browsing the <span className="font-mono">{database.trim() || "master"}</span>{" "}
            database of the source environment.{" "}
            {multiSelect
              ? "Check every item you need — each one fills its own path line. Use the chevrons to expand."
              : "Click an item to select it, use the chevrons to expand."}
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
              onSelect={multiSelect ? toggleChecked : setSelectedPath}
              checked={multiSelect ? checked : undefined}
              onCheck={toggleChecked}
              renderCheckedExtra={
                multiSelect && showSubitemsToggle
                  ? (path) => (
                      <SubitemsToggle
                        checked={checked.get(path) ?? true}
                        onChange={(value) => setCheckedSubitems(path, value)}
                      />
                    )
                  : undefined
              }
              selectedExtra={
                !multiSelect && showSubitemsToggle ? (
                  <SubitemsToggle
                    checked={includeSubitems}
                    onChange={setIncludeSubitems}
                  />
                ) : undefined
              }
            />
          ) : null}
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-danger-fg">
            <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {multiSelect ? (
          <div className="flex items-center gap-2 rounded-lg bg-neutral-bg px-3 py-2 text-xs text-neutral-fg">
            <span className="shrink-0 font-semibold">
              {checkedPaths.length === 0
                ? "No items selected"
                : `${checkedPaths.length} item${checkedPaths.length === 1 ? "" : "s"} selected`}
            </span>
            {checkedPaths.length > 0 && (
              <button
                type="button"
                onClick={() => setChecked(new Map())}
                className="ml-auto shrink-0 cursor-pointer underline hover:text-on-surface"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <div className="truncate rounded-lg bg-neutral-bg px-3 py-2 font-mono text-xs text-neutral-fg">
            {selectedPath ?? "No item selected"}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {multiSelect && checkedPaths.length > 1
              ? `Use these ${checkedPaths.length} paths`
              : "Use this path"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "All subitems: on/off" switch shown next to the selected item: on = the
 * item and its descendants, off = the single item only.
 */
function SubitemsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="All subitems"
      title={
        checked
          ? "Includes the item and all its subitems"
          : "Includes only this item"
      }
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-md text-xs"
    >
      <span>
        All subitems:{" "}
        <span className="font-semibold">{checked ? "on" : "off"}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-neutral-bg-active",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

function TreeNodeRow({
  node,
  depth,
  selectedPath,
  onToggle,
  onSelect,
  selectedExtra,
  checked,
  onCheck,
  renderCheckedExtra,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onToggle: (node: TreeNode) => void;
  onSelect: (path: string) => void;
  /** Rendered at the end of the selected row. */
  selectedExtra?: ReactNode;
  /** Multi-select mode: the checked paths (undefined = no checkboxes). */
  checked?: Map<string, boolean>;
  onCheck?: (path: string) => void;
  /** Multi-select mode: rendered at the end of each checked row. */
  renderCheckedExtra?: (path: string) => ReactNode;
}) {
  const multiSelect = checked !== undefined;
  const isChecked = checked?.has(node.path) ?? false;
  const selected = multiSelect ? isChecked : selectedPath === node.path;

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
        {multiSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={isChecked}
            aria-label={`Select ${node.name}`}
            onClick={() => onCheck?.(node.path)}
            className={cn(
              "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded",
              isChecked
                ? "text-primary"
                : "text-text-subtle hover:text-on-surface",
            )}
          >
            <Icon
              path={isChecked ? mdiCheckboxMarked : mdiCheckboxBlankOutline}
              size={0.75}
            />
          </button>
        )}
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
        {!multiSelect && selected && selectedExtra && (
          <div className="ml-auto shrink-0 pl-3">{selectedExtra}</div>
        )}
        {multiSelect && isChecked && renderCheckedExtra && (
          <div className="ml-auto shrink-0 pl-3">
            {renderCheckedExtra(node.path)}
          </div>
        )}
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
                selectedExtra={selectedExtra}
                checked={checked}
                onCheck={onCheck}
                renderCheckedExtra={renderCheckedExtra}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
