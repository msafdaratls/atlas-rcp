import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessageDto } from "./queries";
import { trimForModel } from "./history-window";

function msg(role: "USER" | "ASSISTANT", id: string): AssistantMessageDto {
  return { id, role, content: id, createdAt: new Date().toISOString() };
}

describe("trimForModel", () => {
  it("returns the whole history unchanged when under the limit", () => {
    const history = [msg("USER", "u1"), msg("ASSISTANT", "a1")];
    assert.deepEqual(trimForModel(history, 10), history);
  });

  it("keeps the slice starting on USER when the cut lands on an even boundary", () => {
    const history = [msg("USER", "u1"), msg("ASSISTANT", "a1"), msg("USER", "u2"), msg("ASSISTANT", "a2")];
    const result = trimForModel(history, 2);
    assert.deepEqual(
      result.map((m) => m.id),
      ["u2", "a2"],
    );
  });

  it("drops a leading ASSISTANT message so the result always starts on USER", () => {
    // 5 messages, last 4 would start on ASSISTANT (a1) — must drop it.
    const history = [
      msg("USER", "u0"),
      msg("ASSISTANT", "a0"),
      msg("USER", "u1"),
      msg("ASSISTANT", "a1"),
      msg("USER", "u2"),
    ];
    const result = trimForModel(history, 4);
    assert.equal(result[0]?.role, "USER");
    assert.deepEqual(
      result.map((m) => m.id),
      ["u1", "a1", "u2"],
    );
  });
});
