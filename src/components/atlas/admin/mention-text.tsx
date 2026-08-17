import { Fragment } from "react";

// Matches both the legacy `@[Name](userId)` token (comments saved before the
// hidden-id encoding) and the current token, where the userId is wrapped in
// U+2063 INVISIBLE SEPARATOR characters so it never renders while composing.
const MENTION_TOKEN =
  /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)|@([^\u2063\n]+)\u2063([a-zA-Z0-9_-]+)\u2063/g;

type MentionRef = { userId: string; nameEn: string; nameAr: string };

/** Render a note body, replacing mention tokens with highlighted mention chips. */
export function renderMentionBody(
  body: string,
  mentions: MentionRef[],
  locale: "en" | "ar",
) {
  const byId = new Map(mentions.map((m) => [m.userId, m]));
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of body.matchAll(MENTION_TOKEN)) {
    const [full, bracketName, bracketId, hiddenName, hiddenId] = match;
    const fallbackName = bracketName ?? hiddenName;
    const userId = bracketId ?? hiddenId;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(
        <Fragment key={key++}>{body.slice(lastIndex, index)}</Fragment>,
      );
    }
    const mention = byId.get(userId);
    const name = mention
      ? locale === "ar"
        ? mention.nameAr
        : mention.nameEn
      : fallbackName;
    nodes.push(
      <span
        key={key++}
        className="rounded bg-atlas-green-tint px-1 font-medium text-atlas-green-600"
      >
        @{name}
      </span>,
    );
    lastIndex = index + full.length;
  }

  if (lastIndex < body.length) {
    nodes.push(<Fragment key={key++}>{body.slice(lastIndex)}</Fragment>);
  }

  return nodes;
}
