export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterImageConfig {
  aspect_ratio?: string;
  image_size?: string;
}

export interface OpenRouterOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  /** When set, enables image output (e.g. FLUX / Gemini image models on OpenRouter). */
  modalities?: ("image" | "text")[];
  image_config?: OpenRouterImageConfig;
  /** Force structured output. `json_object` mode guarantees valid JSON. */
  response_format?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: Record<string, unknown> };
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
