"use client";

import { AssistantChatPanel } from "@/components/atlas/assistant/assistant-chat-panel";
import { getAssistantHistory, sendAssistantMessage } from "@/server/assistant/actions";

/**
 * Floating client-portal help button (design decision: client portal only,
 * every page, generic catalog-wide guidance — see conversation). Loads
 * history lazily on first open, not on every page load.
 */
export function AssistantChat() {
  return (
    <AssistantChatPanel namespace="assistant" historyAction={getAssistantHistory} sendAction={sendAssistantMessage} />
  );
}
