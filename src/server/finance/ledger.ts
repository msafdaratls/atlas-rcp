/**
 * Ledger service — APPEND ONLY.
 *
 * LedgerEntry rows are never updated or deleted. A correction is always a new
 * reversing entry that references the original via `reversesEntryId` (and usually
 * swaps debit/credit). Do not add update/delete helpers to this module or any
 * "repository" wrapper around it.
 */
import { Prisma, type LedgerEntryType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TxClient } from "@/server/notifications/recipients";

export type AppendLedgerInput = {
  organisationId: string;
  type: LedgerEntryType;
  referenceType: string;
  referenceId: string;
  debit: Prisma.Decimal | number | string;
  credit: Prisma.Decimal | number | string;
  descriptionEn: string;
  descriptionAr: string;
  createdByUserId: string;
  entryDate?: Date;
  reversesEntryId?: string;
};

export async function appendLedgerEntry(
  tx: TxClient,
  input: AppendLedgerInput,
) {
  const debit = new Prisma.Decimal(input.debit).toDecimalPlaces(2);
  const credit = new Prisma.Decimal(input.credit).toDecimalPlaces(2);
  if (debit.isNegative() || credit.isNegative()) {
    throw new Error("LEDGER_NEGATIVE_AMOUNT");
  }
  if (debit.isZero() && credit.isZero()) {
    throw new Error("LEDGER_ZERO_ENTRY");
  }
  if (!debit.isZero() && !credit.isZero()) {
    throw new Error("LEDGER_BOTH_SIDES");
  }

  return tx.ledgerEntry.create({
    data: {
      organisationId: input.organisationId,
      type: input.type,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      debit,
      credit,
      descriptionEn: input.descriptionEn,
      descriptionAr: input.descriptionAr,
      createdByUserId: input.createdByUserId,
      entryDate: input.entryDate ?? new Date(),
      reversesEntryId: input.reversesEntryId,
    },
  });
}

/**
 * Creates a reversing entry: original debit→credit and credit→debit.
 * Intentional ledger-correction API — keep even if unused by UI today.
 */
export async function appendReversingEntry(
  tx: TxClient,
  input: {
    originalEntryId: string;
    createdByUserId: string;
    reasonEn: string;
    reasonAr: string;
    type?: LedgerEntryType;
  },
) {
  const original = await tx.ledgerEntry.findUnique({
    where: { id: input.originalEntryId },
  });
  if (!original) throw new Error("LEDGER_NOT_FOUND");

  return appendLedgerEntry(tx, {
    organisationId: original.organisationId,
    type: input.type ?? "ADJUSTMENT",
    referenceType: "LedgerEntry",
    referenceId: original.id,
    debit: original.credit,
    credit: original.debit,
    descriptionEn: input.reasonEn,
    descriptionAr: input.reasonAr,
    createdByUserId: input.createdByUserId,
    reversesEntryId: original.id,
  });
}

export function sumBalance(
  entries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>,
): Prisma.Decimal {
  return entries
    .reduce(
      (acc, row) => acc.plus(row.debit).minus(row.credit),
      new Prisma.Decimal(0),
    )
    .toDecimalPlaces(2);
}

/**
 * Balance for one or more organisations computed via a DB-side SUM, not by
 * pulling every LedgerEntry row into JS. Use this instead of
 * `sumBalance(org.ledgerEntries)` anywhere a full-history `include` would
 * otherwise be fetched — that pattern is O(all-time rows) per organisation
 * and gets slower every month as the ledger grows.
 */
export async function getOrganisationBalances(
  organisationIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const map = new Map<string, Prisma.Decimal>();
  if (organisationIds.length === 0) return map;

  const rows = await prisma.ledgerEntry.groupBy({
    by: ["organisationId"],
    where: { organisationId: { in: organisationIds } },
    _sum: { debit: true, credit: true },
  });

  for (const row of rows) {
    const debit = row._sum.debit ?? new Prisma.Decimal(0);
    const credit = row._sum.credit ?? new Prisma.Decimal(0);
    map.set(row.organisationId, debit.minus(credit).toDecimalPlaces(2));
  }
  return map;
}

/** Single-organisation convenience wrapper around {@link getOrganisationBalances}. */
export async function getOrganisationBalance(
  organisationId: string,
): Promise<Prisma.Decimal> {
  const map = await getOrganisationBalances([organisationId]);
  return map.get(organisationId) ?? new Prisma.Decimal(0);
}
