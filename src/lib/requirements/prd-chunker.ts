/**
 * Lightweight markdown chunker used by `extractPrdSpec` and (eventually)
 * the doc-section-picker. Splits on H2 / H3 boundaries where possible and
 * emits overlapping chunks no larger than `maxChars`.
 *
 * Design goals:
 *   • Never cut in the middle of a heading's body if it fits.
 *   • When a heading's body itself exceeds `maxChars`, fall back to a
 *     line-based split inside that body.
 *   • Each non-first chunk carries a short `preamble` (up to `overlap`
 *     characters) pulled from the previous chunk's tail so the LLM has
 *     enough context to resolve cross-section references.
 */

export interface MarkdownChunk {
  index: number;
  total: number;
  /** Short overlap from the previous chunk (empty for index=0). */
  preamble: string;
  /** The chunk body itself. */
  body: string;
}

export function chunkMarkdown(
  text: string,
  options: { maxChars?: number; overlap?: number } = {},
): MarkdownChunk[] {
  const maxChars = Math.max(2000, options.maxChars ?? 18_000);
  const overlap = Math.min(
    maxChars / 2,
    Math.max(0, options.overlap ?? 1_200),
  );

  if (!text || text.length === 0) return [];
  if (text.length <= maxChars) {
    return [{ index: 0, total: 1, preamble: "", body: text }];
  }

  const sections = splitByHeadings(text);
  const raw: string[] = [];
  let current = "";
  for (const section of sections) {
    if (section.length > maxChars) {
      // Flush whatever we were building before handling the oversized one.
      if (current.length > 0) {
        raw.push(current);
        current = "";
      }
      for (const piece of splitLargeSection(section, maxChars)) {
        raw.push(piece);
      }
      continue;
    }
    if (current.length + section.length + 2 > maxChars) {
      raw.push(current);
      current = section;
    } else {
      current = current.length === 0 ? section : current + "\n\n" + section;
    }
  }
  if (current.length > 0) raw.push(current);

  const result: MarkdownChunk[] = raw.map((body, i) => ({
    index: i,
    total: raw.length,
    preamble:
      i === 0
        ? ""
        : tailExcerpt(raw[i - 1], overlap),
    body,
  }));
  return result;
}

function splitByHeadings(text: string): string[] {
  // Split at the start of every `##` or `###` line, keeping the heading with
  // its following body.
  const lines = text.split("\n");
  const sections: string[] = [];
  let buffer: string[] = [];
  const isHeading = (l: string) => /^#{2,3}\s+\S/.test(l);
  for (const line of lines) {
    if (isHeading(line) && buffer.length > 0) {
      sections.push(buffer.join("\n"));
      buffer = [];
    }
    buffer.push(line);
  }
  if (buffer.length > 0) sections.push(buffer.join("\n"));
  return sections;
}

function splitLargeSection(section: string, maxChars: number): string[] {
  const lines = section.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (len + add > maxChars && buf.length > 0) {
      out.push(buf.join("\n"));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += add;
  }
  if (buf.length > 0) out.push(buf.join("\n"));
  return out;
}

function tailExcerpt(prev: string, overlap: number): string {
  if (overlap <= 0 || prev.length <= overlap) return prev;
  return "…\n" + prev.slice(prev.length - overlap);
}
