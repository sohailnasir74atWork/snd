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
