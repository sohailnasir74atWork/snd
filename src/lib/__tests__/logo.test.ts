import { LOGO, base64Bytes, logoDataUri, logoProblem } from '../logo';

describe('what may be used as a company logo', () => {
  test('a normal downscaled logo is accepted', () => {
    expect(logoProblem(512, 512, 60 * 1024)).toBeNull();
    expect(logoProblem(512, 300, 40 * 1024)).toBeNull(); // wide logos are fine
  });

  test('too small is rejected, and the message says how small', () => {
    const msg = logoProblem(150, 150, 4000);
    expect(msg).toContain('150×150');
    expect(msg).toContain(String(LOGO.minEdge));
  });

  test('the SHORT edge decides — a long thin strip is still too thin', () => {
    expect(logoProblem(2000, 40, 9000)).not.toBeNull();
  });

  test('an unreadable file is called that, not "too small"', () => {
    expect(logoProblem(0, 0, 0)).toContain('could not be read');
  });

  test('over the byte budget is rejected with both numbers', () => {
    const msg = logoProblem(512, 512, LOGO.maxBytes + 1);
    expect(msg).toContain('KB');
  });

  test('base64Bytes counts padding out', () => {
    expect(base64Bytes('AAAA')).toBe(3);
    expect(base64Bytes('AAA=')).toBe(2);
    expect(base64Bytes('AA==')).toBe(1);
  });

  test('no logo means no data URI, and bills print fine', () => {
    expect(logoDataUri(undefined)).toBeUndefined();
    expect(logoDataUri('abc')).toBe('data:image/jpeg;base64,abc');
  });
});
