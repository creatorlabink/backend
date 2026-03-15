/**
 * PDF Generation Utilities – Phase 5 (Beautiful Design)
 * Creates professionally styled PDFs with:
 *   - Styled cover page with title
 *   - Table of contents
 *   - Chapter banners (navy + gold accent) - inline, not separate pages
 *   - Pull-quote boxes (gold border, cream background)
 *   - Navy callout boxes for goals, summaries, important messages
 *   - Teal highlight boxes for bullet lists
 *   - Gold action task boxes at end of chapters
 *   - Styled prompt boxes (teal border, light green background)
 *   - Navy header bar and gold page numbers on every page
 *   - Color scheme: Navy #0D1B2A, Gold #F5A623, Teal #1DB8A6, Grey #F4F6F9, Cream #FDF6E3
 */
import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { ParsedEbook, Block, ParsedSection } from './textParser';

export type EbookTemplate = 'minimal' | 'business' | 'workbook';

// ─── Color Schemes per Template ───────────────────────────────────────────────
interface TemplateTheme {
  // Brand colors
  primary: string;      // Main accent (navy/teal/purple)
  secondary: string;    // Secondary accent (gold/orange/pink)
  accent: string;       // Tertiary accent (teal/blue/violet)
  
  // Backgrounds
  coverBg: string;      // Cover page background
  headerBg: string;     // Header bar background
  chapterBg: string;    // Chapter banner background
  quoteBg: string;      // Pull-quote box background
  quoteBorder: string;  // Pull-quote border
  calloutBg: string;    // Callout/goal box background
  bulletBg: string;     // Bullet list container background
  actionBg: string;     // Action task box background
  promptBg: string;     // Prompt box background
  promptBorder: string; // Prompt left border
  
  // Text colors
  heading: string;      // Main heading text
  subheading: string;   // Subheading text
  body: string;         // Body text
  muted: string;        // Muted/footer text
  light: string;        // Light text (on dark bg)
  
  // Misc
  divider: string;      // Horizontal rules
  pageNum: string;      // Page number color
}

const TEMPLATE_THEMES: Record<EbookTemplate, TemplateTheme> = {
  minimal: {
    // The beautiful design from the user's spec
    primary: '#0D1B2A',      // Deep navy
    secondary: '#F5A623',    // Gold
    accent: '#1DB8A6',       // Teal
    
    coverBg: '#0D1B2A',
    headerBg: '#0D1B2A',
    chapterBg: '#0D1B2A',
    quoteBg: '#FDF6E3',      // Cream
    quoteBorder: '#F5A623',  // Gold
    calloutBg: '#0D1B2A',    // Navy callout
    bulletBg: '#E6F7F5',     // Light teal
    actionBg: '#FEF3D1',     // Light gold
    promptBg: '#E8F5E9',     // Light green
    promptBorder: '#1DB8A6', // Teal
    
    heading: '#0D1B2A',
    subheading: '#1E3A5F',
    body: '#2D3748',
    muted: '#6B7280',
    light: '#FFFFFF',
    
    divider: '#E5E7EB',
    pageNum: '#F5A623',      // Gold page numbers
  },
  business: {
    primary: '#1E3A5F',      // Corporate blue
    secondary: '#C9A227',    // Corporate gold
    accent: '#2B6CB0',       // Accent blue
    
    coverBg: '#1E3A5F',
    headerBg: '#1E3A5F',
    chapterBg: '#1E3A5F',
    quoteBg: '#F7F7F2',
    quoteBorder: '#C9A227',
    calloutBg: '#1E3A5F',
    bulletBg: '#EBF4FF',
    actionBg: '#FDF6E3',
    promptBg: '#F0F9FF',
    promptBorder: '#2B6CB0',
    
    heading: '#1E3A5F',
    subheading: '#2D4A6F',
    body: '#374151',
    muted: '#6B7280',
    light: '#FFFFFF',
    
    divider: '#D1D5DB',
    pageNum: '#C9A227',
  },
  workbook: {
    primary: '#5B21B6',      // Purple
    secondary: '#F59E0B',    // Amber
    accent: '#8B5CF6',       // Violet
    
    coverBg: '#5B21B6',
    headerBg: '#5B21B6',
    chapterBg: '#5B21B6',
    quoteBg: '#FEF3C7',
    quoteBorder: '#F59E0B',
    calloutBg: '#5B21B6',
    bulletBg: '#F5F3FF',
    actionBg: '#FEF9C3',
    promptBg: '#EDE9FE',
    promptBorder: '#8B5CF6',
    
    heading: '#5B21B6',
    subheading: '#6D28D9',
    body: '#374151',
    muted: '#6B7280',
    light: '#FFFFFF',
    
    divider: '#DDD6FE',
    pageNum: '#F59E0B',
  },
};

// ─── Page Constants (A4 with 20mm margins) ────────────────────────────────────
const MM_TO_PT = 2.83465;
const MARGIN = 20 * MM_TO_PT;  // 20mm margins

const PAGE = {
  width: 595.28,              // A4 width
  height: 841.89,             // A4 height
  margins: { 
    top: MARGIN + 20,         // Extra space for header
    bottom: MARGIN + 20,      // Extra space for footer
    left: MARGIN, 
    right: MARGIN 
  },
};

const CONTENT_WIDTH = PAGE.width - PAGE.margins.left - PAGE.margins.right;
const HEADER_HEIGHT = 6;
const FOOTER_Y = PAGE.height - PAGE.margins.bottom + 10;

// ─── Typography ───────────────────────────────────────────────────────────────
const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
};

const FONT_SIZES = {
  coverTitle: 36,
  coverSubtitle: 14,
  chapterTitle: 20,
  h1: 18,
  h2: 15,
  h3: 12,
  body: 10.5,
  small: 9,
  footer: 8,
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Draw header bar at top of page */
function drawHeader(doc: PDFKit.PDFDocument, theme: TemplateTheme): void {
  doc.rect(0, 0, PAGE.width, HEADER_HEIGHT).fill(theme.headerBg);
}

/** Draw footer with page number */
function drawFooter(doc: PDFKit.PDFDocument, theme: TemplateTheme, pageNum: number, totalPages: number): void {
  doc.fontSize(FONT_SIZES.footer).font(FONTS.regular).fillColor(theme.muted)
    .text('Creatorlab', PAGE.margins.left, FOOTER_Y, { continued: true });
  
  doc.fillColor(theme.pageNum)
    .text(`  •  Page ${pageNum} of ${totalPages}`, { align: 'left' });
}

/** Draw horizontal divider */
function drawDivider(doc: PDFKit.PDFDocument, theme: TemplateTheme, y?: number): void {
  const yPos = y ?? doc.y;
  doc.moveTo(PAGE.margins.left, yPos)
    .lineTo(PAGE.width - PAGE.margins.right, yPos)
    .strokeColor(theme.divider)
    .lineWidth(0.5)
    .stroke();
  doc.y = yPos + 8;
}

/** Check if we need a new page */
function ensureSpace(doc: PDFKit.PDFDocument, height: number): boolean {
  if (doc.y + height > PAGE.height - PAGE.margins.bottom - 30) {
    doc.addPage();
    return true;
  }
  return false;
}

/** Draw a rounded rectangle */
function roundedRect(
  doc: PDFKit.PDFDocument, 
  x: number, 
  y: number, 
  w: number, 
  h: number, 
  r: number
): PDFKit.PDFDocument {
  return doc
    .moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r)
    .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h)
    .quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y);
}

// ─── Block Renderers ──────────────────────────────────────────────────────────

function renderChapterBanner(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string, chapterNum?: number): void {
  const bannerHeight = 50;
  ensureSpace(doc, bannerHeight + 30);
  
  const y = doc.y;
  
  // Navy background
  doc.rect(PAGE.margins.left, y, CONTENT_WIDTH, bannerHeight).fill(theme.chapterBg);
  
  // Gold accent line at bottom
  doc.rect(PAGE.margins.left, y + bannerHeight - 4, CONTENT_WIDTH, 4).fill(theme.secondary);
  
  // Chapter title
  const chapterLabel = chapterNum ? `CHAPTER ${chapterNum}` : '';
  if (chapterLabel) {
    doc.fontSize(FONT_SIZES.small).font(FONTS.bold).fillColor(theme.secondary)
      .text(chapterLabel, PAGE.margins.left + 16, y + 10, { width: CONTENT_WIDTH - 32 });
  }
  
  doc.fontSize(FONT_SIZES.chapterTitle).font(FONTS.bold).fillColor(theme.light)
    .text(text, PAGE.margins.left + 16, chapterLabel ? y + 22 : y + 16, { width: CONTENT_WIDTH - 32 });
  
  doc.y = y + bannerHeight + 16;
}

function renderHeading1(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.fontSize(FONT_SIZES.h1).font(FONTS.bold).fillColor(theme.heading).text(text, { lineGap: 4 });
  doc.moveDown(0.3);
  drawDivider(doc, theme);
}

function renderHeading2(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 30);
  doc.moveDown(0.5);
  doc.fontSize(FONT_SIZES.h2).font(FONTS.bold).fillColor(theme.heading).text(text, { lineGap: 4 });
  doc.moveDown(0.3);
}

function renderHeading3(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 25);
  doc.moveDown(0.4);
  doc.fontSize(FONT_SIZES.h3).font(FONTS.bold).fillColor(theme.subheading).text(text, { lineGap: 3 });
  doc.moveDown(0.2);
}

function renderParagraph(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 20);
  doc.fontSize(FONT_SIZES.body).font(FONTS.regular).fillColor(theme.body)
    .text(text, PAGE.margins.left, doc.y, { 
      width: CONTENT_WIDTH, 
      lineGap: 4, 
      paragraphGap: 4,
      align: 'justify' 
    });
  doc.moveDown(0.4);
}

function renderBulletGroup(doc: PDFKit.PDFDocument, theme: TemplateTheme, bullets: Block[]): void {
  const itemHeight = 18;
  const padding = 12;
  const boxHeight = (bullets.length * itemHeight) + (padding * 2) + 10;
  
  ensureSpace(doc, boxHeight);
  const startY = doc.y;
  
  // Teal background box
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, boxHeight, 6)
    .fill(theme.bulletBg);
  
  // Teal left accent bar
  doc.rect(PAGE.margins.left, startY, 4, boxHeight).fill(theme.accent);
  
  doc.y = startY + padding;
  
  for (const bullet of bullets) {
    const bulletY = doc.y;
    // Teal bullet point
    doc.circle(PAGE.margins.left + 18, bulletY + 5, 3).fill(theme.accent);
    
    doc.fontSize(FONT_SIZES.body).font(FONTS.regular).fillColor(theme.body)
      .text(bullet.text, PAGE.margins.left + 28, bulletY, { 
        width: CONTENT_WIDTH - 40, 
        lineGap: 3 
      });
    doc.moveDown(0.2);
  }
  
  doc.y = startY + boxHeight + 10;
}

function renderNumberedItem(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string, number: string): void {
  ensureSpace(doc, 20);
  const startY = doc.y;
  
  // Number in accent color
  doc.fontSize(FONT_SIZES.body).font(FONTS.bold).fillColor(theme.accent)
    .text(number, PAGE.margins.left + 4, startY, { width: 24 });
  
  doc.fontSize(FONT_SIZES.body).font(FONTS.regular).fillColor(theme.body)
    .text(text, PAGE.margins.left + 28, startY, { width: CONTENT_WIDTH - 32, lineGap: 3 });
  doc.moveDown(0.3);
}

function renderQuote(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  const padding = 14;
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - (padding * 2) - 6 });
  const boxHeight = textHeight + (padding * 2);
  
  ensureSpace(doc, boxHeight + 16);
  const startY = doc.y + 6;
  
  // Cream background
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, boxHeight, 6)
    .fill(theme.quoteBg);
  
  // Gold left border
  doc.rect(PAGE.margins.left, startY, 5, boxHeight).fill(theme.quoteBorder);
  
  // Quote icon/text
  doc.fontSize(FONT_SIZES.body).font(FONTS.italic).fillColor(theme.subheading)
    .text(text, PAGE.margins.left + padding + 6, startY + padding, { 
      width: CONTENT_WIDTH - (padding * 2) - 6, 
      lineGap: 4,
      align: 'left'
    });
  
  doc.y = startY + boxHeight + 10;
}

function renderCallout(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  const padding = 14;
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - (padding * 2) - 8 });
  const boxHeight = textHeight + (padding * 2);
  
  ensureSpace(doc, boxHeight + 16);
  const startY = doc.y + 6;
  
  // Navy background
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, boxHeight, 6)
    .fill(theme.calloutBg);
  
  // White text
  doc.fontSize(FONT_SIZES.body).font(FONTS.bold).fillColor(theme.light)
    .text(text, PAGE.margins.left + padding, startY + padding, { 
      width: CONTENT_WIDTH - (padding * 2), 
      lineGap: 4 
    });
  
  doc.y = startY + boxHeight + 10;
}

function renderGoal(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 50);
  doc.moveDown(0.5);
  
  const startY = doc.y;
  const padding = 12;
  const headerHeight = 28;
  
  // Navy header bar
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, headerHeight, 6)
    .fill(theme.calloutBg);
  
  // Trophy/target icon placeholder + title
  doc.fontSize(FONT_SIZES.h3).font(FONTS.bold).fillColor(theme.light)
    .text('🎯 ' + text, PAGE.margins.left + padding, startY + 8, { width: CONTENT_WIDTH - (padding * 2) });
  
  doc.y = startY + headerHeight + 10;
}

function renderActionTask(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  ensureSpace(doc, 50);
  doc.moveDown(0.5);
  
  const startY = doc.y;
  const padding = 12;
  const headerHeight = 32;
  
  // Gold background header
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, headerHeight, 6)
    .fill(theme.actionBg);
  
  // Gold left accent
  doc.rect(PAGE.margins.left, startY, 5, headerHeight).fill(theme.secondary);
  
  // Action icon + title
  doc.fontSize(FONT_SIZES.h3).font(FONTS.bold).fillColor(theme.heading)
    .text('✅ ' + text, PAGE.margins.left + padding + 6, startY + 10, { width: CONTENT_WIDTH - (padding * 2) - 6 });
  
  doc.y = startY + headerHeight + 10;
}

function renderPrompt(doc: PDFKit.PDFDocument, theme: TemplateTheme, text: string): void {
  const padding = 14;
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - (padding * 2) - 10 });
  const headerHeight = 24;
  const boxHeight = headerHeight + textHeight + (padding * 2);
  
  ensureSpace(doc, boxHeight + 16);
  const startY = doc.y + 6;
  
  // Light green background
  roundedRect(doc, PAGE.margins.left, startY, CONTENT_WIDTH, boxHeight, 6)
    .fill(theme.promptBg);
  
  // Teal left border
  doc.rect(PAGE.margins.left, startY, 5, boxHeight).fill(theme.promptBorder);
  
  // Header label
  doc.fontSize(FONT_SIZES.small).font(FONTS.bold).fillColor(theme.accent)
    .text('💬 CHATGPT PROMPT', PAGE.margins.left + padding + 6, startY + 8);
  
  // Prompt text (monospace-like styling)
  doc.fontSize(FONT_SIZES.body - 0.5).font(FONTS.regular).fillColor(theme.body)
    .text(text, PAGE.margins.left + padding + 6, startY + headerHeight + 4, { 
      width: CONTENT_WIDTH - (padding * 2) - 10, 
      lineGap: 4 
    });
  
  doc.y = startY + boxHeight + 10;
}

function renderDivider(doc: PDFKit.PDFDocument, theme: TemplateTheme): void {
  doc.moveDown(0.3);
  drawDivider(doc, theme);
  doc.moveDown(0.3);
}

// ─── Block Router ─────────────────────────────────────────────────────────────

function renderBlock(doc: PDFKit.PDFDocument, theme: TemplateTheme, block: Block, nextBlocks: Block[]): number {
  switch (block.type) {
    case 'chapter':
      renderChapterBanner(doc, theme, block.text, block.chapterNum);
      return 0;
    case 'h1':
      renderHeading1(doc, theme, block.text);
      return 0;
    case 'h2':
      renderHeading2(doc, theme, block.text);
      return 0;
    case 'h3':
      renderHeading3(doc, theme, block.text);
      return 0;
    case 'paragraph':
      renderParagraph(doc, theme, block.text);
      return 0;
    case 'bullet': {
      // Collect consecutive bullets for grouped rendering
      const bullets: Block[] = [block];
      let skip = 0;
      for (const next of nextBlocks) {
        if (next.type === 'bullet') {
          bullets.push(next);
          skip++;
        } else break;
      }
      renderBulletGroup(doc, theme, bullets);
      return skip;
    }
    case 'numbered':
      renderNumberedItem(doc, theme, block.text, block.number || '•');
      return 0;
    case 'quote':
      renderQuote(doc, theme, block.text);
      return 0;
    case 'callout':
      renderCallout(doc, theme, block.text);
      return 0;
    case 'goal':
      renderGoal(doc, theme, block.text);
      return 0;
    case 'action_task':
      renderActionTask(doc, theme, block.text);
      return 0;
    case 'prompt':
    case 'prompt_text':
      renderPrompt(doc, theme, block.text);
      return 0;
    case 'divider':
      renderDivider(doc, theme);
      return 0;
    default:
      renderParagraph(doc, theme, block.text);
      return 0;
  }
}

// ─── Cover Page ───────────────────────────────────────────────────────────────

function renderCoverPage(
  doc: PDFKit.PDFDocument, 
  theme: TemplateTheme, 
  title: string, 
  author: string,
  sectionCount: number,
  template: EbookTemplate,
  aiApplied: boolean
): void {
  // Full page navy background
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(theme.coverBg);
  
  // Gold accent bar at top
  doc.rect(0, 0, PAGE.width, 12).fill(theme.secondary);
  
  // Decorative gold element (centered)
  const centerX = PAGE.width / 2;
  const decorY = PAGE.height * 0.3;
  doc.rect(centerX - 40, decorY, 80, 3).fill(theme.secondary);
  
  // Title
  const titleY = PAGE.height * 0.38;
  doc.fontSize(FONT_SIZES.coverTitle).font(FONTS.bold).fillColor(theme.light)
    .text(title.toUpperCase(), PAGE.margins.left, titleY, { 
      width: CONTENT_WIDTH, 
      align: 'center',
      lineGap: 8
    });
  
  // Subtitle line
  const subY = doc.y + 20;
  doc.rect(centerX - 50, subY, 100, 2).fill(theme.secondary);
  
  // Author
  if (author) {
    doc.moveDown(2);
    doc.fontSize(FONT_SIZES.coverSubtitle).font(FONTS.regular).fillColor(theme.light)
      .text(`by ${author}`, PAGE.margins.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });
  }
  
  // Footer info
  const footerY = PAGE.height - 100;
  doc.fontSize(FONT_SIZES.small).font(FONTS.regular).fillColor(theme.secondary)
    .text(
      `${sectionCount} ${sectionCount === 1 ? 'Chapter' : 'Chapters'}  •  ${template.charAt(0).toUpperCase() + template.slice(1)} Edition`,
      PAGE.margins.left, footerY, { width: CONTENT_WIDTH, align: 'center' }
    );
  
  if (aiApplied) {
    doc.moveDown(0.5);
    doc.fontSize(FONT_SIZES.small).font(FONTS.italic).fillColor(theme.secondary)
      .text('Formatted with AI assistance', PAGE.margins.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });
  }
  
  // Gold accent bar at bottom
  doc.rect(0, PAGE.height - 12, PAGE.width, 12).fill(theme.secondary);
  
  // "Created with Creatorlab" branding
  doc.fontSize(FONT_SIZES.footer).font(FONTS.regular).fillColor(theme.light)
    .text('Created with Creatorlab', PAGE.margins.left, PAGE.height - 30, { width: CONTENT_WIDTH, align: 'center' });
}

// ─── Table of Contents ────────────────────────────────────────────────────────

function renderTableOfContents(doc: PDFKit.PDFDocument, theme: TemplateTheme, sections: ParsedSection[]): void {
  doc.addPage();
  drawHeader(doc, theme);
  
  const startY = PAGE.margins.top + 20;
  
  // Title
  doc.fontSize(FONT_SIZES.h1).font(FONTS.bold).fillColor(theme.heading)
    .text('Table of Contents', PAGE.margins.left, startY);
  
  doc.moveDown(0.3);
  drawDivider(doc, theme);
  doc.moveDown(0.5);
  
  sections.forEach((section, idx) => {
    ensureSpace(doc, 25);
    
    const y = doc.y;
    const num = section.chapterNum || (idx + 1);
    const isChapter = section.isChapter;
    
    if (isChapter) {
      // Chapter entries are bolder
      doc.fontSize(FONT_SIZES.body + 1).font(FONTS.bold).fillColor(theme.heading)
        .text(`Chapter ${num}`, PAGE.margins.left, y, { continued: true });
      doc.font(FONTS.regular).text(`   ${section.heading}`);
    } else {
      doc.fontSize(FONT_SIZES.body).font(FONTS.regular).fillColor(theme.body)
        .text(`${num}.  ${section.heading}`, PAGE.margins.left, y);
    }
    
    doc.moveDown(0.4);
  });
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function generatePdfFromParsed(
  parsed: ParsedEbook,
  author: string,
  res: Response,
  template: EbookTemplate = 'minimal',
  aiApplied = false
): void {
  const theme = TEMPLATE_THEMES[template] || TEMPLATE_THEMES.minimal;
  
  const doc = new PDFDocument({
    margins: PAGE.margins,
    bufferPages: true,
    info: { 
      Title: parsed.title, 
      Author: author || 'Creatorlab', 
      Creator: 'Creatorlab',
      Producer: 'Creatorlab PDF Engine'
    },
    size: 'A4',
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${parsed.title.replace(/[^a-z0-9]/gi, '_')}.pdf"`
  );
  doc.pipe(res);

  // 1. Cover page
  renderCoverPage(doc, theme, parsed.title, author, parsed.sections.length, template, aiApplied);

  // 2. Table of contents (if more than 1 section)
  if (parsed.sections.length > 1) {
    renderTableOfContents(doc, theme, parsed.sections);
  }

  // 3. Content pages
  for (const section of parsed.sections) {
    doc.addPage();
    drawHeader(doc, theme);
    doc.y = PAGE.margins.top + 10;
    
    // Render chapter banner for chapter sections
    if (section.isChapter) {
      renderChapterBanner(doc, theme, section.heading, section.chapterNum);
    } else {
      // Non-chapter sections get a simple heading
      doc.fontSize(FONT_SIZES.h1).font(FONTS.bold).fillColor(theme.heading)
        .text(section.heading, PAGE.margins.left, doc.y);
      doc.moveDown(0.3);
      drawDivider(doc, theme);
    }
    
    // Render blocks
    const blocks = section.blocks;
    let i = 0;
    while (i < blocks.length) {
      // Check for page break (accounting for headers)
      if (doc.y > PAGE.height - PAGE.margins.bottom - 40) {
        doc.addPage();
        drawHeader(doc, theme);
        doc.y = PAGE.margins.top + 10;
      }
      
      const block = blocks[i];
      const remaining = blocks.slice(i + 1);
      const skip = renderBlock(doc, theme, block, remaining);
      i += 1 + skip;
    }
  }

  // 4. Add page numbers to all pages except cover
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {  // Start from 1 to skip cover
    doc.switchToPage(range.start + i);
    drawFooter(doc, theme, i, range.count - 1);
  }

  doc.end();
}

// ─── Legacy wrapper ───────────────────────────────────────────────────────────
export interface EbookContent {
  title: string;
  author?: string;
  chapters: { heading: string; body: string }[];
}

export const generatePdf = (content: EbookContent, res: Response): void => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseText } = require('./textParser') as typeof import('./textParser');
  const rawCombined = content.chapters.map((c) => `## ${c.heading}\n${c.body}`).join('\n\n');
  const parsed = parseText(rawCombined, content.title);
  parsed.title = content.title;
  generatePdfFromParsed(parsed, content.author ?? '', res);
};
