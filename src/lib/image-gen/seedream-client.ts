const SEEDREAM_API_URL =
  "https://ark.cn-beijing.volces.com/api/v3/images/generations";

export const SEEDREAM_MODEL = "doubao-seedream-5-0-260128";

interface SeedreamRequest {
  model: string;
  prompt: string;
  size?: string;
  response_format?: "url" | "b64_json";
  sequential_image_generation?: "enabled" | "disabled";
  stream?: boolean;
  watermark?: boolean;
}

export interface SeedreamImageResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface SeedreamResponse {
  created: number;
  data: SeedreamImageResult[];
}

export interface SeedreamOptions {
  /** Image size: "1K" (default) | "2K" | "4K" */
  size?: string;
  watermark?: boolean;
}

/**
 * Calls the Volcengine SeeDream API to generate one image from a text prompt.
 * Requires `SEEDREAM_API_KEY` in environment.
 */
export async function generateSeedreamImage(
  prompt: string,
  options: SeedreamOptions = {},
): Promise<SeedreamResponse> {
  const apiKey = process.env.SEEDREAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SEEDREAM_API_KEY is not configured — add it to .env.local.",
    );
  }

  const body: SeedreamRequest = {
    model: SEEDREAM_MODEL,
    prompt,
    size: "2K",
    response_format: "url",
    sequential_image_generation: "disabled",
    stream: false,
    watermark: true,
  };

  const res = await fetch(SEEDREAM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`SeeDream API error: ${res.status} - ${detail}`);
  }

  return res.json() as Promise<SeedreamResponse>;
}

/** Returns true when `SEEDREAM_API_KEY` is configured in the environment. */
export function isSeedreamConfigured(): boolean {
  return Boolean(process.env.SEEDREAM_API_KEY);
}
