/**
 * Re-export for backward-compatible imports: `@/lib/agents/project-classifier`.
 * Prefer: `import { ... } from "@/lib/agents"`.
 */
export {
  classifyProject,
  type ProjectTier,
  type ProjectClassification,
} from "./shared/project-classifier";
