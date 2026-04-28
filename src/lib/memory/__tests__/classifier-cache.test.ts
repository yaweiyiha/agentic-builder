/**
 * R1-R5 coverage for classification cache (Phase B).
 *
 * The LLM client is mocked — each test sets `mockResponse` to control what
 * `chatCompletion` returns, and asserts on call counts to verify cache
 * hits/misses + write conditions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let chatCompletionCalls = 0;
let mockResponse: { content: string } = { content: "" };

vi.mock("@/lib/openrouter", () => ({
  chatCompletion: vi.fn(async () => {
    chatCompletionCalls++;
    return {
      choices: [{ message: { content: mockResponse.content } }],
      model: "mock-model",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
  }),
  resolveModel: vi.fn(() => "mock-model"),
  estimateCost: vi.fn(() => 0.001),
}));

vi.mock("@/lib/model-config", () => ({
  MODEL_CONFIG: { intent: "mock-model" },
}));

const validJson = JSON.stringify({
  tier: "M",
  type: "app",
  needsBackend: true,
  needsDatabase: true,
  needsAuth: false,
  needsMultipleServices: false,
  reasoning: "test",
});

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mem-cls-"));
  process.env.MEMORY_L1_ROOT = tmp;
  process.env.MEMORY_ENABLED = "true";
  process.env.MEMORY_CACHE = "true";
  chatCompletionCalls = 0;
  mockResponse = { content: validJson };
  // Reset memory module + classifier module so they pick up the new env.
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.MEMORY_L1_ROOT;
  delete process.env.MEMORY_ENABLED;
  delete process.env.MEMORY_CACHE;
  delete process.env.MEMORY_INJECT;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function load() {
  return await import("@/lib/agents/shared/project-classifier");
}

async function memMod() {
  return await import("@/lib/memory");
}

describe("classification cache — R5: MEMORY_CACHE flag", () => {
  it("with MEMORY_CACHE=false, every call hits LLM and never writes cache", async () => {
    process.env.MEMORY_CACHE = "false";
    vi.resetModules();
    const { classifyProject } = await load();
    await classifyProject("Build a clock app");
    await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(2);

    const { getSystemMemory } = await memMod();
    const all = await getSystemMemory().list({ kind: "classification" });
    expect(all.length).toBe(0);
  });

  it("with MEMORY_CACHE=true, second call hits cache and skips LLM", async () => {
    const { classifyProject } = await load();
    const first = await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);
    expect(first.tier).toBe("M");

    const second = await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1); // unchanged
    expect(second.tier).toBe("M");
    expect(second.costUsd).toBe(0); // cache hit incurs no LLM cost
  });
});

describe("classification cache — R2: conservative normalization", () => {
  it("trim + collapse whitespace hits the same cache", async () => {
    const { classifyProject } = await load();
    await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);
    await classifyProject("  Build  a  clock  app  ");
    expect(chatCompletionCalls).toBe(1);
    await classifyProject("\nBuild\ta clock\napp\n");
    expect(chatCompletionCalls).toBe(1);
  });

  it("punctuation / casing differences do NOT hit (conservative)", async () => {
    const { classifyProject } = await load();
    await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);

    await classifyProject("build a clock app"); // lowercase
    expect(chatCompletionCalls).toBe(2);

    await classifyProject("Build a clock app."); // trailing punctuation
    expect(chatCompletionCalls).toBe(3);
  });
});

describe("classification cache — R3: prompt version invalidation", () => {
  it("bumping CLASSIFIER_PROMPT_VERSION causes cache miss for same brief", async () => {
    const mod = await load();
    await mod.classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);

    // Simulate a prompt-version bump: the constant is exported and we
    // verify the key derivation depends on it. We assert by directly
    // poking the underlying record's promptVersion to be stale and
    // confirming the next call re-classifies.
    const { getSystemMemory } = await memMod();
    const store = getSystemMemory();
    const all = await store.list({ kind: "classification" });
    expect(all.length).toBe(1);
    const stale = all[0]!;
    const body = JSON.parse(stale.body);
    body.promptVersion = "v0-stale";
    await store.update(stale.id, { body: JSON.stringify(body) });

    await mod.classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(2);
  });
});

describe("classification cache — R4: fallback path is NOT cached", () => {
  it("LLM returns malformed JSON → fallback used → cache stays empty", async () => {
    mockResponse = { content: "this is not json" };
    const { classifyProject } = await load();
    const r = await classifyProject("Build a complex marketplace platform");
    expect(r.reasoning).toMatch(/heuristic fallback/i);
    expect(chatCompletionCalls).toBe(1);

    const { getSystemMemory } = await memMod();
    const all = await getSystemMemory().list({ kind: "classification" });
    expect(all.length).toBe(0);
  });

  it("JSON parse fails inside try → fallback used → cache stays empty", async () => {
    // Wrap garbage that DOES match the {.*} regex but fails JSON.parse
    mockResponse = { content: "{not valid json}" };
    const { classifyProject } = await load();
    await classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);
    const { getSystemMemory } = await memMod();
    const all = await getSystemMemory().list({ kind: "classification" });
    expect(all.length).toBe(0);
  });
});

describe("classification cache — R1: poisoned cache can be invalidated", () => {
  it("buggy cache returned until invalidate; LLM hit again afterwards", async () => {
    const mod = await load();
    await mod.classifyProject("Build a clock app");
    expect(chatCompletionCalls).toBe(1);

    // Poison the cached record
    const { getSystemMemory } = await memMod();
    const store = getSystemMemory();
    const all = await store.list({ kind: "classification" });
    const buggy = all[0]!;
    const body = JSON.parse(buggy.body);
    body.type = "WRONG";
    await store.update(buggy.id, { body: JSON.stringify(body) });

    const hit = await mod.classifyProject("Build a clock app");
    expect(hit.type).toBe("WRONG");
    expect(chatCompletionCalls).toBe(1); // still cached

    // Invalidate via direct delete (simulates invalidate-classification CLI)
    await store.delete(buggy.id);

    const fresh = await mod.classifyProject("Build a clock app");
    expect(fresh.type).toBe("app"); // back to LLM result
    expect(chatCompletionCalls).toBe(2);
  });
});
