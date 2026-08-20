import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export type AssistantMessageDto = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
};

/** Turns of context kept both for the visible history and for what's sent back to Claude. */
const HISTORY_LIMIT = 20;

/** One growing thread per user (design decision: not per browser session) — reopening the chat resumes it. */
export async function getOrCreateConversation(session: SessionUser) {
  const existing = await prisma.assistantConversation.findUnique({ where: { userId: session.id } });
  if (existing) return existing;
  try {
    return await prisma.assistantConversation.create({
      data: { organisationId: session.organisationId, userId: session.id },
    });
  } catch (error) {
    // Two concurrent first-opens race past the findUnique above — @@unique([userId])
    // rejects the loser; re-read the winner's row instead of failing the turn.
    const code =
      error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    if (code !== "P2002") throw error;
    return prisma.assistantConversation.findUniqueOrThrow({ where: { userId: session.id } });
  }
}

export async function listRecentMessages(conversationId: string): Promise<AssistantMessageDto[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: -HISTORY_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}
