import AgentRoleSubStage from "./_AgentRoleSubStage";

export default function ArchitectSubStage() {
  return (
    <AgentRoleSubStage
      role="architect"
      title="Architect"
      description="Plans the overall code structure, module boundaries and task assignments."
      nextSubStage="backend"
    />
  );
}
