import { z } from "zod";

export const markNotificationReadSchema = z.object({
  id: z.string().min(1),
});

export const listNotificationsLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100);
