/**
 * Intent fallback response builder keeps the clarification step usable when
 * the model fails to return parseable JSON.
 */
export function fallbackIntentForm(brief: string, reason: string) {
  const projectName =
    brief
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(" ")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim() || "New Project";

  return {
    project_name: projectName,
    all_clear: false,
    summary:
      "I need a few clarifications before generating the product documents.",
    gathered: brief ? [`A: Initial brief provided: ${brief.slice(0, 160)}`] : [],
    questions: [
      {
        id: "target_users",
        type: "text",
        label: "Who are the primary users?",
      },
      {
        id: "pain_points",
        type: "text",
        label: "What pain points should this solve?",
      },
      {
        id: "mobile_support",
        type: "radio",
        label: "Which device targets are required?",
        options: ["Web only", "Mobile-responsive web"],
      },
      {
        id: "auth_method",
        type: "checkbox",
        label: "How should users log in?",
        options: ["Email / Password", "GitHub", "No login needed"],
      },
      {
        id: "need_backend",
        type: "radio",
        label: "Is a real backend required?",
        options: [
          "Yes, need a real backend (API + database)",
          "No, mock data is sufficient (frontend only)",
        ],
      },
    ],
    _fallbackReason: reason,
  };
}
