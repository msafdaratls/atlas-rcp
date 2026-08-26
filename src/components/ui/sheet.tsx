"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Sheet({ ...props }: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof Dialog.Portal>) {
  return <Dialog.Portal {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Overlay>) {
  return (
    <Dialog.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-ink-900/40 data-[state=open]:animate-in data-[state=closed]:animate-out",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "start",
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  side?: "start" | "end";
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <Dialog.Content
        className={cn(
          "fixed inset-y-0 z-50 flex h-full w-[min(100%,20rem)] flex-col overflow-y-auto overscroll-contain border-line bg-surface shadow-elevation duration-150 ease-out",
          side === "start"
            ? "start-0 border-e data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-right"
            : "end-0 border-s data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-left rtl:data-[state=open]:slide-in-from-left",
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Content>
    </SheetPortal>
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      className={cn("text-base font-semibold text-ink-900", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetOverlay,
  SheetPortal,
};
