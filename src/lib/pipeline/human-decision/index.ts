/**
 * Human-in-the-loop decision mechanism for the integration verify/fix stage.
 *
 * When the worker stagnates and cannot determine the right action autonomously,
 * the pipeline pauses and sends a `human_decision_needed` SSE event to the
 * browser. The human picks one of the pre-defined options, which are sent back
 * via POST /api/agents/coding/decide. The waiting Promise resolves and the
 * supervisor injects the decision as a system correction message to resume.
 *
 * The pause is async-safe: only the current coding session is blocked; other
 * sessions continue running normally.
 */

export interface HumanDecisionOption {
  /** Machine-readable key sent back as the decision value. */
  id: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** One-sentence explanation of what the system will do if this is chosen. */
  description: string;
}

export interface PendingDecision {
  options: HumanDecisionOption[];
  /** Short summary of what the worker is stuck on. */
  context: string;
  /** ISO timestamp when this decision will auto-resolve if no response. */
  expiresAt: string;
  resolve: (decisionId: string) => void;
  reject: (reason?: unknown) => void;
}

const DECISION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

const _pending = new Map<string, PendingDecision>();

/**
 * Pause the current async execution and wait for a human to choose one of
 * `options`. Returns the chosen option's `id`, or `"timeout"` after 5 min
 * with no response.
 */
export function requestHumanDecision(
  sessionId: string,
  options: HumanDecisionOption[],
  context: string,
): Promise<string> {
  // Cancel any prior pending decision for this session before registering a
  // new one (defensive — only one should ever be in-flight at a time).
  clearHumanDecision(sessionId);

  return new Promise<string>((resolve, reject) => {
    const expiresAt = new Date(Date.now() + DECISION_TIMEOUT_MS).toISOString();
    _pending.set(sessionId, { options, context, expiresAt, resolve, reject });

    const timer = setTimeout(() => {
      if (_pending.has(sessionId)) {
        _pending.delete(sessionId);
        resolve("timeout");
      }
    }, DECISION_TIMEOUT_MS);

    // Don't let the timer prevent clean process exit.
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

/**
 * Resolve a pending decision for `sessionId` with the chosen option id.
 * Returns `true` when a pending decision existed; `false` when not found
 * (e.g. already timed out or the session ended).
 */
export function resolveHumanDecision(
  sessionId: string,
  decisionId: string,
): boolean {
  const pending = _pending.get(sessionId);
  if (!pending) return false;
  _pending.delete(sessionId);
  pending.resolve(decisionId);
  return true;
}

/** Remove a pending decision without resolving it (used on session cleanup). */
export function clearHumanDecision(sessionId: string): void {
  const pending = _pending.get(sessionId);
  if (!pending) return;
  _pending.delete(sessionId);
  pending.reject(new Error("session_cleared"));
}

/** Returns the public (non-resolve/reject) shape for a pending decision. */
export function getPendingDecision(
  sessionId: string,
): Omit<PendingDecision, "resolve" | "reject"> | null {
  const entry = _pending.get(sessionId);
  if (!entry) return null;
  const { resolve: _r, reject: _j, ...rest } = entry;
  return rest;
}

/** The pre-defined options for the 4-quadrant + abort decision. */
export const INTEGRATION_DECISION_OPTIONS: HumanDecisionOption[] = [
  {
    id: "wire_frontend",
    label: "Wire frontend",
    description:
      "The frontend is missing an API call. Add the apiClient call and UI hookup for the endpoint shown in context.",
  },
  {
    id: "prune_contract",
    label: "Prune contract",
    description:
      "This contract entry is surplus — the feature does not need a backend endpoint. Remove it from API_CONTRACTS.json.",
  },
  {
    id: "add_and_implement",
    label: "Add to contract + implement backend",
    description:
      "The frontend already calls an undeclared endpoint that the PRD justifies. Add it to API_CONTRACTS.json and implement the backend route.",
  },
  {
    id: "remove_rogue_call",
    label: "Remove rogue frontend call",
    description:
      "The frontend calls an endpoint with no contract entry and no PRD justification. Delete or replace the call.",
  },
  {
    id: "abort",
    label: "Abort integration fix",
    description:
      "This issue cannot be resolved automatically. Mark the integration stage as failed and proceed to the report.",
  },
];
