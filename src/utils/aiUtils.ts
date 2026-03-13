/**
 * AI Formatting Utilities – Phase 4 Placeholder
 * Will use the OpenAI API to detect chapter titles, headings,
 * bullet points, and key takeaways from raw pasted text.
 * Full implementation added in Phase 4: Templates & AI Formatting.
 */
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface FormattedEbook {
  title: string;
  chapters: {
    heading: string;
    body: string;
  }[];
}

// TODO Phase 4: Implement full AI-assisted ebook formatting
export const formatTextWithAI = async (rawText: string): Promise<FormattedEbook> => {
  const systemPrompt = `You are an expert ebook formatter. Given raw text, extract and return a JSON object with:
- title: the main ebook title
- chapters: array of { heading: string, body: string }
Detect chapter titles, subheadings, bullet points, and key takeaways automatically.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: rawText },
    ],
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(response.choices[0].message.content || '{}');
  return result as FormattedEbook;
};
