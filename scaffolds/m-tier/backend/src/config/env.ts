import "dotenv/config";

export const PORT = Number(process.env.PORT || 4000);

// Optional auth providers (Privy, Clerk, Auth0, etc.) live in
// `scaffolds/m-tier/_optional/<feature>/backend/src/config/<feature>-env.ts`.
// They are copied into the generated project only when the kickoff phase
// detects matching `triggerEnvKeys` on `.blueprint/resource-requirements.json`.
