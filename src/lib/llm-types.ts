export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
}

/** A message whose content may be a mix of text and image parts (for vision models). */
export interface VisionChatMessage {
  role: "system" | "user" | "assistant";
  content: string | VisionContentPart[];
}

export interface OpenRouterToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenRouterToolDefinition {
  type: "function";
  function: OpenRouterToolFunction;
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenRouterImageConfig {
  aspect_ratio?: string;
  image_size?: string;
}

export interface OpenRouterReasoningOptions {
  enabled?: boolean;
  effort?: "low" | "medium" | "high";
  exclude?: boolean;
  max_tokens?: number;
}

export interface OpenRouterThinkingOptions {
  thinking_effort?: "low" | "medium" | "high";
  verbosity?: "low" | "medium" | "high";
}

export interface OpenRouterOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenRouterToolDefinition[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  /** When set, enables image output (e.g. FLUX / Gemini image models on OpenRouter). */
  modalities?: ("image" | "text")[];
  image_config?: OpenRouterImageConfig;
  /** Force structured output. `json_object` mode guarantees valid JSON. */
  response_format?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: Record<string, unknown> };
  /** Provider-specific reasoning config (e.g. OpenRouter reasoning-enabled models). */
  reasoning?: OpenRouterReasoningOptions;
  /** Provider-specific thinking config (e.g. GPT-5 gateway). */
  thinking?: OpenRouterThinkingOptions | false;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterImagePart {
  type?: string;
  image_url?: { url: string };
}

export interface OpenRouterAssistantMessage extends ChatMessage {
  images?: OpenRouterImagePart[];
  tool_calls?: OpenRouterToolCall[];
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: {
    message: OpenRouterAssistantMessage;
    finish_reason: string;
  }[];
  usage: OpenRouterUsage;
}
