import AgentRoleSubStage from "./_AgentRoleSubStage";

export default function FrontendSubStage() {
  return (
    <AgentRoleSubStage
      role="frontend"
      title="Frontend"
      description="Generates UI components, pages, and client-side interaction logic."
      nextSubStage="test"
    />
  );
}
