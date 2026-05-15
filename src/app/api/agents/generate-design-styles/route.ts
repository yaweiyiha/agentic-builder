import { NextRequest, NextResponse } from "next/server";
import { chatCompletion, resolveModel } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

export interface DesignStyle {
  id: string;
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    tertiary: string;
    neutral: string;
  };
  typography: {
    headlineFont: string;
    bodyFont: string;
    labelFont: string;
  };
  fontSizes: {
    h1: number;
    h2: number;
    h3: number;
    body: number;
    label: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
}

const SYSTEM_PROMPT = `You are a senior UI/UX design director. Based on a PRD, you generate exactly 5 distinct design style options for a product.

Each style must feel cohesive and purposeful — tailored to the product's domain, target users, and emotional tone described in the PRD.

Return a JSON object with a "styles" array containing exactly 5 items. Each item MUST follow this exact shape:

{
  "id": "style-<N>",           // e.g. "style-1"
  "name": "<2-4 word name>",   // e.g. "Modern Minimal"
  "description": "<1 sentence describing the visual personality>",
  "colors": {
    "primary":   "<hex>",      // dominant brand color
    "secondary": "<hex>",      // accent / call-to-action
    "tertiary":  "<hex>",      // highlight / info color
    "neutral":   "<hex>"       // text / surface gray
  },
  "typography": {
    "headlineFont": "<Google Font or system font name>",
    "bodyFont":     "<Google Font or system font name>",
    "labelFont":    "<Google Font or system font name>"
  },
  "fontSizes": { "h1": <px int>, "h2": <px int>, "h3": <px int>, "body": <px int>, "label": <px int> },
  "spacing":   { "xs": <px int>, "sm": <px int>, "md": <px int>, "lg": <px int>, "xl": <px int> }
}

Rules:
- 5 styles must be clearly differentiated: vary the color palette personality (e.g. bold/dark, pastel/light, monochromatic, vibrant/gradient-ready, neutral/enterprise).
- Colors must be valid 6-digit hex codes.
- Font choices must be real, web-safe or Google Fonts names (Inter, Poppins, Space Grotesk, Lato, Nunito, etc.).
- Font sizes: h1 28–40px, h2 22–32px, h3 18–26px, body 13–16px, label 11–13px.
- Spacing: xs 4–8, sm 8–14, md 14–20, lg 20–32, xl 28–48.
- Output ONLY the JSON object — no markdown fences, no explanation.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prdContent } = body as { prdContent?: string };

    if (!prdContent?.trim()) {
      return NextResponse.json(
        { error: "PRD content is required" },
        { status: 400 },
      );
    }

    const model = resolveModel(MODEL_CONFIG.design);

    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Generate 5 distinct design styles for the following product PRD:\n\n${prdContent.slice(0, 8000)}`,
      },
    ];

    const llmRes = await chatCompletion(messages, {
      model,
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const raw = llmRes.choices[0]?.message?.content ?? "";

    // Extract JSON — the model may occasionally wrap in fences despite instructions
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[generate-design-styles] No JSON in LLM response:", raw.slice(0, 500));
      return NextResponse.json(
        { error: "LLM returned no parseable JSON" },
        { status: 502 },
      );
    }

    let parsed: { styles?: unknown[] };
    try {
      parsed = JSON.parse(jsonMatch[0]) as { styles?: unknown[] };
    } catch (e) {
      console.error("[generate-design-styles] JSON parse error:", e);
      return NextResponse.json(
        { error: "Failed to parse LLM JSON response" },
        { status: 502 },
      );
    }

    const styles = parsed.styles;
    if (!Array.isArray(styles) || styles.length === 0) {
      console.error("[generate-design-styles] Unexpected shape:", JSON.stringify(parsed).slice(0, 500));
      return NextResponse.json(
        { error: "LLM response did not contain a styles array" },
        { status: 502 },
      );
    }

    // Ensure each style has a stable id
    const normalised: DesignStyle[] = (styles as DesignStyle[]).map(
      (s, i) => ({ ...s, id: s.id ?? `style-${i + 1}` }),
    );

    console.log(
      `[generate-design-styles] Generated ${normalised.length} styles via ${llmRes.model}`,
    );

    return NextResponse.json({ styles: normalised });
  } catch (error) {
    console.error("[generate-design-styles] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate design styles" },
      { status: 500 },
    );
  }
}
