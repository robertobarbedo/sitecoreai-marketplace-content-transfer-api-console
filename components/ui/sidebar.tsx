import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Menu primitives of the Blok Sidebar (https://blok.sitecore.com/primitives/sidebar),
 * without the app-shell parts (provider, fixed/off-canvas container, cookie,
 * keyboard shortcut, mobile sheet) — for in-content navigation such as a
 * tab's own sidebar. Classes follow the Blok registry source, with its
 * `--color-neutral-100` / `text-subtle-text` mapped to this app's tokens.
 */

function SidebarNav({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="sidebar"
      className={cn(
        "flex w-full flex-col gap-4 rounded-xl border border-border-muted bg-white px-2 py-4",
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "flex shrink-0 items-center rounded-md pl-3 text-sm font-semibold uppercase text-text-subtle [&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/menu-item relative flex min-h-10 items-center", className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex h-full w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2.5 text-left font-medium text-neutral-fg outline-hidden ring-primary/50 transition-colors bg-transparent hover:bg-neutral-bg hover:text-neutral-fg focus-visible:ring-2 active:bg-primary-bg active:text-primary-fg disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-primary-bg data-[active=true]:text-primary-fg [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      size: {
        default: "text-sm",
        sm: "text-xs",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function SidebarMenuButton({
  isActive = false,
  size,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  isActive?: boolean;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      className={cn(sidebarMenuButtonVariants({ size }), className)}
      {...props}
    />
  );
}

export {
  SidebarNav,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
};
