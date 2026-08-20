/**
 * Shared between the server action (validation backstop) and the client
 * component (Textarea maxLength) — kept out of actions.ts because a "use
 * server" file may only export async functions.
 */
export const MAX_MESSAGE_LENGTH = 2000;
