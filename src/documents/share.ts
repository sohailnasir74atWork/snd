/**
 * PDF + share pipeline (FR-5.3).
 *
 * The PDF is generated on the phone (offline-capable) and carried to WhatsApp.
 *
 * It used to always open the plain share sheet, which lands the sender in
 * WhatsApp's whole contact list to hunt for the shop he is standing in front
 * of — the old note here called that a platform limit, and it is not one.
 * `shareSingle` takes a `whatsAppNumber` and react-native-share's Android
 * implementation starts `com.whatsapp.Conversation` for it first, so the chat
 * opens even for a number that was never saved as a contact.
 *
 * The share sheet remains the fallback and always will: WhatsApp may not be
 * installed, the shop may have no number, and a booker who cannot send the
 * confirmation at all is worse off than one who taps a name.
 */
import { generatePDF } from 'react-native-html-to-pdf';
import Share, { Social } from 'react-native-share';
import { toCsv } from '../lib/csv';
import { utf8ToBase64 } from '../lib/base64';
import { normalizeWhatsApp } from '../lib/phone';

/** Who the document is for — a shop's number and the company's dialling code. */
export interface ShareTo {
  phone?: string;
  countryCode: string;
}

/**
 * `whatsAppNumber` is read by the native Android and iOS share code but is
 * missing from react-native-share's TypeScript definitions (12.3.1), hence the
 * narrow cast. Check `android/.../social/WhatsAppShare.java` before assuming
 * it has gone away.
 */
type WhatsAppSingleOptions = Parameters<typeof Share.shareSingle>[0] & { whatsAppNumber?: string };

export async function sharePdf(
  html: string, fileName: string, message: string, to?: ShareTo,
): Promise<void> {
  // base64 + data: URL, NOT a file:// path: RNShare's FileProvider does not
  // cover the directory RNHTMLtoPDF writes to, so file paths 404 at the
  // share sheet ("Failed to find configured root" — on-device smoke run).
  const { base64 } = await generatePDF({ html, fileName, base64: true });
  if (!base64) throw new Error('PDF generation failed');
  const common = {
    url: `data:application/pdf;base64,${base64}`,
    filename: fileName.replace(/\.pdf$/, ''),
    type: 'application/pdf',
    message,
    failOnCancel: false,
    useInternalStorage: true,
  };

  const number = to?.phone?.trim()
    ? normalizeWhatsApp(to.phone, to.countryCode)
    : '';
  if (number) {
    try {
      await Share.shareSingle({
        ...common, social: Social.Whatsapp, whatsAppNumber: number,
      } as WhatsAppSingleOptions);
      return;
    } catch {
      // WhatsApp missing, or it refused the number. Fall through to the sheet
      // rather than telling the booker the send failed — he still has a PDF
      // and every other way of getting it to the shop.
    }
  }
  await Share.open(common);
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
