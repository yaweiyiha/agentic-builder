import { AgentLogUi } from "../../../_shared/agent-log-ui";

export function FrontendUI() {
  return (
    <AgentLogUi
      role="frontend"
      title="Frontend"
      description="Generates UI components, pages, and client-side interaction logic."
      nextStep="test"
    />
  );
}
