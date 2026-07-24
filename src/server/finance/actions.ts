"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { mimeAllowed, sniffMime } from "@/lib/mime-sniff";
import { toNumber, parseMoneyInput } from "@/lib/pricing";
import { requirePermission, scopedOrganisationId } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { appendLedgerEntry } from "@/server/finance/ledger";
import { notify } from "@/server/notifications/notify";
import { notificationCopy } from "@/server/notifications/copy";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const recordPaymentSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "CREDIT_NOTE"]),
  reference: z.string().trim().max(120).optional().nullable(),
});

export async function recordClientPayment(
  formData: FormData,
): Promise<ActionResult<{ paymentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:client");
    const orgId = scopedOrganisationId(session);

    const parsed = recordPaymentSchema.safeParse({
      amount: formData.get("amount"),
      method: formData.get("method"),
      reference: formData.get("reference") || null,
    });
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const amount = parseMoneyInput(parsed.data.amount, {
      min: 0.01,
      max: 10_000_000,
    });
    if (!amount) return { ok: false, error: "VALIDATION" };

    const proof = formData.get("proof");
    let proofStorageKey: string | null = null;
    if (proof instanceof File && proof.size > 0) {
      const allowed = [
        "application/pdf",
        "image/png",
        "image/jpeg",
      ] as const;
      if (proof.size > 10 * 1024 * 1024) {
        return { ok: false, error: "FILE_TOO_LARGE" };
      }
      const buffer = Buffer.from(await proof.arrayBuffer());
      const sniffed = sniffMime(buffer);
      if (!mimeAllowed(sniffed, allowed)) {
        return { ok: false, error: "INVALID_PROOF" };
      }
      const stored = await storage.put({
        keyPrefix: `orgs/${orgId}/payments`,
        fileName: proof.name,
        mimeType: sniffed,
        body: buffer,
      });
      proofStorageKey = stored.key;
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          organisationId: orgId,
          amount,
          method: parsed.data.method,
          reference: parsed.data.reference ?? null,
          proofStorageKey,
          status: "PENDING_VERIFICATION",
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: orgId,
          action: "payment.record",
          entityType: "Payment",
          entityId: created.id,
          after: {
            amount: amount.toFixed(2),
            method: parsed.data.method,
            status: "PENDING_VERIFICATION",
          },
        },
      });

      return created;
    });

    revalidatePath("/[locale]/client/statement", "page");
    revalidatePath("/[locale]/admin/finance", "page");
    return { ok: true, data: { paymentId: payment.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const rejectSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export async function rejectPayment(
  input: z.infer<typeof rejectSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:admin");
    const parsed = rejectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findFirst({
        where: { id: parsed.data.paymentId, status: "PENDING_VERIFICATION" },
      });
      if (!existing) throw new Error("NOT_FOUND");

      const updated = await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: "REJECTED",
          rejectReason: parsed.data.reason,
          rejectedAt: new Date(),
          confirmedByUserId: session.id,
        },
      });

      await notify(
        {
          event: "PAYMENT_REJECTED",
          data: {
            organisationId: updated.organisationId,
            link: `/client/statement?payment=${updated.id}`,
            ...notificationCopy("PAYMENT_REJECTED", {
              amount: toNumber(updated.amount).toFixed(2),
              reason: parsed.data.reason,
            }),
          },
        },
        tx,
      );

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: updated.organisationId,
          action: "payment.reject",
          entityType: "Payment",
          entityId: updated.id,
          after: { reason: parsed.data.reason },
        },
      });
    });

    revalidatePath("/[locale]/admin/finance", "page");
    revalidatePath("/[locale]/client/statement", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "NOT_FOUND") {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const confirmSchema = z.object({
  paymentId: z.string().min(1),
  /** If empty, FIFO across open invoices. Partial allowed. */
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().min(1),
        amount: z.union([z.string(), z.number()]),
      }),
    )
    .optional(),
});

export async function confirmPayment(
  input: z.infer<typeof confirmSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:admin");
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id: parsed.data.paymentId, status: "PENDING_VERIFICATION" },
      });
      if (!payment) throw new Error("NOT_FOUND");

      if (parsed.data.allocations && parsed.data.allocations.length > 0) {
        const invoiceIds = parsed.data.allocations.map((a) => a.invoiceId);
        const invoices = await tx.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, organisationId: true, status: true },
        });
        const byId = new Map(invoices.map((inv) => [inv.id, inv]));
        for (const id of invoiceIds) {
          const inv = byId.get(id);
          if (!inv) throw new Error("NOT_FOUND");
          if (inv.organisationId !== payment.organisationId) {
            throw new Error("FORBIDDEN");
          }
          if (inv.status !== "ISSUED" && inv.status !== "PARTIALLY_PAID") {
            throw new Error("INVALID_INVOICE_STATUS");
          }
        }
      }

      let plan: Array<{ invoiceId: string; amount: Prisma.Decimal }> = [];
      if (parsed.data.allocations && parsed.data.allocations.length > 0) {
        for (const a of parsed.data.allocations) {
          const amt = parseMoneyInput(a.amount, { min: 0.01, max: 10_000_000 });
          if (!amt) throw new Error("VALIDATION");
          plan.push({ invoiceId: a.invoiceId, amount: amt });
        }
      } else {
        const openInvoices = await tx.invoice.findMany({
          where: {
            organisationId: payment.organisationId,
            status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          },
          include: { allocations: true },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        });
        let remaining = payment.amount;
        plan = [];
        for (const inv of openInvoices) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const paid = inv.allocations.reduce(
            (a, x) => a.plus(x.amount),
            new Prisma.Decimal(0),
          );
          const open = Prisma.Decimal.max(
            inv.total.minus(paid),
            new Prisma.Decimal(0),
          );
          const take = Prisma.Decimal.min(open, remaining).toDecimalPlaces(2);
          if (take.greaterThan(0)) {
            plan.push({ invoiceId: inv.id, amount: take });
            remaining = remaining.minus(take).toDecimalPlaces(2);
          }
        }
      }

      const allocSum = plan.reduce(
        (a, x) => a.plus(x.amount),
        new Prisma.Decimal(0),
      );
      if (allocSum.minus(payment.amount).greaterThan(new Prisma.Decimal("0.001"))) {
        throw new Error("ALLOCATION_EXCEEDS_PAYMENT");
      }

      await appendLedgerEntry(tx, {
        organisationId: payment.organisationId,
        type: "PAYMENT",
        referenceType: "Payment",
        referenceId: payment.id,
        debit: 0,
        credit: payment.amount,
        descriptionEn: `Payment confirmed${payment.reference ? ` · ${payment.reference}` : ""}`,
        descriptionAr: `تأكيد دفعة${payment.reference ? ` · ${payment.reference}` : ""}`,
        createdByUserId: session.id,
      });

      for (const line of plan) {
        const inv = await tx.invoice.findUnique({
          where: { id: line.invoiceId },
          include: { allocations: true },
        });
        if (!inv) throw new Error("NOT_FOUND");

        const alreadyPaid = inv.allocations.reduce(
          (a, x) => a.plus(x.amount),
          new Prisma.Decimal(0),
        );
        const open = inv.total.minus(alreadyPaid);
        if (line.amount.greaterThan(open.plus(new Prisma.Decimal("0.001")))) {
          throw new Error("ALLOCATION_EXCEEDS_PAYMENT");
        }

        await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: line.invoiceId,
            amount: line.amount.toDecimalPlaces(2),
          },
        });

        const paidAfter = alreadyPaid.plus(line.amount);
        const status = paidAfter.greaterThanOrEqualTo(inv.total)
          ? "PAID"
          : "PARTIALLY_PAID";
        await tx.invoice.update({
          where: { id: inv.id },
          data: { status },
        });
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "CONFIRMED",
          confirmedByUserId: session.id,
          confirmedAt: new Date(),
        },
      });

      await notify(
        {
          event: "PAYMENT_RECEIVED",
          data: {
            organisationId: payment.organisationId,
            link:
              plan[0] != null
                ? `/client/statement?invoice=${plan[0].invoiceId}`
                : `/client/statement?payment=${payment.id}`,
            ...notificationCopy("PAYMENT_RECEIVED", {
              amount: toNumber(payment.amount).toFixed(2),
            }),
          },
        },
        tx,
      );

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: payment.organisationId,
          action: "payment.confirm",
          entityType: "Payment",
          entityId: payment.id,
          after: {
            allocations: plan.map((p) => ({
              invoiceId: p.invoiceId,
              amount: p.amount.toString(),
            })),
          },
        },
      });
    });

    revalidatePath("/[locale]/admin/finance", "page");
    revalidatePath("/[locale]/client/statement", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (
      message === "UNAUTHORIZED" ||
      message === "FORBIDDEN" ||
      message === "NOT_FOUND" ||
      message === "ALLOCATION_EXCEEDS_PAYMENT" ||
      message === "VALIDATION" ||
      message === "INVALID_INVOICE_STATUS"
    ) {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const creditLimitSchema = z.object({
  organisationId: z.string().min(1),
  creditLimit: z.union([z.string(), z.number()]),
  autoHoldWhenOverLimit: z.boolean(),
});

export async function updateClientCreditLimit(
  input: z.infer<typeof creditLimitSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:admin");
    const parsed = creditLimitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const creditLimit = parseMoneyInput(parsed.data.creditLimit, {
      min: 0,
      max: 100_000_000,
    });
    if (!creditLimit) return { ok: false, error: "VALIDATION" };

    const org = await prisma.organisation.findFirst({
      where: { id: parsed.data.organisationId, type: "CLIENT" },
    });
    if (!org) return { ok: false, error: "NOT_FOUND" };

    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        creditLimit,
        autoHoldWhenOverLimit: parsed.data.autoHoldWhenOverLimit,
      },
    });

    await writeAuditLog({
      session,
      organisationId: org.id,
      action: "organisation.creditLimit",
      entityType: "Organisation",
      entityId: org.id,
      before: {
        creditLimit: toNumber(org.creditLimit),
        autoHoldWhenOverLimit: org.autoHoldWhenOverLimit,
      },
      after: {
        creditLimit: creditLimit.toFixed(2),
        autoHoldWhenOverLimit: parsed.data.autoHoldWhenOverLimit,
      },
    });

    revalidatePath("/[locale]/admin/finance", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const adjustmentSchema = z.object({
  organisationId: z.string().min(1),
  type: z.enum(["ADJUSTMENT", "CREDIT_NOTE", "REFUND", "WRITE_OFF"]),
  amount: z.union([z.string(), z.number()]),
  /** For ADJUSTMENT: debit increases what client owes; credit decreases. CREDIT_NOTE/REFUND always credit; WRITE_OFF credits. */
  side: z.enum(["debit", "credit"]).default("credit"),
  reasonEn: z.string().trim().min(5).max(500),
  reasonAr: z.string().trim().min(5).max(500),
});

export async function postManualLedgerEntry(
  input: z.infer<typeof adjustmentSchema>,
): Promise<ActionResult<{ entryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:admin");
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const amount = parseMoneyInput(parsed.data.amount, {
      min: 0.01,
      max: 10_000_000,
    });
    if (!amount) return { ok: false, error: "VALIDATION" };

    const org = await prisma.organisation.findFirst({
      where: { id: parsed.data.organisationId, type: "CLIENT" },
    });
    if (!org) return { ok: false, error: "NOT_FOUND" };

    const forceCredit =
      parsed.data.type === "CREDIT_NOTE" ||
      parsed.data.type === "REFUND" ||
      parsed.data.type === "WRITE_OFF";
    const side = forceCredit ? "credit" : parsed.data.side;

    const entry = await prisma.$transaction(async (tx) => {
      const created = await appendLedgerEntry(tx, {
        organisationId: org.id,
        type: parsed.data.type,
        referenceType: "Manual",
        referenceId: `manual-${Date.now()}`,
        debit: side === "debit" ? amount : 0,
        credit: side === "credit" ? amount : 0,
        descriptionEn: parsed.data.reasonEn,
        descriptionAr: parsed.data.reasonAr,
        createdByUserId: session.id,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: org.id,
          action: "ledger.manual",
          entityType: "LedgerEntry",
          entityId: created.id,
          after: {
            type: parsed.data.type,
            amount: toNumber(amount),
            side,
            reasonEn: parsed.data.reasonEn,
            reasonAr: parsed.data.reasonAr,
          },
        },
      });

      return created;
    });

    revalidatePath("/[locale]/admin/finance", "page");
    revalidatePath("/[locale]/client/statement", "page");
    return { ok: true, data: { entryId: entry.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
