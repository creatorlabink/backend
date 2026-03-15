/**
 * Text Parser – Phase 5
 * Converts raw pasted text into a structured EbookDocument.
 * Enhanced with smart detection for:
 *   - Chapter headings (CHAPTER 1:, Chapter 2, etc.)
 *   - Step headings (Step 1:, Step 2, etc.)
 *   - ChatGPT prompts (Prompt:, ChatGPT Prompt, etc.)
 *   - Action tasks (Action Task, Your Action, etc.)
 *   - Goals (Your Goal, Goal for This Step, etc.)
 *   - Pull quotes and key takeaways
 *   - Bullet and numbered lists
 */

export type BlockType =
  | 'chapter'       // Major chapter heading (navy banner)
  | 'h1'           // Section heading
  | 'h2'           // Subsection heading
  | 'h3'           // Minor heading
  | 'paragraph'    // Body text
  | 'bullet'       // Bullet list item (teal box)
  | 'numbered'     // Numbered list item
  | 'quote'        // Pull quote (gold border, cream bg)
  | 'callout'      // Important message (navy callout box)
  | 'prompt'       // ChatGPT prompt (teal border, light green bg)
  | 'action_task'  // Action task heading (gold box)
  | 'goal'         // Goal section (navy callout)
  | 'divider'      // Horizontal rule
  | 'prompt_text'; // Text inside a prompt block

export interface Block {
  type: BlockType;
  text: string;
  /** For numbered lists, the explicit number label (e.g. "1.") */
  number?: string;
  /** For chapters, the chapter number */
  chapterNum?: number;
}

export interface ParsedSection {
  heading: string;
  blocks: Block[];
  isChapter?: boolean;
  chapterNum?: number;
}

export interface ParsedEbook {
  title: string;
  sections: ParsedSection[];
  /** Flat block list (used directly by PDF renderer) */
  allBlocks: Block[];
}

// ─── Regex helpers ────────────────────────────────────────────────────────────
const CHAPTER_RE = /^(?:CHAPTER|Chapter)\s*(\d+)[:\s]*(.*)$/i;
const STEP_RE = /^(?:Step)\s*(\d+)[:\s]*(.*)$/i;
const H1_RE = /^#\s+(.+)$/;
const H2_RE = /^##\s+(.+)$/;
const H3_RE = /^###\s+(.+)$/;
const H4_RE = /^####\s+(.+)$/;
const BULLET_RE = /^[\*\-•]\s+(.+)$/;
const NUMBERED_RE = /^(\d+)\.\s+(.+)$/;
const QUOTE_RE = /^>\s*(.+)$/;
const DIVIDER_RE = /^[-=]{3,}\s*$/;

// Enhanced pattern detection
const PROMPT_START_RE = /^(?:Prompt|ChatGPT\s*Prompt|Prompt\s*(?:to|for))[:\s]/i;
const PROMPT_QUOTE_RE = /^[""](.+)$/;
const ACTION_TASK_RE = /^(?:Action\s*Task|Your\s*Action|Action\s*Plan)[s]?[:\s]?$/i;
const GOAL_RE = /^(?:Your\s*Goal|Goal\s*for\s*This\s*Step)[:\s]?$/i;
const CALLOUT_RE = /^(?:Key\s*Takeaway[s]?|Note|Tip|Important|Warning|Summary|Bonus)[:\s]/i;
const BONUS_RE = /^(?:BONUS|Bonus)\s*\d*[:\s]*(.*)$/i;
const CONCLUSION_RE = /^(?:Conclusion|Summary|Final\s*Thoughts)[:\s]?(.*)$/i;

// Context tracking for multi-line prompts
let inPromptBlock = false;

function classifyLine(line: string, prevBlock: Block | null): Block | null {
  const trimmed = line.trim();
  if (!trimmed) {
    // Empty line ends prompt block
    inPromptBlock = false;
    return null;
  }

  let m: RegExpMatchArray | null;

  // Chapter headings (CHAPTER 1: Title)
  if ((m = trimmed.match(CHAPTER_RE))) {
    inPromptBlock = false;
    const chapterNum = parseInt(m[1], 10);
    const title = m[2].trim() || `Chapter ${chapterNum}`;
    return { type: 'chapter', text: title, chapterNum };
  }

  // Bonus chapters
  if ((m = trimmed.match(BONUS_RE))) {
    inPromptBlock = false;
    return { type: 'chapter', text: m[1].trim() || trimmed };
  }

  // Conclusion
  if ((m = trimmed.match(CONCLUSION_RE))) {
    inPromptBlock = false;
    return { type: 'chapter', text: m[1].trim() || 'Conclusion' };
  }

  // Markdown headings (check #### before ### before ## before #)
  if ((m = trimmed.match(H4_RE))) {
    inPromptBlock = false;
    return { type: 'h3', text: m[1].trim() };
  }
  if ((m = trimmed.match(H3_RE))) {
    inPromptBlock = false;
    return { type: 'h3', text: m[1].trim() };
  }
  if ((m = trimmed.match(H2_RE))) {
    inPromptBlock = false;
    return { type: 'h2', text: m[1].trim() };
  }
  if ((m = trimmed.match(H1_RE))) {
    inPromptBlock = false;
    return { type: 'h1', text: m[1].trim() };
  }

  // Step headings
  if ((m = trimmed.match(STEP_RE))) {
    inPromptBlock = false;
    const stepNum = m[1];
    const title = m[2].trim();
    return { type: 'h2', text: `Step ${stepNum}: ${title}`, number: stepNum };
  }

  // Dividers
  if (DIVIDER_RE.test(trimmed)) {
    inPromptBlock = false;
    return { type: 'divider', text: '' };
  }

  // Action Task section
  if (ACTION_TASK_RE.test(trimmed)) {
    inPromptBlock = false;
    return { type: 'action_task', text: trimmed.replace(/[:\s]*$/, '') };
  }

  // Goal section
  if (GOAL_RE.test(trimmed)) {
    inPromptBlock = false;
    return { type: 'goal', text: trimmed.replace(/[:\s]*$/, '') };
  }

  // Prompt start detection
  if (PROMPT_START_RE.test(trimmed)) {
    inPromptBlock = true;
    return { type: 'prompt', text: trimmed };
  }

  // Inside prompt block - detect quoted prompt text
  if (inPromptBlock) {
    if ((m = trimmed.match(PROMPT_QUOTE_RE))) {
      return { type: 'prompt_text', text: m[1].replace(/[""]$/, '').trim() };
    }
    // Continue prompt block if text looks like prompt content
    if (trimmed.startsWith('"') || trimmed.startsWith('"') || 
        (prevBlock && (prevBlock.type === 'prompt' || prevBlock.type === 'prompt_text'))) {
      return { type: 'prompt_text', text: trimmed.replace(/^[""]|[""]$/g, '') };
    }
  }

  // Callouts
  if (CALLOUT_RE.test(trimmed)) {
    inPromptBlock = false;
    return { type: 'callout', text: trimmed };
  }

  // Block quotes
  if ((m = trimmed.match(QUOTE_RE))) {
    return { type: 'quote', text: m[1].trim() };
  }

  // Bullet points
  if ((m = trimmed.match(BULLET_RE))) {
    return { type: 'bullet', text: m[1].trim() };
  }

  // Numbered items
  if ((m = trimmed.match(NUMBERED_RE))) {
    return { type: 'numbered', text: m[2].trim(), number: `${m[1]}.` };
  }

  // Check for inline bold headings (short lines in ALL CAPS or **bold**)
  if (trimmed.length < 60 && /^[A-Z][A-Z\s]+$/.test(trimmed) && !trimmed.includes('.')) {
    inPromptBlock = false;
    return { type: 'h3', text: trimmed };
  }

  // Default: paragraph
  return { type: 'paragraph', text: trimmed };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function parseText(rawText: string, fallbackTitle = 'Untitled Ebook'): ParsedEbook {
  // Reset global state
  inPromptBlock = false;
  
  const lines = rawText.split(/\r?\n/);
  const allBlocks: Block[] = [];
  let prevBlock: Block | null = null;

  for (const line of lines) {
    const block = classifyLine(line, prevBlock);
    if (block) {
      allBlocks.push(block);
      prevBlock = block;
    }
  }

  // Merge consecutive prompt_text blocks into single prompt blocks
  const mergedBlocks: Block[] = [];
  let promptBuffer: string[] = [];
  
  for (const block of allBlocks) {
    if (block.type === 'prompt') {
      // Flush any existing prompt buffer
      if (promptBuffer.length > 0) {
        mergedBlocks.push({ type: 'prompt', text: promptBuffer.join('\n') });
        promptBuffer = [];
      }
      mergedBlocks.push(block);
    } else if (block.type === 'prompt_text') {
      promptBuffer.push(block.text);
    } else {
      // Flush prompt buffer if we have one
      if (promptBuffer.length > 0) {
        mergedBlocks.push({ type: 'prompt', text: promptBuffer.join('\n') });
        promptBuffer = [];
      }
      mergedBlocks.push(block);
    }
  }
  // Flush remaining prompt buffer
  if (promptBuffer.length > 0) {
    mergedBlocks.push({ type: 'prompt', text: promptBuffer.join('\n') });
  }

  // Derive title: first chapter heading, h1/h2, or fallback
  const titleBlock = mergedBlocks.find((b) => 
    b.type === 'chapter' || b.type === 'h1' || b.type === 'h2'
  );
  const title = titleBlock ? titleBlock.text : fallbackTitle;

  // Split into sections on chapter/h1/h2 boundaries
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (const block of mergedBlocks) {
    if (block.type === 'chapter') {
      if (currentSection) sections.push(currentSection);
      currentSection = { 
        heading: block.text, 
        blocks: [], 
        isChapter: true,
        chapterNum: block.chapterNum 
      };
    } else if (block.type === 'h1' || block.type === 'h2') {
      // Only create new section for h1/h2 if not already in a chapter
      if (currentSection && currentSection.blocks.length === 0 && !currentSection.isChapter) {
        // Update heading instead of creating new section
        currentSection.heading = block.text;
      } else if (!currentSection) {
        currentSection = { heading: block.text, blocks: [] };
      } else {
        // Add as a sub-heading block within current section
        currentSection.blocks.push(block);
      }
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
    sections.push({ heading: title, blocks: mergedBlocks });
  }

  return { title, sections, allBlocks: mergedBlocks };
}

/** Convert ParsedEbook back to JSON (stored in ebooks.formatted_json) */
export function toFormattedJson(parsed: ParsedEbook): object {
  return {
    title: parsed.title,
    sections: parsed.sections,
  };
}
