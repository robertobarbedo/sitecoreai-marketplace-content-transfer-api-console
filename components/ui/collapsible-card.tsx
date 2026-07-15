"use client";

import { useEffect, useRef, useState } from "react";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { Icon } from "@/lib/icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Card whose content can be expanded/collapsed from the header. When `done`
 * turns true the card collapses itself (the run is over, keep the page
 * compact) — the user can always re-expand it.
 */
export function CollapsibleCard({
  icon,
  title,
  description,
  done = false,
  contentClassName,
  children,
}: {
  icon: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  done?: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const prevDone = useRef(done);
  useEffect(() => {
    if (done && !prevDone.current) setOpen(false);
    prevDone.current = done;
  }, [done]);

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-start gap-2 text-left"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Icon path={icon} size={0.8} />
              {title}
            </CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <Icon
            path={open ? mdiChevronUp : mdiChevronDown}
            size={0.9}
            className="shrink-0 text-text-subtle"
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className={cn(contentClassName)}>{children}</CardContent>
      )}
    </Card>
  );
}
