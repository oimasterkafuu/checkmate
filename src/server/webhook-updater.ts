import { execFile, spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { FastifyBaseLogger } from 'fastify';

const execFileAsync = promisify(execFile);
const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

class WebhookUpdater {
  private isUpdating = false;

  private hasQueuedUpdate = false;

  constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly webhookSecret: string,
  ) {}

  isAuthorized(rawBody: Buffer, headers: Record<string, unknown>): boolean {
    const githubSignature = this.readHeader(headers, 'x-hub-signature-256');
    if (githubSignature) {
      return this.verifyGithubSignature(rawBody, githubSignature);
    }

    const directSecret =
      this.readHeader(headers, 'x-webhook-secret') ?? this.readHeader(headers, 'x-kana-webhook-secret');
    if (directSecret) {
      return this.safeEqual(directSecret, this.webhookSecret);
    }

    return false;
  }

  requestUpdate(): boolean {
    if (this.isUpdating) {
      this.hasQueuedUpdate = true;
      return true;
    }

    this.isUpdating = true;
    void this.runUpdatePipeline();
    return false;
  }

  private async runUpdatePipeline(): Promise<void> {
    let shouldDequeue = true;
    try {
      this.logger.info('收到 webhook，开始自动更新。');
      await this.runCommand('git', ['pull', '--ff-only'], 'git pull --ff-only');
      await this.runCommand(PNPM_BIN, ['install', '--frozen-lockfile'], 'pnpm install --frozen-lockfile');
      await this.runCommand(PNPM_BIN, ['run', 'build'], 'pnpm run build');
      this.logger.info('自动更新完成，准备重启进程。');
      shouldDequeue = false;
      this.restartProcess();
    } catch (error) {
      this.logger.error({ err: error }, '自动更新失败。');
    } finally {
      this.isUpdating = false;
      if (shouldDequeue && this.hasQueuedUpdate) {
        this.hasQueuedUpdate = false;
        this.requestUpdate();
      }
    }
  }

  private verifyGithubSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const expected = `sha256=${createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')}`;
    return this.safeEqual(signature, expected);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private readHeader(headers: Record<string, unknown>, key: string): string | null {
    const value = headers[key];
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0];
    }
    return null;
  }

  private async runCommand(command: string, args: string[], label: string): Promise<void> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (stdout.trim()) {
        this.logger.info({ output: this.limitOutput(stdout) }, `${label} 输出`);
      }
      if (stderr.trim()) {
        this.logger.warn({ output: this.limitOutput(stderr) }, `${label} 警告输出`);
      }
    } catch (error) {
      const commandText = [command, ...args].join(' ');
      if (error && typeof error === 'object') {
        const maybeOutput = error as { stdout?: string; stderr?: string };
        if (typeof maybeOutput.stdout === 'string' && maybeOutput.stdout.trim()) {
          this.logger.error({ output: this.limitOutput(maybeOutput.stdout) }, `${commandText} 标准输出`);
        }
        if (typeof maybeOutput.stderr === 'string' && maybeOutput.stderr.trim()) {
          this.logger.error({ output: this.limitOutput(maybeOutput.stderr) }, `${commandText} 错误输出`);
        }
      }
      throw error;
    }
  }

  private limitOutput(output: string): string {
    if (output.length <= 4000) {
      return output;
    }
    return `${output.slice(0, 4000)}\n...(truncated)`;
  }

  private restartProcess(): void {
    const args = process.argv.slice(1);
    const command = [shellQuote(process.execPath), ...args.map(shellQuote)].join(' ');
    const script = `sleep 1; cd ${shellQuote(process.cwd())}; ${command}`;

    const child = spawn('sh', ['-c', script], {
      detached: true,
      env: process.env,
      stdio: 'ignore',
    });
    child.unref();

    process.exit(0);
  }
}

export { WebhookUpdater };
