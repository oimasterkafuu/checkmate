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

const randomCharFrom = (source: string): string => source[randomInt(source.length)] ?? source[0];

const randomFromArray = <T>(source: T[]): T => source[randomInt(source.length)] ?? source[0];

class CaptchaService {
  private readonly ttlMs = 5 * 60 * 1000;

  private readonly codeLength = 4;

  private readonly width = 132;

  private readonly height = 46;

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
        const x = 18 + index * 26 + randomInt(-3, 4);
        const y = 30 + randomInt(-4, 5);
        const rotate = randomInt(-22, 23);
        const size = randomInt(22, 30);
        const color = randomFromArray(['#065f46', '#0f766e', '#155e75', '#1d4ed8', '#7c2d12']);
        return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Verdana, Arial, sans-serif" font-weight="700" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
      })
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#ecfeff"/><stop offset="100%" stop-color="#cffafe"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)" rx="8" ry="8"/>${noiseLines}${noiseDots}${letters}</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
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
