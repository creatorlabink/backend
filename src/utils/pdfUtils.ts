/**
 * PDF Utilities – Phase 3 Placeholder
 * Will use PDFKit to generate ebooks from structured text content.
 * Full implementation added in Phase 3: Text Input & Basic Ebook Export.
 */
import PDFDocument from 'pdfkit';
import { Response } from 'express';

export interface EbookContent {
  title: string;
  author?: string;
  chapters: {
    heading: string;
    body: string;
  }[];
}

// TODO Phase 3: Implement full template-aware PDF generation
export const generatePdf = (content: EbookContent, res: Response): void => {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${content.title}.pdf"`);
  doc.pipe(res);

  // Cover
  doc.fontSize(28).font('Helvetica-Bold').text(content.title, { align: 'center' });
  if (content.author) {
    doc.moveDown().fontSize(14).font('Helvetica').text(`by ${content.author}`, { align: 'center' });
  }
  doc.addPage();

  // Chapters
  for (const chapter of content.chapters) {
    doc.fontSize(18).font('Helvetica-Bold').text(chapter.heading);
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(chapter.body, { lineGap: 4 });
    doc.addPage();
  }

  doc.end();
};
