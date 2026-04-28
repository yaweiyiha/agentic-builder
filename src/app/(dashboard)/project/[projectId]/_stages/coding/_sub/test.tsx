import AgentRoleSubStage from "./_AgentRoleSubStage";

export default function TestSubStage() {
  return (
    <AgentRoleSubStage
      role="test"
      title="Tests"
      description="Generates unit, integration and e2e tests for the generated codebase."
      nextSubStage="verify"
    />
  );
}
