import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { GlobalFonts, createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

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

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CAPTCHA_FONT_ALIAS = 'CaptchaQuicksand';

const randomCharFrom = (source: string): string => source[randomInt(source.length)] ?? source[0];

const randomFloat = (min: number, max: number): number => {
  const precision = 1000;
  const unit = randomInt(precision + 1) / precision;
  return min + (max - min) * unit;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

const hslToRgb = (hue: number, saturation: number, lightness: number): RgbColor => {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const segment = h / 60;
  const x = c * (1 - Math.abs((segment % 2) - 1));
  const m = l - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (segment >= 0 && segment < 1) {
    rPrime = c;
    gPrime = x;
  } else if (segment < 2) {
    rPrime = x;
    gPrime = c;
  } else if (segment < 3) {
    gPrime = c;
    bPrime = x;
  } else if (segment < 4) {
    gPrime = x;
    bPrime = c;
  } else if (segment < 5) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
};

const randomInkColor = (): RgbColor => {
  const hue = randomInt(360);
  const saturation = randomFloat(0.58, 0.92);
  const lightness = randomFloat(0.32, 0.62);
  return hslToRgb(hue, saturation, lightness);
};

const rgbToRgba = (color: RgbColor, alpha: number): string =>
  `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;

const ensureFontRegistered = (): void => {
  if (GlobalFonts.has(CAPTCHA_FONT_ALIAS)) {
    return;
  }
  const fontPath = path.join(process.cwd(), 'static', 'Quicksand-Bold.otf');
  GlobalFonts.registerFromPath(fontPath, CAPTCHA_FONT_ALIAS);
};

class CaptchaService {
  private readonly ttlMs = 5 * 60 * 1000;

  private readonly minCodeLength = 4;

  private readonly maxCodeLength = 6;

  private readonly minSolveMs = 1100;

  private readonly width = 132;

  private readonly height = 46;

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
      captchaSvg: this.buildCanvasDataUri(code),
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

  private buildCanvasDataUri(code: string): string {
    ensureFontRegistered();

    const backgroundCanvas = createCanvas(this.width, this.height);
    const backgroundCtx = backgroundCanvas.getContext('2d');
    this.drawNoiseBackground(backgroundCtx);

    const maskCanvas = createCanvas(this.width, this.height);
    const maskCtx = maskCanvas.getContext('2d');
    this.drawTextMask(maskCtx, code);
    this.warpTextMask(maskCtx);

    const coloredTextCanvas = createCanvas(this.width, this.height);
    const coloredTextCtx = coloredTextCanvas.getContext('2d');
    this.colorizeTextPixels(maskCtx, coloredTextCtx);

    backgroundCtx.drawImage(coloredTextCanvas, 0, 0);
    return backgroundCanvas.toDataURL('image/png');
  }

  private drawNoiseBackground(ctx: SKRSContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    const hueStart = randomInt(170, 231);
    const hueEnd = (hueStart + randomInt(-30, 31) + 360) % 360;
    gradient.addColorStop(0, `hsl(${hueStart} 55% ${randomInt(88, 95)}%)`);
    gradient.addColorStop(1, `hsl(${hueEnd} 48% ${randomInt(78, 86)}%)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const lineCount = randomInt(20, 30);
    for (let i = 0; i < lineCount; i += 1) {
      const noiseColor = randomInkColor();
      ctx.strokeStyle = rgbToRgba(noiseColor, randomFloat(0.16, 0.28));
      ctx.lineWidth = randomFloat(0.7, 1.6);
      ctx.beginPath();
      ctx.moveTo(randomFloat(0, this.width), randomFloat(0, this.height));
      ctx.lineTo(randomFloat(0, this.width), randomFloat(0, this.height));
      ctx.stroke();
    }

    const pointCount = randomInt(80, 100);
    for (let i = 0; i < pointCount; i += 1) {
      const dotColor = randomInkColor();
      ctx.fillStyle = rgbToRgba(dotColor, randomFloat(0.18, 0.36));
      ctx.beginPath();
      ctx.arc(
        randomFloat(0, this.width),
        randomFloat(0, this.height),
        randomFloat(0.45, 1.5),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private drawTextMask(ctx: SKRSContext2D, code: string): void {
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.textBaseline = 'middle';

    const codeLength = code.length;
    const paddingX = 10;
    const usableWidth = this.width - paddingX * 2;
    const slotWidth = usableWidth / codeLength;
    const baselineY = this.height * 0.56;

    for (let index = 0; index < codeLength; index += 1) {
      const char = code[index] ?? '';
      const centerX = paddingX + slotWidth * (index + 0.5) + randomFloat(-1.8, 1.8);
      const centerY = baselineY + randomFloat(-2, 2);
      const fontSize = randomFloat(23, 28);
      const rotateDeg = randomFloat(-22, 22);
      const skewX = randomFloat(-0.18, 0.18);
      const skewY = randomFloat(-0.08, 0.08);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate((rotateDeg * Math.PI) / 180);
      ctx.transform(1, skewY, skewX, 1, 0, 0);
      ctx.font = `${fontSize.toFixed(1)}px ${CAPTCHA_FONT_ALIAS}, Quicksand-Bold, sans-serif`;

      const metrics = ctx.measureText(char);
      const drawX = -metrics.width / 2;
      ctx.fillText(char, drawX, randomFloat(-0.6, 0.6));

      if (randomFloat(0, 1) < 0.35) {
        ctx.lineWidth = randomFloat(0.4, 0.9);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.strokeText(char, drawX, randomFloat(-0.6, 0.6));
      }

      ctx.restore();
    }
  }

  private warpTextMask(ctx: SKRSContext2D): void {
    const source = ctx.getImageData(0, 0, this.width, this.height);
    const sourceData = source.data;
    const warped = ctx.createImageData(this.width, this.height);
    const warpedData = warped.data;

    const amplitudeX = randomFloat(0.8, 2.2);
    const amplitudeY = randomFloat(0.4, 1.2);
    const frequencyX = randomFloat(16, 28);
    const frequencyY = randomFloat(20, 34);
    const phaseX = randomFloat(0, Math.PI * 2);
    const phaseY = randomFloat(0, Math.PI * 2);

    for (let y = 0; y < this.height; y += 1) {
      const xOffset = Math.sin((y / frequencyY) * Math.PI * 2 + phaseX) * amplitudeX;
      for (let x = 0; x < this.width; x += 1) {
        const yOffset = Math.sin((x / frequencyX) * Math.PI * 2 + phaseY) * amplitudeY;
        const sampleX = Math.round(x + xOffset);
        const sampleY = Math.round(y + yOffset);

        if (sampleX < 0 || sampleX >= this.width || sampleY < 0 || sampleY >= this.height) {
          continue;
        }

        const sourceIndex = (sampleY * this.width + sampleX) * 4;
        const targetIndex = (y * this.width + x) * 4;
        warpedData[targetIndex] = sourceData[sourceIndex];
        warpedData[targetIndex + 1] = sourceData[sourceIndex + 1];
        warpedData[targetIndex + 2] = sourceData[sourceIndex + 2];
        warpedData[targetIndex + 3] = sourceData[sourceIndex + 3];
      }
    }

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.putImageData(warped, 0, 0);
  }

  private colorizeTextPixels(maskCtx: SKRSContext2D, outputCtx: SKRSContext2D): void {
    const maskData = maskCtx.getImageData(0, 0, this.width, this.height);
    const maskPixels = maskData.data;
    const colored = outputCtx.createImageData(this.width, this.height);
    const coloredPixels = colored.data;

    const paletteA = randomInkColor();
    const paletteB = randomInkColor();
    const paletteC = randomInkColor();

    for (let y = 0; y < this.height; y += 1) {
      const verticalMix = y / Math.max(1, this.height - 1);
      for (let x = 0; x < this.width; x += 1) {
        const index = (y * this.width + x) * 4;
        const alpha = maskPixels[index + 3];
        if (alpha < 10) {
          continue;
        }

        const horizontalMix = x / Math.max(1, this.width - 1);
        const blendA = {
          r: mix(paletteA.r, paletteB.r, horizontalMix),
          g: mix(paletteA.g, paletteB.g, horizontalMix),
          b: mix(paletteA.b, paletteB.b, horizontalMix),
        };
        const blendB = {
          r: mix(blendA.r, paletteC.r, verticalMix),
          g: mix(blendA.g, paletteC.g, verticalMix),
          b: mix(blendA.b, paletteC.b, verticalMix),
        };

        const grain = randomInt(-28, 29);
        coloredPixels[index] = clamp(Math.round(blendB.r + grain), 0, 255);
        coloredPixels[index + 1] = clamp(Math.round(blendB.g + grain), 0, 255);
        coloredPixels[index + 2] = clamp(Math.round(blendB.b + grain), 0, 255);
        coloredPixels[index + 3] = alpha;
      }
    }

    outputCtx.putImageData(colored, 0, 0);
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
