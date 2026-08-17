"use client";

import { useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AssignableStaffUser } from "@/server/admin/queries";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  staff: AssignableStaffUser[];
  placeholder?: string;
  rows?: number;
  locale: "en" | "ar";
  emptyLabel: string;
};

const MAX_SUGGESTIONS = 6;

// Matches a full mention token, e.g. `@Full Name\u2063userId\u2063` — used to
// delete the whole token atomically since its id half is invisible.
const MENTION_SPAN = /@[^\u2063\n]*\u2063[a-zA-Z0-9_-]+\u2063/g;

/** Find the `@query` span (if any) ending at `caret`, scanning left for the triggering `@`. */
function findMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const boundary = i === 0 || /\s/.test(text[i - 1]);
      if (!boundary) return null;
      return { start: i, query: text.slice(i + 1, caret) };
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

export function MentionTextarea({
  id,
  value,
  onChange,
  staff,
  placeholder,
  rows,
  locale,
  emptyLabel,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    const filtered = q
      ? staff.filter(
          (u) =>
            u.fullNameEn.toLowerCase().includes(q) ||
            u.fullNameAr.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q),
        )
      : staff;
    return filtered.slice(0, MAX_SUGGESTIONS);
  }, [trigger, staff]);

  function syncTrigger(text: string, caret: number) {
    const found = findMentionTrigger(text, caret);
    setTrigger(found);
    setActiveIndex(0);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    syncTrigger(next, e.target.selectionStart ?? next.length);
  }

  function insertMention(user: AssignableStaffUser) {
    if (!trigger || !textareaRef.current) return;
    const el = textareaRef.current;
    const caret = el.selectionStart ?? value.length;
    // Wraps the userId in invisible separators so only "@Full Name" is visible
    // while composing; the id stays machine-parseable for extraction/rendering.
    const token = `@${user.fullNameEn}\u2063${user.id}\u2063 `;
    const next = value.slice(0, trigger.start) + token + value.slice(caret);
    onChange(next);
    setTrigger(null);
    const nextCaret = trigger.start + token.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!trigger && e.key === "Backspace") {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? 0;
      if (caret === (el?.selectionEnd ?? caret)) {
        for (const m of value.matchAll(MENTION_SPAN)) {
          const start = m.index ?? 0;
          const end = start + m[0].length;
          if (caret > start && caret <= end) {
            e.preventDefault();
            const next = value.slice(0, start) + value.slice(caret);
            onChange(next);
            requestAnimationFrame(() => el?.setSelectionRange(start, start));
            return;
          }
        }
      }
    }
    if (!trigger || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(matches[activeIndex]);
    } else if (e.key === "Escape") {
      setTrigger(null);
    }
  }

  return (
    <div className="relative">
      <Textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) =>
          syncTrigger(value, e.currentTarget.selectionStart ?? value.length)
        }
        onBlur={() => setTimeout(() => setTrigger(null), 100)}
        placeholder={placeholder}
        rows={rows}
      />
      {trigger && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-line bg-surface shadow-md">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-500">{emptyLabel}</p>
          ) : (
            matches.map((u, i) => (
              <button
                type="button"
                key={u.id}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start text-sm",
                  i === activeIndex ? "bg-atlas-green-tint" : "hover:bg-atlas-green-tint/50",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(u)}
              >
                <span className="font-medium text-ink-900">
                  {locale === "ar" ? u.fullNameAr : u.fullNameEn}
                </span>
                <span className="text-xs text-ink-500">{u.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
