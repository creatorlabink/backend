/**
 * PDF Generation Utilities – Phase 3
 * Generates a formatted PDF from a ParsedEbook (output of textParser).
 * Phase 4 will add template-aware styles and AI-detected structure.
 */
import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { ParsedEbook, Block } from './textParser';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  primary:    '#4F46E5',
  heading:    '#111827',
  subheading: '#374151',
  body:       '#374151',
  muted:      '#6B7280',
  bullet:     '#4F46E5',
  quote_bg:   '#EEF2FF',
  callout_bg: '#FFFBEB',
  divider:    '#E5E7EB',
  white:      '#FFFFFF',
};

const FONTS = {
  regular: 'Helvetica',
  bold:    'Helvetica-Bold',
  oblique: 'Helvetica-Oblique',
};

const PAGE = {
  margins: { top: 72, bottom: 72, left: 72, right: 72 },
  width:   595.28,
  height:  841.89,
};
const CONTENT_WIDTH = PAGE.width - PAGE.margins.left - PAGE.margins.right;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function drawHR(doc: PDFKit.PDFDocument, y?: number): void {
  const yPos = y ?? doc.y;
  doc
    .moveTo(PAGE.margins.left, yPos)
    .lineTo(PAGE.width - PAGE.margins.right, yPos)
    .strokeColor(COLORS.divider)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
}

function renderBlock(doc: PDFKit.PDFDocument, block: Block): void {
  switch (block.type) {
    case 'h1':
      doc.moveDown(0.8);
      doc.fontSize(22).font(FONTS.bold).fillColor(COLORS.heading).text(block.text, { lineGap: 4 });
      drawHR(doc, doc.y + 6);
      doc.moveDown(0.4);
      break;

    case 'h2':
      doc.moveDown(0.6);
      doc.fontSize(17).font(FONTS.bold).fillColor(COLORS.heading).text(block.text, { lineGap: 4 });
      doc.moveDown(0.3);
      break;

    case 'h3':
      doc.moveDown(0.4);
      doc.fontSize(13).font(FONTS.bold).fillColor(COLORS.subheading).text(block.text, { lineGap: 4 });
      doc.moveDown(0.2);
      break;

    case 'paragraph':
      doc.fontSize(11).font(FONTS.regular).fillColor(COLORS.body).text(block.text, { lineGap: 4, paragraphGap: 8 });
      break;

    case 'bullet': {
      const bX = PAGE.margins.left + 12;
      const tX = bX + 14;
      const sY = doc.y;
      doc.circle(bX, sY + 5.5, 2.5).fillColor(COLORS.bullet).fill();
      doc.fontSize(11).font(FONTS.regular).fillColor(COLORS.body)
        .text(block.text, tX, sY, { width: CONTENT_WIDTH - 26, lineGap: 4, paragraphGap: 4 });
      break;
    }

    case 'numbered': {
      const nX = PAGE.margins.left + 4;
      const tX = nX + 22;
      const sY = doc.y;
      doc.fontSize(11).font(FONTS.bold).fillColor(COLORS.primary).text(block.number ?? '', nX, sY, { width: 20 });
      doc.fontSize(11).font(FONTS.regular).fillColor(COLORS.body)
        .text(block.text, tX, sY, { width: CONTENT_WIDTH - 26, lineGap: 4, paragraphGap: 4 });
      break;
    }

    case 'quote': {
      doc.moveDown(0.3);
      const qY = doc.y;
      const qH = doc.heightOfString(block.text, { width: CONTENT_WIDTH - 40 }) + 24;
      doc.rect(PAGE.margins.left, qY, CONTENT_WIDTH, qH).fillColor(COLORS.quote_bg).fill();
      doc.rect(PAGE.margins.left, qY, 4, qH).fillColor(COLORS.primary).fill();
      doc.fontSize(11).font(FONTS.oblique).fillColor(COLORS.subheading)
        .text(block.text, PAGE.margins.left + 16, qY + 12, { width: CONTENT_WIDTH - 32, lineGap: 4 });
      doc.moveDown(0.4);
      break;
    }

    case 'callout': {
      doc.moveDown(0.3);
      const cY = doc.y;
      const cH = doc.heightOfString(block.text, { width: CONTENT_WIDTH - 40 }) + 24;
      doc.rect(PAGE.margins.left, cY, CONTENT_WIDTH, cH).fillColor(COLORS.callout_bg).fill();
      doc.fontSize(11).font(FONTS.bold).fillColor('#B45309')
        .text(block.text, PAGE.margins.left + 14, cY + 12, { width: CONTENT_WIDTH - 28, lineGap: 4 });
      doc.moveDown(0.4);
      break;
    }

    case 'divider':
      doc.moveDown(0.4);
      drawHR(doc);
      break;
  }
}

function renderCover(doc: PDFKit.PDFDocument, title: string, author: string, sectionCount: number): void {
  const midY = PAGE.height / 2 - 60;
  doc.rect(0, 0, PAGE.width, 8).fillColor(COLORS.primary).fill();
  doc.fontSize(32).font(FONTS.bold).fillColor(COLORS.heading)
    .text(title, PAGE.margins.left, midY, { width: CONTENT_WIDTH, align: 'center', lineGap: 8 });
  const divY = doc.y + 20;
  doc.moveTo(PAGE.width / 2 - 60, divY).lineTo(PAGE.width / 2 + 60, divY)
    .strokeColor(COLORS.primary).lineWidth(2).stroke();
  if (author) {
    doc.moveDown(1.5).fontSize(14).font(FONTS.regular).fillColor(COLORS.muted)
      .text(`by ${author}`, PAGE.margins.left, undefined, { width: CONTENT_WIDTH, align: 'center' });
  }
  doc.moveDown(0.8).fontSize(11).font(FONTS.regular).fillColor(COLORS.muted)
    .text(
      `${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}  •  Generated with CreatorLab.ink`,
      PAGE.margins.left, undefined, { width: CONTENT_WIDTH, align: 'center' }
    );
  doc.rect(0, PAGE.height - 8, PAGE.width, 8).fillColor(COLORS.primary).fill();
}

function renderToc(doc: PDFKit.PDFDocument, sections: { heading: string }[]): void {
  doc.addPage();
  doc.rect(0, 0, PAGE.width, 8).fillColor(COLORS.primary).fill();
  doc.moveDown(1).fontSize(18).font(FONTS.bold).fillColor(COLORS.heading)
    .text('Table of Contents', PAGE.margins.left, PAGE.margins.top + 20);
  drawHR(doc, doc.y + 8);
  doc.moveDown(0.6);
  sections.forEach((s, idx) => {
    doc.fontSize(12).font(FONTS.regular).fillColor(COLORS.body)
      .text(`${idx + 1}.  ${s.heading}`, PAGE.margins.left, undefined, { width: CONTENT_WIDTH, lineGap: 6 });
  });
}

function addPageNumbers(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(9).font(FONTS.regular).fillColor(COLORS.muted)
      .text(
        `Page ${i + 1} of ${range.count}  |  CreatorLab.ink`,
        PAGE.margins.left, PAGE.height - PAGE.margins.bottom + 20,
        { width: CONTENT_WIDTH, align: 'center' }
      );
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────
export function generatePdfFromParsed(parsed: ParsedEbook, author: string, res: Response): void {
  const doc = new PDFDocument({
    margins: PAGE.margins,
    bufferPages: true,
    info: { Title: parsed.title, Author: author || 'CreatorLab.ink', Creator: 'CreatorLab.ink' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${parsed.title.replace(/[^a-z0-9]/gi, '_')}.pdf"`
  );
  doc.pipe(res);

  renderCover(doc, parsed.title, author, parsed.sections.length);

  if (parsed.sections.length > 1) {
    renderToc(doc, parsed.sections);
  }

  for (const section of parsed.sections) {
    doc.addPage();
    doc.rect(0, 0, PAGE.width, 8).fillColor(COLORS.primary).fill();
    doc.fontSize(20).font(FONTS.bold).fillColor(COLORS.heading)
      .text(section.heading, PAGE.margins.left, PAGE.margins.top + 16, { width: CONTENT_WIDTH, lineGap: 6 });
    drawHR(doc, doc.y + 8);
    doc.moveDown(0.5);
    for (const block of section.blocks) {
      if (doc.y > PAGE.height - PAGE.margins.bottom - 60) doc.addPage();
      renderBlock(doc, block);
    }
  }

  addPageNumbers(doc);
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
