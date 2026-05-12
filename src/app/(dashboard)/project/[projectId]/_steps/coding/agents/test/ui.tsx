import { AgentLogUi } from "../../../_shared/agent-log-ui";

export function TestUI() {
  return (
    <AgentLogUi
      role="test"
      title="Tests"
      description="Generates unit, integration and e2e tests for the generated codebase."
      nextStep="coding-verify"
    />
  );
}
