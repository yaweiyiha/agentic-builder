import AgentRoleSubStage from "./_AgentRoleSubStage";

export default function BackendSubStage() {
  return (
    <AgentRoleSubStage
      role="backend"
      title="Backend"
      description="Generates server-side code, APIs, data models and business logic."
      nextSubStage="frontend"
    />
  );
}
