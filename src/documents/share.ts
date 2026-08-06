/**
 * PDF + share pipeline (FR-5.3).
 *
 * The PDF is generated on the phone (offline-capable); Android's share sheet
 * carries it to WhatsApp with the numbers already written in the message.
 * Platform honesty (SRS §14.2): Android cannot pre-select the WhatsApp
 * recipient for a file — the sender taps the shop once in WhatsApp's list.
 */
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import Share from 'react-native-share';
import { toCsv } from '../lib/csv';
import { utf8ToBase64 } from '../lib/base64';

export async function sharePdf(html: string, fileName: string, message: string): Promise<void> {
  const { filePath } = await RNHTMLtoPDF.convert({ html, fileName, base64: false });
  if (!filePath) throw new Error('PDF generation failed');
  await Share.open({
    url: `file://${filePath}`,
    type: 'application/pdf',
    message,
    failOnCancel: false,
  });
}

/** CSV export (FR-9) — data: URL through the share sheet, no filesystem needed. */
export async function shareCsv(filename: string, rows: (string | number | undefined)[][]): Promise<void> {
  await Share.open({
    url: `data:text/csv;base64,${utf8ToBase64(toCsv(rows))}`,
    filename: filename.replace(/\.csv$/, ''), // Android appends the extension from type
    type: 'text/csv',
    failOnCancel: false,
  });
}
