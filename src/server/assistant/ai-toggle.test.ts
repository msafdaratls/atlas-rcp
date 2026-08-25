import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isAssistantAiEnabled } from "./ai-toggle";

const { ASSISTANT_AI_ENABLED, ANTHROPIC_API_KEY } = process.env;

afterEach(() => {
  process.env.ASSISTANT_AI_ENABLED = ASSISTANT_AI_ENABLED;
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
  if (ASSISTANT_AI_ENABLED === undefined) delete process.env.ASSISTANT_AI_ENABLED;
  if (ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
});

describe("isAssistantAiEnabled", () => {
  it("is off when the flag is unset, even with a key present", () => {
    delete process.env.ASSISTANT_AI_ENABLED;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(isAssistantAiEnabled(), false);
  });

  it("is off when the flag is set but the key is missing", () => {
    process.env.ASSISTANT_AI_ENABLED = "true";
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(isAssistantAiEnabled(), false);
  });

  it("is off for any value other than the literal \"true\"", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    for (const value of ["false", "1", "yes", "TRUE", ""]) {
      process.env.ASSISTANT_AI_ENABLED = value;
      assert.equal(isAssistantAiEnabled(), false, `expected off for ${JSON.stringify(value)}`);
    }
  });

  it("is on only with both the flag and the key", () => {
    process.env.ASSISTANT_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    assert.equal(isAssistantAiEnabled(), true);
  });
});
