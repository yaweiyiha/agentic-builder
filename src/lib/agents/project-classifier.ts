/**
 * Re-export for backward-compatible imports: `@/lib/agents/project-classifier`.
 * Prefer: `import { ... } from "@/lib/agents"`.
 */
export {
  classifyProject,
  normalizeProjectTier,
  type ProjectTier,
  type ProjectClassification,
} from "./shared/project-classifier";
