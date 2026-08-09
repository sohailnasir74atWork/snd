/**
 * PDF + share pipeline (FR-5.3).
 *
 * The PDF is generated on the phone (offline-capable); Android's share sheet
 * carries it to WhatsApp with the numbers already written in the message.
 * Platform honesty (SRS §14.2): Android cannot pre-select the WhatsApp
 * recipient for a file — the sender taps the shop once in WhatsApp's list.
 */
import { generatePDF } from 'react-native-html-to-pdf';
import Share from 'react-native-share';
import { toCsv } from '../lib/csv';
import { utf8ToBase64 } from '../lib/base64';

export async function sharePdf(html: string, fileName: string, message: string): Promise<void> {
  // base64 + data: URL, NOT a file:// path: RNShare's FileProvider does not
  // cover the directory RNHTMLtoPDF writes to, so file paths 404 at the
  // share sheet ("Failed to find configured root" — on-device smoke run).
  const { base64 } = await generatePDF({ html, fileName, base64: true });
  if (!base64) throw new Error('PDF generation failed');
  await Share.open({
    url: `data:application/pdf;base64,${base64}`,
    filename: fileName.replace(/\.pdf$/, ''),
    type: 'application/pdf',
    message,
    failOnCancel: false,
    useInternalStorage: true,
  });
}

/** CSV export (FR-9) — data: URL through the share sheet, no filesystem needed. */
export async function shareCsv(filename: string, rows: (string | number | undefined)[][]): Promise<void> {
  await Share.open({
    url: `data:text/csv;base64,${utf8ToBase64(toCsv(rows))}`,
    filename: filename.replace(/\.csv$/, ''), // Android appends the extension from type
    type: 'text/csv',
    failOnCancel: false,
    // RNShare decodes data: URLs to a file first. Its FileProvider only covers
    // INTERNAL cache — the external-cache default 404s ("Failed to find
    // configured root", caught in the on-device smoke run).
    useInternalStorage: true,
  });
}
