/**
 * Text Parser – Phase 3
 * Converts raw pasted text into a structured EbookDocument without AI.
 * Phase 4 will replace/augment this with AI-assisted formatting.
 *
 * Supported syntax:
 *   # Heading 1        → h1
 *   ## Heading 2       → h2
 *   ### Heading 3      → h3
 *   > Quote text       → quote
 *   * bullet / - bullet / • bullet → bullet
 *   1. numbered item   → numbered
 *   KEY TAKEAWAY:      → callout
 *   --- or ===         → divider
 *   (everything else)  → paragraph
 */

export type BlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'bullet'
  | 'numbered'
  | 'quote'
  | 'callout'
  | 'divider';

export interface Block {
  type: BlockType;
  text: string;
  /** For numbered lists, the explicit number label (e.g. "1.") */
  number?: string;
}

export interface ParsedSection {
  heading: string;
  blocks: Block[];
}

export interface ParsedEbook {
  title: string;
  sections: ParsedSection[];
  /** Flat block list (used directly by PDF renderer) */
  allBlocks: Block[];
}

// ─── Regex helpers ────────────────────────────────────────────────────────────
const H1_RE = /^#\s+(.+)$/;
const H2_RE = /^##\s+(.+)$/;
const H3_RE = /^###\s+(.+)$/;
const BULLET_RE = /^[\*\-•]\s+(.+)$/;
const NUMBERED_RE = /^(\d+)\.\s+(.+)$/;
const QUOTE_RE = /^>\s*(.+)$/;
const DIVIDER_RE = /^[-=]{3,}\s*$/;
const CALLOUT_RE = /^(key\s*takeaway[s]?|note|tip|important|warning)[:\s]/i;

function classifyLine(line: string): Block | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Headings (check ## before # to avoid partial match)
  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(H3_RE))) return { type: 'h3', text: m[1].trim() };
  if ((m = trimmed.match(H2_RE))) return { type: 'h2', text: m[1].trim() };
  if ((m = trimmed.match(H1_RE))) return { type: 'h1', text: m[1].trim() };

  if (DIVIDER_RE.test(trimmed)) return { type: 'divider', text: '' };

  if ((m = trimmed.match(QUOTE_RE))) return { type: 'quote', text: m[1].trim() };

  if ((m = trimmed.match(BULLET_RE))) return { type: 'bullet', text: m[1].trim() };

  if ((m = trimmed.match(NUMBERED_RE)))
    return { type: 'numbered', text: m[2].trim(), number: `${m[1]}.` };

  if (CALLOUT_RE.test(trimmed)) return { type: 'callout', text: trimmed };

  return { type: 'paragraph', text: trimmed };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function parseText(rawText: string, fallbackTitle = 'Untitled Ebook'): ParsedEbook {
  const lines = rawText.split(/\r?\n/);
  const allBlocks: Block[] = [];

  for (const line of lines) {
    const block = classifyLine(line);
    if (block) allBlocks.push(block);
  }

  // Derive title: first h1/h2, or fallback
  const titleBlock = allBlocks.find((b) => b.type === 'h1' || b.type === 'h2');
  const title = titleBlock ? titleBlock.text : fallbackTitle;

  // Split into sections on h1/h2 boundaries
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (const block of allBlocks) {
    if (block.type === 'h1' || block.type === 'h2') {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: block.text, blocks: [] };
    } else {
      if (!currentSection) {
        currentSection = { heading: title, blocks: [] };
      }
      currentSection.blocks.push(block);
    }
  }
  if (currentSection) sections.push(currentSection);

  // If no sections were created (plain text only), wrap everything in one section
  if (sections.length === 0) {
    sections.push({ heading: title, blocks: allBlocks });
  }

  return { title, sections, allBlocks };
}

/** Convert ParsedEbook back to JSON (stored in ebooks.formatted_json) */
export function toFormattedJson(parsed: ParsedEbook): object {
  return {
    title: parsed.title,
    sections: parsed.sections,
  };
}
