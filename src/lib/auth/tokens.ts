import { createHash, randomBytes } from "node:crypto";
import type { Prisma, VerificationTokenType } from "@prisma/client";

import { prisma } from "@/lib/db";

/** Opaque token: raw value is emailed once; only its SHA-256 is stored. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issues a single-use token of `type` for a user, invalidating any prior
 * unused tokens of the same type. Returns the raw token to embed in the link.
 */
export async function issueVerificationToken(
  userId: string,
  type: VerificationTokenType,
  ttlMs: number,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const db = tx ?? prisma;
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.verificationToken.create({
    data: { userId, type, tokenHash, expiresAt },
  });

  return raw;
}

/**
 * Atomically consumes a token: valid, unused, unexpired, and of `type`.
 * Marks it used and returns the userId, or null if the token is not usable.
 */
export async function consumeVerificationToken(
  raw: string,
  type: VerificationTokenType,
): Promise<string | null> {
  const tokenHash = hashToken(raw);

  return prisma.$transaction(async (tx) => {
    const token = await tx.verificationToken.findUnique({
      where: { tokenHash },
    });
    if (
      !token ||
      token.type !== type ||
      token.usedAt !== null ||
      token.expiresAt.getTime() < Date.now()
    ) {
      return null;
    }
    // Guard against races: only the update that flips usedAt from null wins.
    const claimed = await tx.verificationToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    return token.userId;
  });
}

/**
 * Looks up the owner of a token that already exists (used or not) without
 * consuming it. Used to distinguish "already verified by an earlier request
 * for this same token" (e.g. an email security scanner prefetching the
 * link) from a genuinely invalid/forged token.
 */
export async function getVerificationTokenOwner(
  raw: string,
  type: VerificationTokenType,
): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const token = await prisma.verificationToken.findUnique({
    where: { tokenHash },
  });
  if (!token || token.type !== type) return null;
  return token.userId;
}
