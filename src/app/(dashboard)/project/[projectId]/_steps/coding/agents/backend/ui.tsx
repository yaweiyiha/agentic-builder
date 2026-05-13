import { AgentLogUi } from "../../../_shared/agent-log-ui";

export function BackendUI() {
  return (
    <AgentLogUi
      role="backend"
      title="Backend"
      description="Generates server-side code, APIs, data models and business logic."
      nextStep="frontend"
    />
  );
}
