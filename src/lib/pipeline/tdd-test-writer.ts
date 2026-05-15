/**
 * LLM-backed Test Writer stage. Produces RED tests from tddPlan before feature
 * workers write production code.
 */
import { MODEL_CONFIG, resolveModelChain } from "@/lib/model-config";
import {
  chatCompletionWithFallback,
  estimateCost,
  resolveModel,
  type ChatMessage,
  type OpenRouterToolDefinition,
} from "@/lib/openrouter";
import type { CodingTask } from "@/lib/pipeline/types";
import { fsRead, fsWrite, listFiles } from "@/lib/langgraph/tools";
import { recordCodingSessionLlmUsage } from "@/lib/pipeline/coding-session-report";
import type { RepairEmitter } from "@/lib/pipeline/self-heal";

interface TddTestWriterResult {
  attempted: boolean;
  testCount: number;
  writtenFiles: string[];
  summary: string;
  costUsd: number;
}

const MAX_TEST_WRITER_ITERATIONS = 10;
const MAX_TOOL_OUTPUT_CHARS = 5000;

type FlattenedTddTest = {
  taskId: string;
  taskTitle: string;
  requirementIds: string[];
  targetFiles: string[];
  id: string;
  type: string;
  priority: string;
  file: string;
  command: string;
  expectedRed: string;
  expectedGreen: string;
};

function collectTaskFiles(task: CodingTask): string[] {
  if (Array.isArray(task.files)) return task.files;
  if (!task.files) return [];
  return [
    ...task.files.creates,
    ...task.files.modifies,
    ...task.files.reads,
  ];
}

const TDD_TEST_WRITER_TOOLS: OpenRouterToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a relative file path from the generated project.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a TDD test file listed in the manifest.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files recursively under a relative directory.",
      parameters: {
        type: "object",
        properties: { dir: { type: "string" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "report_done",
      description: "Signal that all requested TDD test files were written.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
        },
        required: ["summary"],
      },
    },
  },
];

function flattenTddTests(tasks: CodingTask[]): FlattenedTddTest[] {
  const out: FlattenedTddTest[] = [];
  for (const task of tasks) {
    for (const test of task.tddPlan?.tests ?? []) {
      out.push({
        taskId: task.id,
        taskTitle: task.title,
        requirementIds: task.coversRequirementIds ?? [],
        targetFiles: collectTaskFiles(task).filter((file) => file !== test.file),
        id: test.id,
        type: test.type,
        priority: test.priority,
        file: test.file,
        command: test.command,
        expectedRed: test.expectedRed,
        expectedGreen: test.expectedGreen,
      });
    }
  }
  return out;
}

async function existingTestFiles(
  outputDir: string,
  files: string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (const file of files) {
    const raw = await fsRead(file, outputDir);
    if (!raw.startsWith("FILE_NOT_FOUND") && !raw.startsWith("REJECTED")) {
      present.add(file);
    }
  }
  return present;
}

async function executeTool(input: {
  outputDir: string;
  allowedFiles: Set<string>;
  writtenFiles: Set<string>;
  name: string;
  args: Record<string, unknown>;
}): Promise<string> {
  if (input.name === "read_file") {
    const content = await fsRead(String(input.args.path ?? ""), input.outputDir);
    return content.slice(0, MAX_TOOL_OUTPUT_CHARS);
  }
  if (input.name === "list_files") {
    const files = await listFiles(String(input.args.dir ?? "."), input.outputDir);
    return files.join("\n").slice(0, MAX_TOOL_OUTPUT_CHARS);
  }
  if (input.name === "write_file") {
    const file = String(input.args.path ?? "");
    if (!input.allowedFiles.has(file)) {
      return `REJECTED: ${file} is not listed in tddPlan.tests[].file.`;
    }
    const content = String(input.args.content ?? "");
    if (!/\b(expect|assert|should|toEqual|toBe)\b/.test(content)) {
      return "REJECTED: TDD test content must contain an assertion.";
    }
    await fsWrite(file, content, input.outputDir);
    input.writtenFiles.add(file);
    return `OK: wrote ${file}`;
  }
  return `ERROR: unknown tool ${input.name}`;
}

export async function runTddTestWriter(input: {
  outputDir: string;
  tasks: CodingTask[];
  projectContext: string;
  sessionId: string;
  emitter?: RepairEmitter;
}): Promise<TddTestWriterResult> {
  const tests = flattenTddTests(input.tasks);
  if (tests.length === 0) {
    return {
      attempted: false,
      testCount: 0,
      writtenFiles: [],
      summary: "TDD Test Writer skipped: no tddPlan tests.",
      costUsd: 0,
    };
  }

  const allowedFiles = new Set(tests.map((test) => test.file));
  const present = await existingTestFiles(input.outputDir, [...allowedFiles]);
  const missingTests = tests.filter((test) => !present.has(test.file));
  if (missingTests.length === 0) {
    return {
      attempted: false,
      testCount: tests.length,
      writtenFiles: [],
      summary: "TDD Test Writer skipped: all test files already exist.",
      costUsd: 0,
    };
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a Test Writer in a RED/GREEN TDD pipeline.",
        "Write only test files listed in the manifest. Do not write production code.",
        "Tests must be real, assertion-bearing, executable by the declared command, and initially fail before implementation.",
        "Each test file must cite at least one coversRequirementIds value in a short comment.",
        "Each test must import or reference the declared target route/service/API client/task-owned file, or assert against the declared endpoint string.",
        "Do not use skipped tests, todo tests, placeholder assertions, or mock-only tests.",
        "Prefer the test framework already present in the generated project.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Generated project root: ${input.outputDir}`,
        "",
        "Relevant project context:",
        input.projectContext.slice(0, 12_000),
        "",
        "TDD tests to write:",
        JSON.stringify(missingTests, null, 2),
        "",
        "Inspect package.json / existing tests if needed, then write every missing test file and call report_done.",
      ].join("\n"),
    },
  ];

  const modelChain = resolveModelChain(
    MODEL_CONFIG.phaseVerifyFix ?? MODEL_CONFIG.codeFix ?? "claude-sonnet",
    resolveModel,
  );
  const writtenFiles = new Set<string>();
  let costUsd = 0;
  let finalSummary = "";

  for (let iteration = 0; iteration < MAX_TEST_WRITER_ITERATIONS; iteration++) {
    const response = await chatCompletionWithFallback(messages, modelChain, {
      temperature: 0.1,
      max_tokens: 24000,
      tools: TDD_TEST_WRITER_TOOLS,
      tool_choice: "auto",
    });
    costUsd += estimateCost(response.model, response.usage);
    recordCodingSessionLlmUsage({
      sessionId: input.sessionId,
      stage: "tdd_test_writer",
      model: response.model,
      costUsd: estimateCost(response.model, response.usage),
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    });

    const choice = response.choices[0];
    messages.push({
      role: "assistant",
      content: choice.message.content ?? "",
      tool_calls: choice.message.tool_calls,
    });

    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalSummary = choice.message.content?.slice(0, 500) ?? "";
      break;
    }

    let done = false;
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = {};
      }
      if (call.function.name === "report_done") {
        finalSummary = String(args.summary ?? "");
        done = true;
        messages.push({
          role: "tool",
          content: "acknowledged",
          tool_call_id: call.id,
          name: call.function.name,
        });
        continue;
      }
      const result = await executeTool({
        outputDir: input.outputDir,
        allowedFiles,
        writtenFiles,
        name: call.function.name,
        args,
      });
      messages.push({
        role: "tool",
        content: result,
        tool_call_id: call.id,
        name: call.function.name,
      });
    }
    if (done) break;
  }

  const summary =
    finalSummary ||
    `TDD Test Writer wrote ${writtenFiles.size}/${missingTests.length} missing test file(s).`;

  // P1: when the writer claimed it ran but produced ZERO files, that is
  // never a healthy outcome. Emit a distinct telemetry event so the
  // session report flags it, and let the caller decide whether to retry
  // (current default: caller retries once via TDD_TEST_WRITER_RETRY_ON_EMPTY).
  const noFilesWritten = writtenFiles.size === 0 && missingTests.length > 0;
  input.emitter?.({
    stage: "tdd-test-writer",
    event: noFilesWritten ? "tdd_tests_write_empty" : "tdd_tests_written",
    details: {
      requested: missingTests.length,
      writtenFiles: [...writtenFiles],
      costUsd,
      ...(noFilesWritten
        ? {
            reason:
              "writer completed but produced zero test files — typically the LLM called report_done without writing.",
          }
        : {}),
    },
  });

  return {
    attempted: true,
    testCount: tests.length,
    writtenFiles: [...writtenFiles],
    summary,
    costUsd,
  };
}

/**
 * Best-effort wrapper around `runTddTestWriter` that retries ONCE when the
 * first attempt produced zero files but tests were requested. We do not
 * retry indefinitely — a second consecutive empty run almost always means
 * the LLM is misreading the manifest, not a transient flake.
 *
 * Set `TDD_TEST_WRITER_RETRY_ON_EMPTY=0` to disable the retry.
 */
export async function runTddTestWriterWithRetry(input: {
  outputDir: string;
  tasks: CodingTask[];
  projectContext: string;
  sessionId: string;
  emitter?: RepairEmitter;
}): Promise<TddTestWriterResult> {
  const retryOnEmpty =
    (process.env.TDD_TEST_WRITER_RETRY_ON_EMPTY ?? "1").trim() !== "0";
  const first = await runTddTestWriter(input);
  if (!retryOnEmpty) return first;
  if (!first.attempted) return first;
  if (first.writtenFiles.length > 0) return first;

  console.warn(
    "[TDD Test Writer] First attempt produced zero files — retrying once with the same manifest.",
  );
  const second = await runTddTestWriter(input);
  return {
    ...second,
    costUsd: first.costUsd + second.costUsd,
  };
}
