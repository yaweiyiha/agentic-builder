/**
 * Serialize every Pencil MCP session. The client is a process-wide singleton; overlapping
 * connect/disconnect (e.g. parallel-generate Pencil + Debug Pencil, or two tabs) tears down
 * the transport while another call is still using it — Pencil often shows "terminated".
 */
let chain: Promise<void> = Promise.resolve();

export function runWithPencilMcpExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
