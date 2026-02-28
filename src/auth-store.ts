import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants as zlibConstants } from 'node:zlib';

interface StoredUser {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface UserFile {
  users: StoredUser[];
}

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMissingFileError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT',
  );

const toStoredUser = (value: unknown): StoredUser | null => {
  if (!isRecord(value)) {
    return null;
  }
  const username = value.username;
  const passwordSalt = value.passwordSalt;
  const passwordHash = value.passwordHash;
  const sessionId = value.sessionId;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (
    typeof username !== 'string' ||
    typeof passwordSalt !== 'string' ||
    typeof passwordHash !== 'string' ||
    (sessionId !== null && typeof sessionId !== 'string') ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt)
  ) {
    return null;
  }
  const normalizedSessionId: string | null = sessionId === null ? null : (sessionId as string);
  return {
    username,
    passwordSalt,
    passwordHash,
    sessionId: normalizedSessionId,
    createdAt,
    updatedAt,
  };
};

const parseUserFile = (value: unknown): StoredUser[] => {
  if (!isRecord(value) || !Array.isArray(value.users)) {
    throw new Error('用户数据结构无效。');
  }
  const users: StoredUser[] = [];
  for (const item of value.users) {
    const parsed = toStoredUser(item);
    if (parsed) {
      users.push(parsed);
    }
  }
  return users;
};

const encodeUserFileBinary = async (value: UserFile): Promise<Buffer> => {
  const raw = serialize(value);
  return (await brotliCompressAsync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
    },
  })) as Buffer;
};

const decodeUserFileBinary = async (content: Buffer): Promise<UserFile> => {
  const raw = (await brotliDecompressAsync(content)) as Buffer;
  return deserialize(raw) as UserFile;
};

export class UserStore {
  private readonly binaryFilePath: string;

  private usersByKey = new Map<string, StoredUser>();

  constructor(dataDir: string) {
    this.binaryFilePath = path.join(dataDir, 'users.bin');
  }

  async ensureReady(): Promise<void> {
    await mkdir(path.dirname(this.binaryFilePath), { recursive: true });

    let binaryError: unknown = null;
    try {
      const users = await this.loadFromBinary();
      this.replaceUsers(users);
      return;
    } catch (error) {
      if (!isMissingFileError(error)) {
        binaryError = error;
      }
    }

    if (binaryError) {
      throw new Error('users.bin 解析失败。', { cause: binaryError });
    }

    await this.persist();
  }

  validateUsernameOrThrow(input: string): string {
    const username = input.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new Error('用户名需为 3-20 位，只能包含字母、数字和下划线。');
    }
    return username;
  }

  validatePasswordOrThrow(password: string): void {
    if (password.length < 6 || password.length > 72) {
      throw new Error('密码长度必须在 6 到 72 位之间。');
    }
  }

  async register(usernameInput: string, password: string): Promise<string> {
    const username = this.validateUsernameOrThrow(usernameInput);
    this.validatePasswordOrThrow(password);

    const key = this.normalize(username);
    if (this.usersByKey.has(key)) {
      throw new Error('用户名已存在。');
    }

    const salt = randomBytes(16).toString('hex');
    const user: StoredUser = {
      username,
      passwordSalt: salt,
      passwordHash: this.hashPassword(password, salt),
      sessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.usersByKey.set(key, user);
    await this.persist();
    return user.username;
  }

  verifyPassword(usernameInput: string, password: string): string | null {
    const key = this.normalize(usernameInput);
    const user = this.usersByKey.get(key);
    if (!user) {
      return null;
    }

    const hashBuffer = Buffer.from(user.passwordHash, 'hex');
    const compare = Buffer.from(this.hashPassword(password, user.passwordSalt), 'hex');
    if (hashBuffer.length !== compare.length) {
      return null;
    }

    if (!timingSafeEqual(hashBuffer, compare)) {
      return null;
    }

    return user.username;
  }

  async rotateSession(usernameInput: string): Promise<string> {
    const key = this.normalize(usernameInput);
    const user = this.usersByKey.get(key);
    if (!user) {
      throw new Error('用户不存在。');
    }

    user.sessionId = randomBytes(24).toString('base64url');
    user.updatedAt = Date.now();
    await this.persist();
    return user.sessionId;
  }

  async clearSession(usernameInput: string): Promise<void> {
    const key = this.normalize(usernameInput);
    const user = this.usersByKey.get(key);
    if (!user) {
      return;
    }

    user.sessionId = null;
    user.updatedAt = Date.now();
    await this.persist();
  }

  isSessionValid(usernameInput: string, sessionId: string): boolean {
    const key = this.normalize(usernameInput);
    const user = this.usersByKey.get(key);
    return Boolean(user && user.sessionId && user.sessionId === sessionId);
  }

  private normalize(username: string): string {
    return username.trim().toLowerCase();
  }

  private replaceUsers(users: StoredUser[]): void {
    this.usersByKey = new Map(users.map((user) => [this.normalize(user.username), { ...user }]));
  }

  private async loadFromBinary(): Promise<StoredUser[]> {
    const raw = await readFile(this.binaryFilePath);
    const parsed = await decodeUserFileBinary(raw);
    return parseUserFile(parsed);
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  private async persist(): Promise<void> {
    const data: UserFile = {
      users: [...this.usersByKey.values()],
    };
    const binary = await encodeUserFileBinary(data);
    await writeFile(this.binaryFilePath, binary);
  }
}
