import { randomBytes, randomInt } from 'node:crypto';

interface CaptchaItem {
  code: string;
  createdAt: number;
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

const randomFloat = (min: number, max: number): number => {
  const precision = 1000;
  const unit = randomInt(precision + 1) / precision;
  return min + (max - min) * unit;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toHex2 = (value: number): string => value.toString(16).padStart(2, '0');

const randomRgbColor = (minChannel: number, maxChannel: number): string => {
  const min = clamp(Math.floor(minChannel), 0, 255);
  const max = clamp(Math.floor(maxChannel), min, 255);
  const r = randomInt(min, max + 1);
  const g = randomInt(min, max + 1);
  const b = randomInt(min, max + 1);
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
};

const randomInkColor = (): string => randomRgbColor(12, 180);

const randomNoiseColor = (): string => randomRgbColor(0, 255);

const shuffleInPlace = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

class CaptchaService {
  private readonly ttlMs = 5 * 60 * 1000;

  private readonly minCodeLength = 4;

  private readonly maxCodeLength = 6;

  private readonly minSolveMs = 1100;

  private readonly width = 132;

  private readonly height = 46;

  private readonly glyphPixel = 4;

  private readonly maxItems = 5000;

  private readonly items = new Map<string, CaptchaItem>();

  createChallenge(): CaptchaChallenge {
    this.cleanup();
    const code = this.buildCode();
    const createdAt = Date.now();
    const captchaId = randomBytes(18).toString('base64url');
    this.items.set(captchaId, {
      code,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
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

    const now = Date.now();
    if (challenge.expiresAt <= now) {
      this.items.delete(captchaId);
      return { ok: false, error: '验证码已过期，请刷新后重试。' };
    }
    if (now - challenge.createdAt < this.minSolveMs) {
      return { ok: false, error: '操作过快，请稍后再提交验证码。' };
    }

    this.items.delete(captchaId);
    if (captchaCode !== challenge.code) {
      return { ok: false, error: '验证码错误，请重试。' };
    }
    return { ok: true };
  }

  private buildCode(): string {
    const targetLength = randomInt(this.minCodeLength, this.maxCodeLength + 1);
    let code = '';
    for (let i = 0; i < targetLength; i += 1) {
      code += randomCharFrom(CAPTCHA_CHARS);
    }
    return code;
  }

  private buildSvgDataUri(code: string): string {
    const pixelSize = this.glyphPixel + randomInt(0, 2);
    const glyphWidth = 5 * pixelSize;
    const glyphHeight = 7 * pixelSize;
    const gap = randomInt(5, 9);
    const totalWidth = code.length * glyphWidth + (code.length - 1) * gap;
    const minX = 6;
    const maxX = Math.max(minX, this.width - totalWidth - 6);
    const minY = 4;
    const maxY = Math.max(minY, this.height - glyphHeight - 4);
    const startX = clamp(Math.floor((this.width - totalWidth) / 2) + randomInt(-2, 3), minX, maxX);
    const startY = clamp(Math.floor((this.height - glyphHeight) / 2) + randomInt(-1, 2), minY, maxY);

    const backgroundHue = randomInt(160, 221);
    const backgroundLightStart = randomInt(90, 96);
    const backgroundLightEnd = randomInt(80, 89);
    const backgroundSaturation = randomInt(35, 58);
    const backgroundShift = randomInt(-24, 25);
    const backgroundStart = `hsl(${backgroundHue} ${backgroundSaturation}% ${backgroundLightStart}%)`;
    const backgroundEnd = `hsl(${(backgroundHue + backgroundShift + 360) % 360} ${backgroundSaturation}% ${backgroundLightEnd}%)`;

    const noiseLines = Array.from({ length: 10 }, () => {
      const x1 = randomInt(this.width);
      const y1 = randomInt(this.height);
      const x2 = randomInt(this.width);
      const y2 = randomInt(this.height);
      const strokeWidth = randomFloat(0.7, 1.5).toFixed(2);
      const color = randomNoiseColor();
      const opacity = randomFloat(0.15, 0.32).toFixed(2);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
    }).join('');

    const noiseDots = Array.from({ length: 22 }, () => {
      const cx = randomInt(this.width);
      const cy = randomInt(this.height);
      const r = randomFloat(0.5, 2.1).toFixed(2);
      const color = randomNoiseColor();
      const opacity = randomFloat(0.18, 0.44).toFixed(2);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${opacity}"/>`;
    }).join('');

    const curveNoise = Array.from({ length: 3 }, () => {
      const start = `${randomInt(this.width)} ${randomInt(this.height)}`;
      const control1 = `${randomInt(this.width)} ${randomInt(this.height)}`;
      const control2 = `${randomInt(this.width)} ${randomInt(this.height)}`;
      const end = `${randomInt(this.width)} ${randomInt(this.height)}`;
      const color = randomNoiseColor();
      const opacity = randomFloat(0.16, 0.34).toFixed(2);
      const strokeWidth = randomFloat(0.9, 1.5).toFixed(2);
      return `<path d="M ${start} C ${control1}, ${control2}, ${end}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
    }).join('');

    const textZoneMinX = clamp(startX - 10, 0, this.width);
    const textZoneMaxX = clamp(startX + totalWidth + 10, 0, this.width);
    const textZoneMinY = clamp(startY - 8, 0, this.height);
    const textZoneMaxY = clamp(startY + glyphHeight + 8, 0, this.height);
    const interferenceDots = Array.from({ length: 12 }, () => {
      const nearText = randomFloat(0, 1) < 0.72;
      const cx = nearText ? randomFloat(textZoneMinX, textZoneMaxX) : randomFloat(0, this.width);
      const cy = nearText ? randomFloat(textZoneMinY, textZoneMaxY) : randomFloat(0, this.height);
      // Keep interference blobs close to actual character scale.
      const r = randomFloat(glyphWidth * 0.24, glyphWidth * 0.56).toFixed(2);
      const opacity = randomFloat(0.18, 0.42).toFixed(2);
      const color = randomInkColor();
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r}" fill="${color}" fill-opacity="${opacity}"/>`;
    }).join('');

    const letters = code
      .split('')
      .map((char, index) => {
        const x = clamp(startX + index * (glyphWidth + gap) + randomInt(-2, 3), 2, this.width - glyphWidth - 2);
        const y = clamp(startY + randomInt(-2, 3), 2, this.height - glyphHeight - 2);
        const rotate = randomInt(-11, 12);
        const skew = randomInt(-7, 8);
        const body = this.renderGlyph(char, pixelSize);
        const centerX = (5 * pixelSize) / 2;
        const centerY = (7 * pixelSize) / 2;
        return `<g transform="translate(${x} ${y})"><g transform="rotate(${rotate} ${centerX} ${centerY}) skewX(${skew})">${body}</g></g>`;
      })
      .join('');

    const warpSeed = randomInt(1, 10_000);
    const warpFrequencyX = randomFloat(0.006, 0.014).toFixed(3);
    const warpFrequencyY = randomFloat(0.02, 0.05).toFixed(3);
    const warpScale = randomInt(2, 5);
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="${backgroundStart}"/><stop offset="100%" stop-color="${backgroundEnd}"/></linearGradient><clipPath id="clip"><rect x="1" y="1" width="${this.width - 2}" height="${this.height - 2}" rx="8" ry="8"/></clipPath><filter id="warp" x="-10%" y="-15%" width="120%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="${warpFrequencyX} ${warpFrequencyY}" numOctaves="1" seed="${warpSeed}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="${warpScale}" xChannelSelector="R" yChannelSelector="G"/></filter></defs><rect width="100%" height="100%" fill="url(#bg)" rx="8" ry="8"/><g clip-path="url(#clip)">${noiseLines}${noiseDots}${curveNoise}${interferenceDots}<g filter="url(#warp)">${letters}</g></g></svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  private renderGlyph(char: string, pixelSize: number): string {
    const glyph = CAPTCHA_GLYPHS[char] ?? CAPTCHA_GLYPHS.S;
    const radius = (pixelSize * 0.36).toFixed(2);
    const rects: string[] = [];
    const activePixels: Array<{ colIndex: number; rowIndex: number }> = [];

    for (let rowIndex = 0; rowIndex < glyph.length; rowIndex += 1) {
      const row = glyph[rowIndex];
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        if (row[colIndex] !== '1') {
          continue;
        }
        activePixels.push({ colIndex, rowIndex });
      }
    }
    shuffleInPlace(activePixels);

    for (const pixel of activePixels) {
      const { colIndex, rowIndex } = pixel;
      const cellJitter = pixelSize * 0.14;
      const size = randomFloat(pixelSize * 0.86, pixelSize * 1.12);
      const x = colIndex * pixelSize + randomFloat(-cellJitter, cellJitter);
      const y = rowIndex * pixelSize + randomFloat(-cellJitter, cellJitter);
      const centerX = x + size / 2;
      const centerY = y + size / 2;
      const rotate = randomInt(-24, 25);
      const opacity = randomFloat(0.62, 0.99).toFixed(2);
      const fill = randomInkColor();
      rects.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${radius}" ry="${radius}" fill="${fill}" fill-opacity="${opacity}" transform="rotate(${rotate} ${centerX.toFixed(2)} ${centerY.toFixed(2)})"/>`
      );
      if (randomFloat(0, 1) < 0.16) {
        const dotX = x + randomFloat(-pixelSize * 0.45, pixelSize * 0.45);
        const dotY = y + randomFloat(-pixelSize * 0.45, pixelSize * 0.45);
        const dotR = randomFloat(0.32, 0.88).toFixed(2);
        rects.push(
          `<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="${dotR}" fill="${randomInkColor()}" fill-opacity="${randomFloat(0.48, 0.92).toFixed(2)}"/>`
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
