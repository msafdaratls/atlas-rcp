import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { checkPermission, requirePermission } from "@/lib/rbac";
import { storage } from "@/lib/storage";

type Params = { params: Promise<{ key: string[] }> };

const keySegmentSchema = z
  .string()
  .min(1)
  .refine(
    (s) => s !== ".." && !s.includes("..") && !s.includes("/") && !s.includes("\\"),
    { message: "INVALID_SEGMENT" },
  );

const keyPartsSchema = z.array(keySegmentSchema).min(1).max(32);

function isImageMime(mime: string): boolean {
  return (
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp" ||
    mime.startsWith("image/")
  );
}

function mapAuthError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "UNAUTHORIZED";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (message === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

function assertClientOwns(
  session: SessionUser,
  organisationId: string,
  permission: Parameters<typeof requirePermission>[1],
): void {
  if (session.organisationId !== organisationId) {
    throw new Error("FORBIDDEN");
  }
  requirePermission(session, permission);
}

/**
 * Serve stored objects via resource-based auth (document / payment proof / logo).
 * catalogue:manage alone is not enough for Atlas reads.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    const { key: rawParts } = await params;
    const decoded = rawParts.map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const partsParsed = keyPartsSchema.safeParse(decoded);
    if (!partsParsed.success) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }
    const key = partsParsed.data.join("/");

    const isAtlas = session.organisation.type === "ATLAS";
    const isClient = session.organisation.type === "CLIENT";

    const docVersion = await prisma.documentVersion.findFirst({
      where: { storageKey: key },
      select: {
        avStatus: true,
        mimeType: true,
        document: {
          select: {
            request: { select: { organisationId: true } },
          },
        },
      },
    });

    if (docVersion) {
      if (docVersion.avStatus === "INFECTED") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      const orgId = docVersion.document.request.organisationId;
      if (isClient) {
        assertClientOwns(session, orgId, "requests:read");
      } else if (isAtlas) {
        requirePermission(session, "requests:admin");
      } else {
        throw new Error("FORBIDDEN");
      }
    } else {
      const payment = await prisma.payment.findFirst({
        where: { proofStorageKey: key },
        select: { organisationId: true },
      });

      if (payment) {
        if (isClient) {
          assertClientOwns(session, payment.organisationId, "finance:client");
        } else if (isAtlas) {
          requirePermission(session, "finance:admin");
        } else {
          throw new Error("FORBIDDEN");
        }
      } else {
        const org = await prisma.organisation.findFirst({
          where: { logoKey: key },
          select: { id: true },
        });
        if (!org) {
          return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        }
        if (isClient) {
          assertClientOwns(session, org.id, "company:read");
        } else if (isAtlas) {
          if (
            !checkPermission(session, "settings:admin") &&
            !checkPermission(session, "staff:manage")
          ) {
            throw new Error("FORBIDDEN");
          }
        } else {
          throw new Error("FORBIDDEN");
        }
      }
    }

    const object = await storage.get(key);
    if (!object) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // Never serve SVG inline; force attachment. Prefer attachment for non-images.
    const disposition =
      object.mimeType === "image/svg+xml" || !isImageMime(object.mimeType)
        ? "attachment"
        : "inline";

    return new NextResponse(new Uint8Array(object.body), {
      headers: {
        "Content-Type": object.mimeType,
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return mapAuthError(error);
  }
}
