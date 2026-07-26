import type { CommentDirection, Prisma } from "@prisma/client";
import type { NotificationEventType } from "@/lib/notification-events";

export type TxClient = Prisma.TransactionClient;

export type NotifyContext = {
  organisationId?: string;
  requestId?: string;
  createdByUserId?: string;
  assignedToUserId?: string | null;
  commentDirection?: CommentDirection;
};

async function activeUsersByRoles(
  tx: TxClient,
  roles: string[],
  organisationType: "ATLAS" | "CLIENT",
  organisationId?: string,
) {
  return tx.user.findMany({
    where: {
      status: "ACTIVE",
      ...(organisationId ? { organisationId } : {}),
      organisation: { type: organisationType },
      roles: { some: { role: { in: roles as never[] } } },
    },
    select: {
      id: true,
      email: true,
      locale: true,
      fullNameEn: true,
      fullNameAr: true,
    },
  });
}

export async function resolveRecipients(
  tx: TxClient,
  event: NotificationEventType,
  ctx: NotifyContext,
  explicit?: string[],
): Promise<
  Array<{
    id: string;
    email: string;
    locale: string;
    fullNameEn: string;
    fullNameAr: string;
  }>
> {
  if (explicit && explicit.length > 0) {
    return tx.user.findMany({
      where: { id: { in: explicit }, status: "ACTIVE" },
      select: {
        id: true,
        email: true,
        locale: true,
        fullNameEn: true,
        fullNameAr: true,
      },
    });
  }

  switch (event) {
    case "REQUEST_SUBMITTED":
    case "REQUEST_RESUBMITTED":
      return activeUsersByRoles(tx, ["INTAKE_OFFICER"], "ATLAS");

    case "REQUEST_RECEIVED": {
      const ids = new Set<string>();
      if (ctx.createdByUserId) ids.add(ctx.createdByUserId);
      if (ctx.organisationId) {
        const owners = await activeUsersByRoles(
          tx,
          ["CLIENT_OWNER"],
          "CLIENT",
          ctx.organisationId,
        );
        for (const o of owners) ids.add(o.id);
      }
      if (ids.size === 0) return [];
      return tx.user.findMany({
        where: { id: { in: [...ids] }, status: "ACTIVE" },
        select: {
          id: true,
          email: true,
          locale: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      });
    }

    case "REQUEST_RETURNED":
    case "REPORT_ISSUED": {
      const ids = new Set<string>();
      if (ctx.createdByUserId) ids.add(ctx.createdByUserId);
      if (ctx.organisationId) {
        const owners = await activeUsersByRoles(
          tx,
          ["CLIENT_OWNER"],
          "CLIENT",
          ctx.organisationId,
        );
        for (const o of owners) ids.add(o.id);
      }
      if (ids.size === 0) return [];
      return tx.user.findMany({
        where: { id: { in: [...ids] }, status: "ACTIVE" },
        select: {
          id: true,
          email: true,
          locale: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      });
    }

    case "REQUEST_ACCEPTED":
      if (!ctx.createdByUserId) return [];
      return tx.user.findMany({
        where: { id: ctx.createdByUserId, status: "ACTIVE" },
        select: {
          id: true,
          email: true,
          locale: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      });

    case "REQUEST_ASSIGNED":
      if (!ctx.assignedToUserId) return [];
      return tx.user.findMany({
        where: { id: ctx.assignedToUserId, status: "ACTIVE" },
        select: {
          id: true,
          email: true,
          locale: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      });

    case "INVOICE_ISSUED": {
      if (!ctx.organisationId) return [];
      return activeUsersByRoles(
        tx,
        ["CLIENT_FINANCE", "CLIENT_OWNER"],
        "CLIENT",
        ctx.organisationId,
      );
    }

    case "PAYMENT_RECEIVED": {
      const clientSide = ctx.organisationId
        ? await activeUsersByRoles(
            tx,
            ["CLIENT_FINANCE", "CLIENT_OWNER"],
            "CLIENT",
            ctx.organisationId,
          )
        : [];
      const atlasFinance = await activeUsersByRoles(tx, ["FINANCE"], "ATLAS");
      const map = new Map(clientSide.map((u) => [u.id, u]));
      for (const u of atlasFinance) map.set(u.id, u);
      return [...map.values()];
    }

    case "SLA_AT_RISK":
    case "SLA_BREACHED": {
      const ids = new Set<string>();
      if (ctx.assignedToUserId) ids.add(ctx.assignedToUserId);
      const managers = await activeUsersByRoles(
        tx,
        ["SYSTEM_ADMIN", "QUALITY_MANAGER"],
        "ATLAS",
      );
      for (const m of managers) ids.add(m.id);
      if (ids.size === 0) return [];
      return tx.user.findMany({
        where: { id: { in: [...ids] }, status: "ACTIVE" },
        select: {
          id: true,
          email: true,
          locale: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      });
    }

    case "COMMENT_ADDED": {
      if (ctx.commentDirection === "ATLAS_TO_CLIENT") {
        const ids = new Set<string>();
        if (ctx.createdByUserId) ids.add(ctx.createdByUserId);
        if (ctx.organisationId) {
          const owners = await activeUsersByRoles(
            tx,
            ["CLIENT_OWNER"],
            "CLIENT",
            ctx.organisationId,
          );
          for (const o of owners) ids.add(o.id);
        }
        if (ids.size === 0) return [];
        return tx.user.findMany({
          where: { id: { in: [...ids] }, status: "ACTIVE" },
          select: {
            id: true,
            email: true,
            locale: true,
            fullNameEn: true,
            fullNameAr: true,
          },
        });
      }
      if (ctx.commentDirection === "CLIENT_TO_ATLAS") {
        if (ctx.assignedToUserId) {
          return tx.user.findMany({
            where: { id: ctx.assignedToUserId, status: "ACTIVE" },
            select: {
              id: true,
              email: true,
              locale: true,
              fullNameEn: true,
              fullNameAr: true,
            },
          });
        }
        return activeUsersByRoles(tx, ["INTAKE_OFFICER"], "ATLAS");
      }
      return [];
    }

    case "PAYMENT_REJECTED":
    case "STATEMENT_OVERDUE":
    case "CREDIT_LIMIT": {
      if (!ctx.organisationId) return [];
      return activeUsersByRoles(
        tx,
        ["CLIENT_FINANCE", "CLIENT_OWNER"],
        "CLIENT",
        ctx.organisationId,
      );
    }

    default:
      return [];
  }
}
