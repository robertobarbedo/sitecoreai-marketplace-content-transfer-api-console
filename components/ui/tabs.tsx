"use client";

import { type VariantProps, cva } from "class-variance-authority";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "@/lib/utils";

const tabsListVariants = cva(
  "inline-flex h-9 w-fit items-center justify-center",
  {
    variants: {
      variant: {
        line: "",
        "soft-rounded": "",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

const tabsTriggerVariants = cva(
  "inline-flex h-9 items-center justify-center gap-1.5 text-md font-medium whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        line: "text-on-surface-variant data-[state=active]:text-primary border-b-2 border-border-muted data-[state=active]:border-primary hover:cursor-pointer px-4",
        "soft-rounded":
          "text-neutral-fg data-[state=active]:text-primary-fg data-[state=active]:bg-primary-bg hover:cursor-pointer px-4 rounded-[9999px]",
      },
    },
    defaultVariants: {
      variant: "line",
    },
  },
);

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn(className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> &
  VariantProps<typeof tabsTriggerVariants>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-6 data-[state=inactive]:hidden", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
