import { Fragment } from "react";

const MENTION_TOKEN = /@\[([^\]]+)\]\(([a-zA-Z0-9_-]+)\)/g;

type MentionRef = { userId: string; nameEn: string; nameAr: string };

/** Render a note body, replacing `@[Name](userId)` tokens with highlighted mention chips. */
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
    const [full, fallbackName, userId] = match;
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
