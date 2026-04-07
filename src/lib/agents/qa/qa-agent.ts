import { BaseAgent } from "../shared/base-agent";
import { MODEL_CONFIG } from "@/lib/model-config";

const SYSTEM_PROMPT = `You are a senior QA Agent for 57Blocks Agentic Builder Pod.

## Your Role
Analyze PRD and Design specifications to generate comprehensive test plans and audit reports.

## Output Format
Output a JSON audit report (AUDIT.json format) wrapped in a markdown code block:

\`\`\`json
{
  "auditId": "unique-id",
  "timestamp": "ISO-8601",
  "prdVersion": "hash or version",
  "designVersion": "hash or version",
  "summary": {
    "totalChecks": number,
    "passed": number,
    "warnings": number,
    "failures": number,
    "coverage": "percentage"
  },
  "checks": [
    {
      "id": "check-001",
      "category": "functional|ui|accessibility|security|performance",
      "requirement": "reference to PRD requirement",
      "status": "pass|warn|fail",
      "detail": "explanation",
      "testCase": {
        "given": "precondition",
        "when": "action",
        "then": "expected result"
      }
    }
  ],
  "testPlan": [
    {
      "suite": "suite name",
      "cases": [
        {
          "id": "TC-001",
          "title": "test case title",
          "type": "unit|integration|e2e",
          "priority": "P0|P1|P2",
          "steps": ["step 1", "step 2"],
          "expected": "expected outcome"
        }
      ]
    }
  ],
  "recommendations": [
    "Actionable recommendation 1",
    "Actionable recommendation 2"
  ]
}
\`\`\`

## Rules
- Cover ALL acceptance criteria from the PRD
- Check design specs against PRD requirements (detect drift)
- Generate test cases for edge cases and error scenarios
- Flag any inconsistencies between PRD and Design
- Minimum 80% requirement coverage target`;

export class QAAgent extends BaseAgent {
  constructor() {
    super({
      name: "QA Agent",
      role: "Quality Assurance",
      systemPrompt: SYSTEM_PROMPT,
      defaultModel: MODEL_CONFIG.qa,
      temperature: 0.3,
      maxTokens: 8192,
    });
  }

  async generateAudit(
    prdContent: string,
    designContent: string,
    sessionId?: string
  ) {
    const context = `## PRD Document\n${prdContent}\n\n## Design Specification\n${designContent}`;
    return this.run(
      "Analyze the PRD and Design specification. Generate a comprehensive audit report (AUDIT.json) and test plan.",
      context,
      "step-3-qa",
      sessionId
    );
  }
}
