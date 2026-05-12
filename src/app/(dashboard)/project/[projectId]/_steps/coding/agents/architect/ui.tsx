import { AgentLogUi } from "../../../_shared/agent-log-ui";

export function ArchitectUI() {
  return (
    <AgentLogUi
      role="architect"
      title="Architect"
      description="Plans the overall code structure, module boundaries and task assignments."
      nextStep="backend"
    />
  );
}
