"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { closeEngagement } from "@/server/admin/engagements";
import { startRequestOnBehalf } from "@/server/requests/on-behalf";
import { FilePlus2, XCircle } from "lucide-react";

export function EngagementActions({
  engagementId,
  status,
  organisationId,
  locale,
}: {
  engagementId: string;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
  organisationId: string;
  locale: string;
}) {
  const t = useTranslations("adminOps.engagements");
  const router = useRouter();
  const [newRequestPending, startNewRequestTransition] = useTransition();
  const [closePending, startCloseTransition] = useTransition();

  function handleNewRequest() {
    startNewRequestTransition(async () => {
      const pinned = await startRequestOnBehalf(organisationId);
      if (!pinned.ok) {
        toast.error(t("errors.SAVE_FAILED"));
        return;
      }
      router.push(`/${locale}/admin/requests/new?engagement=${engagementId}`);
    });
  }

  function handleClose() {
    startCloseTransition(async () => {
      const result = await closeEngagement({ engagementId });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      toast.success(t("closed"));
      router.refresh();
    });
  }

  if (status === "CLOSED") return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={newRequestPending}
        onClick={handleNewRequest}
      >
        <FilePlus2 className="size-4" />
        {t("newRequest")}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={closePending}
        onClick={handleClose}
      >
        <XCircle className="size-4" />
        {t("close")}
      </Button>
    </div>
  );
}
