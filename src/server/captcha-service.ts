import { randomBytes, randomInt } from 'node:crypto';

interface CaptchaItem {
  code: string;
  expiresAt: number;
}

interface CaptchaChallenge {
  captchaId: string;
  captchaSvg: string;
  expiresInSeconds: number;
}

interface CaptchaCheckResult {
  ok: boolean;
  error?: string;
}

const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type GlyphRows = readonly [string, string, string, string, string, string, string];

const CAPTCHA_GLYPHS: Record<string, GlyphRows> = {
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10000', '10011', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

const randomCharFrom = (source: string): string => source[randomInt(source.length)] ?? source[0];

const randomFromArray = <T>(source: T[]): T => source[randomInt(source.length)] ?? source[0];

class CaptchaService {
  private readonly ttlMs = 5 * 60 * 1000;

  private readonly codeLength = 4;

  private readonly width = 132;

  private readonly height = 46;

  private readonly glyphPixel = 4;

  private readonly maxItems = 5000;

  private readonly items = new Map<string, CaptchaItem>();

  createChallenge(): CaptchaChallenge {
    this.cleanup();
    const code = this.buildCode();
    const captchaId = randomBytes(18).toString('base64url');
    this.items.set(captchaId, {
      code,
      expiresAt: Date.now() + this.ttlMs,
    });

    if (this.items.size > this.maxItems) {
      this.cleanup(Math.ceil(this.maxItems * 0.1));
    }

    return {
      captchaId,
      captchaSvg: this.buildSvgDataUri(code),
      expiresInSeconds: Math.floor(this.ttlMs / 1000),
    };
  }

  verifyAndConsume(captchaIdInput: string, captchaCodeInput: string): CaptchaCheckResult {
    this.cleanup();

    const captchaId = captchaIdInput.trim();
    const captchaCode = captchaCodeInput.trim().toUpperCase();
    if (!captchaId || !captchaCode) {
      return { ok: false, error: '请先输入验证码。' };
    }

    const challenge = this.items.get(captchaId);
    if (!challenge) {
      return { ok: false, error: '验证码已失效，请刷新后重试。' };
    }
    this.items.delete(captchaId);

    if (challenge.expiresAt <= Date.now()) {
      return { ok: false, error: '验证码已过期，请刷新后重试。' };
    }
    if (captchaCode !== challenge.code) {
      return { ok: false, error: '验证码错误，请重试。' };
    }
    return { ok: true };
  }

  private buildCode(): string {
    let code = '';
    for (let i = 0; i < this.codeLength; i += 1) {
      code += randomCharFrom(CAPTCHA_CHARS);
    }
    return code;
  }

  private buildSvgDataUri(code: string): string {
    const noiseLines = Array.from({ length: 7 }, () => {
      const x1 = randomInt(this.width);
      const y1 = randomInt(this.height);
      const x2 = randomInt(this.width);
      const y2 = randomInt(this.height);
      const strokeWidth = randomInt(1, 3);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(20,80,80,0.3)" stroke-width="${strokeWidth}"/>`;
    }).join('');

    const noiseDots = Array.from({ length: 16 }, () => {
      const cx = randomInt(this.width);
      const cy = randomInt(this.height);
      const r = randomInt(1, 3);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(10,90,90,0.25)"/>`;
    }).join('');

    const letters = code
      .split('')
      .map((char, index) => {
        const x = 14 + index * 29 + randomInt(-2, 3);
        const y = 8 + randomInt(-2, 3);
        const rotate = randomInt(-20, 21);
        const skew = randomInt(-13, 14);
        const scale = this.glyphPixel + randomInt(0, 2);
        const color = randomFromArray(['#065f46', '#0f766e', '#155e75', '#1d4ed8', '#7c2d12']);
        const body = this.renderGlyph(char, scale);
        const centerX = (5 * scale) / 2;
        const centerY = (7 * scale) / 2;
        return `<g transform="translate(${x} ${y})"><g fill="${color}" transform="rotate(${rotate} ${centerX} ${centerY}) skewX(${skew})">${body}</g></g>`;
      })
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#ecfeff"/><stop offset="100%" stop-color="#cffafe"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)" rx="8" ry="8"/>${noiseLines}${noiseDots}${letters}</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private renderGlyph(char: string, pixelSize: number): string {
    const glyph = CAPTCHA_GLYPHS[char] ?? CAPTCHA_GLYPHS.S;
    const radius = (pixelSize * 0.5).toFixed(2);
    const rects: string[] = [];

    for (let rowIndex = 0; rowIndex < glyph.length; rowIndex += 1) {
      const row = glyph[rowIndex];
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        if (row[colIndex] !== '1') {
          continue;
        }
        const x = colIndex * pixelSize;
        const y = rowIndex * pixelSize;
        rects.push(
          `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" rx="${radius}" ry="${radius}"/>`
        );
      }
    }

    return rects.join('');
  }

  private cleanup(forceDeleteCount = 0): void {
    const now = Date.now();
    let deleted = 0;
    for (const [captchaId, item] of this.items) {
      if (item.expiresAt <= now || deleted < forceDeleteCount) {
        this.items.delete(captchaId);
        deleted += 1;
      }
    }
  }
}

export { CaptchaService };
export type { CaptchaChallenge, CaptchaCheckResult };
