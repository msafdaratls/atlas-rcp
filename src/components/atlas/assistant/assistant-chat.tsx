"use client";

import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getAssistantHistory, sendAssistantMessage } from "@/server/assistant/actions";
import { MAX_MESSAGE_LENGTH } from "@/server/assistant/constants";
import type { AssistantMessageDto } from "@/server/assistant/queries";

type ErrorCode = "EMPTY" | "TOO_LONG" | "UNAUTHORIZED" | "FORBIDDEN" | "FAILED";

function errorKey(code: string): `errors.${ErrorCode}` {
  return (["EMPTY", "TOO_LONG", "UNAUTHORIZED", "FORBIDDEN", "FAILED"] as const).includes(code as ErrorCode)
    ? (`errors.${code as ErrorCode}` as const)
    : "errors.FAILED";
}

/**
 * Floating client-portal help button (design decision: client portal only,
 * every page, generic catalog-wide guidance — see conversation). Loads
 * history lazily on first open, not on every page load.
 */
export function AssistantChat() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [messages, setMessages] = useState<AssistantMessageDto[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fetchingHistoryRef = useRef(false);

  useEffect(() => {
    if (!open || historyLoaded || fetchingHistoryRef.current) return;
    fetchingHistoryRef.current = true;
    startTransition(async () => {
      const result = await getAssistantHistory();
      fetchingHistoryRef.current = false;
      if (!result.ok) {
        // historyLoaded stays false so closing and reopening the panel retries.
        toast.error(t(errorKey(result.error)));
        return;
      }
      setHistoryLoaded(true);
      setMessages(result.data);
    });
  }, [open, historyLoaded, t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function handleSend() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `pending-${Date.now()}`, role: "USER", content: text, createdAt: new Date().toISOString() },
    ]);
    startTransition(async () => {
      const result = await sendAssistantMessage({ text });
      if (!result.ok) {
        toast.error(t(errorKey(result.error)));
        return;
      }
      setMessages(result.data);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const starterPrompts = t.raw("starterPrompts") as string[];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openButtonLabel")}
        className="fixed bottom-6 end-6 z-40 flex size-14 items-center justify-center rounded-full bg-[var(--atlas-green)] text-white shadow-elevation transition-transform hover:scale-105 hover:bg-[var(--atlas-green-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--atlas-green)] focus-visible:ring-offset-2"
      >
        <MessageCircle className="size-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="end" className="flex w-[min(100%,26rem)] flex-col p-0">
          <SheetTitle className="sr-only">{t("panelTitle")}</SheetTitle>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">{t("panelTitle")}</p>
              <p className="text-xs text-ink-500">{t("panelSubtitle")}</p>
            </div>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("closeLabel")}>
                <X className="size-4" />
              </Button>
            </SheetClose>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !pending ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{t("emptyTitle")}</p>
                  <p className="mt-1 text-sm text-ink-500">{t("emptyBody")}</p>
                </div>
                <div className="space-y-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="block w-full rounded-lg border border-line bg-surface-alt px-3 py-2 text-start text-sm text-ink-800 hover:bg-atlas-green-tint"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "USER" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                    m.role === "USER"
                      ? "bg-[var(--atlas-green)] text-white"
                      : "border border-line bg-surface-alt text-ink-900",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {pending ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm text-ink-500">
                  <Loader2 className="size-4 animate-spin" />
                  {t("thinking")}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-line px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("placeholder")}
                rows={2}
                disabled={pending}
                maxLength={MAX_MESSAGE_LENGTH}
                className="min-h-0 resize-none text-sm"
              />
              <Button
                type="button"
                size="icon"
                onClick={handleSend}
                disabled={pending || input.trim().length === 0}
                aria-label={t("send")}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-500">{t("disclaimer")}</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
