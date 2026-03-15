/**
 * AI Formatting Utilities – Phase 4
 * - Uses OpenAI when key is available.
 * - Falls back to a fast heuristic formatter for local/offline development.
 */
import OpenAI from 'openai';
import { parseText, ParsedEbook, Block } from './textParser';

export interface AiFormatResult {
  parsed: ParsedEbook;
  formattedText: string;
  aiApplied: boolean;
  source: 'openai' | 'heuristic';
}

interface OpenAiBlock {
  type: 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet' | 'numbered' | 'quote' | 'callout' | 'divider';
  text: string;
  number?: string;
}

interface OpenAiSection {
  heading: string;
  blocks: OpenAiBlock[];
}

interface OpenAiPayload {
  title: string;
  sections: OpenAiSection[];
}

function getOpenAiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    return new OpenAI({ apiKey: key });
  } catch {
    return null;
  }
}

function looksLikeHeading(line: string): boolean {
  return /^(chapter\s+\d+|module\s+\d+|lesson\s+\d+|part\s+\d+|section\s+\d+)/i.test(line);
}

function heuristicMarkdown(rawText: string, fallbackTitle: string): string {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim());
  const output: string[] = [];

  const firstNonEmpty = lines.find((line) => line.length > 0);
  const title = firstNonEmpty && firstNonEmpty.length <= 90 ? firstNonEmpty : fallbackTitle;
  output.push(`# ${title}`);
  output.push('');

  for (const line of lines) {
    if (!line) {
      output.push('');
      continue;
    }
    if (/^#/.test(line) || /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^>\s*/.test(line)) {
      output.push(line);
      continue;
    }
    if (looksLikeHeading(line)) {
      output.push(`## ${line.replace(/[:\-–]\s*$/, '')}`);
      output.push('');
      continue;
    }
    if (/^(key\s*takeaway|note|tip|important|warning)[:\s]/i.test(line)) {
      output.push(`Key Takeaway: ${line.replace(/^(key\s*takeaway|note|tip|important|warning)[:\s]*/i, '')}`);
      continue;
    }
    if (line.length < 70 && /\?$/.test(line)) {
      output.push(`### ${line}`);
      continue;
    }
    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parsedToMarkdown(parsed: ParsedEbook): string {
  const lines: string[] = [];
  lines.push(`# ${parsed.title}`);
  lines.push('');

  for (const section of parsed.sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');

    for (const block of section.blocks) {
      if (block.type === 'h1') lines.push(`# ${block.text}`);
      else if (block.type === 'h2') lines.push(`## ${block.text}`);
      else if (block.type === 'h3') lines.push(`### ${block.text}`);
      else if (block.type === 'bullet') lines.push(`- ${block.text}`);
      else if (block.type === 'numbered') lines.push(`${block.number ?? '1.'} ${block.text}`);
      else if (block.type === 'quote') lines.push(`> ${block.text}`);
      else if (block.type === 'callout') lines.push(block.text);
      else if (block.type === 'divider') lines.push('---');
      else lines.push(block.text);
    }

    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeOpenAiPayload(payload: OpenAiPayload, fallbackTitle: string): ParsedEbook {
  const safeSections = Array.isArray(payload.sections) ? payload.sections : [];
  const sections = safeSections
    .filter((section) => section && typeof section.heading === 'string')
    .map((section) => {
      const blocks: Block[] = Array.isArray(section.blocks)
        ? section.blocks
            .filter((block) => block && typeof block.type === 'string')
            .map((block) => ({
              type: block.type,
              text: typeof block.text === 'string' ? block.text : '',
              number: block.number,
            }))
        : [];
      return { heading: section.heading.trim(), blocks };
    })
    .filter((section) => section.heading.length > 0);

  const title = (payload.title || fallbackTitle || 'Untitled Ebook').trim();
  const allBlocks = sections.flatMap((section) => section.blocks);

  if (!sections.length) {
    const parsed = parseText('', title);
    return { ...parsed, title };
  }

  return { title, sections, allBlocks };
}

export async function formatTextWithAI(rawText: string, fallbackTitle = 'Untitled Ebook'): Promise<AiFormatResult> {
  const trimmed = rawText.trim();
  if (!trimmed) {
    const parsed = parseText('', fallbackTitle);
    return { parsed, formattedText: '', aiApplied: false, source: 'heuristic' };
  }

  const openai = getOpenAiClient();
  if (!openai) {
    const formattedText = heuristicMarkdown(trimmed, fallbackTitle);
    const parsed = parseText(formattedText, fallbackTitle);
    return { parsed, formattedText, aiApplied: true, source: 'heuristic' };
  }

  try {
    const systemPrompt = [
      'You are a precise ebook formatter for CreatorLab.ink.',
      'Return strict JSON only in this shape:',
      '{"title":"...","sections":[{"heading":"...","blocks":[{"type":"paragraph|h1|h2|h3|bullet|numbered|quote|callout|divider","text":"...","number":"optional"}]}]}',
      'Rules:',
      '- Detect chapters/subheadings/bullets/quotes from raw text.',
      '- Keep user wording mostly intact, only structure it.',
      '- Ensure at least one section with non-empty heading.',
      '- Keep output concise and valid JSON.',
    ].join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmed },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const payload = JSON.parse(raw) as OpenAiPayload;
    const parsed = normalizeOpenAiPayload(payload, fallbackTitle);
    return {
      parsed,
      formattedText: parsedToMarkdown(parsed),
      aiApplied: true,
      source: 'openai',
    };
  } catch {
    const formattedText = heuristicMarkdown(trimmed, fallbackTitle);
    const parsed = parseText(formattedText, fallbackTitle);
    return { parsed, formattedText, aiApplied: true, source: 'heuristic' };
  }
}
