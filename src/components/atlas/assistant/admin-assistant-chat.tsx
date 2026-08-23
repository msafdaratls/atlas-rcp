"use client";

import { AssistantChatPanel } from "@/components/atlas/assistant/assistant-chat-panel";
import { getAdminAssistantHistory, sendAdminAssistantMessage } from "@/server/assistant/admin-actions";

/**
 * Floating admin-console help button — the staff-facing counterpart to
 * AssistantChat, mounted on every /admin/* page (see app-shell.tsx). Same
 * panel UI; the server actions and copy ("adminAssistant" namespace) are
 * what make it a role-aware how-to manual instead of client guidance.
 */
export function AdminAssistantChat() {
  return (
    <AssistantChatPanel
      namespace="adminAssistant"
      historyAction={getAdminAssistantHistory}
      sendAction={sendAdminAssistantMessage}
    />
  );
}
