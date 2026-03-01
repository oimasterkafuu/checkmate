import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { deserialize, serialize } from 'node:v8';
import { brotliCompress, brotliDecompress, constants as zlibConstants } from 'node:zlib';
import { ReplayActionData, ReplayData, ReplayListItem } from './types';

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

const REPLAY_FILENAME_REGEX = /^[0-9A-Za-z+-]+$/;
const REPLAY_EXT = '.rpl';
const REPLAY_INDEX_BIN = 'index.bin';

interface ReplayStoreOptions {
  buildReplayFromActions: (replay: ReplayActionData) => Promise<ReplayData>;
}

interface ReplaySaveSummary {
  rank: string[];
  turn: number;
}

const encodeReplayBinary = async <T>(value: T): Promise<Buffer> => {
  const raw = serialize(value);
  return (await brotliCompressAsync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
    },
  })) as Buffer;
};

const decodeReplayBinary = async <T>(content: Buffer): Promise<T> => {
  const raw = (await brotliDecompressAsync(content)) as Buffer;
  return deserialize(raw) as T;
};

export const getReplayId = (content: Buffer): string => {
  const hash = createHash('sha256').update(content).digest().subarray(0, 9);
  return hash.toString('base64').replaceAll('/', '-');
};

export const isReplayIdValid = (id: string): boolean => REPLAY_FILENAME_REGEX.test(id);

export class ReplayStore {
  private readonly replayDir: string;

  private readonly indexFile: string;

  private readonly buildReplayFromActions: ReplayStoreOptions['buildReplayFromActions'];

  constructor(replayDir: string, options: ReplayStoreOptions) {
    this.replayDir = replayDir;
    this.indexFile = path.join(replayDir, REPLAY_INDEX_BIN);
    this.buildReplayFromActions = options.buildReplayFromActions;
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.replayDir, { recursive: true });
    await this.saveIndex(await this.loadIndex());
  }

  private async loadIndex(): Promise<ReplayListItem[]> {
    try {
      const content = await readFile(this.indexFile);
      if (content.length === 0) {
        return [];
      }
      return deserialize(content) as ReplayListItem[];
    } catch {
      return [];
    }
  }

  private async saveIndex(items: ReplayListItem[]): Promise<void> {
    await writeFile(this.indexFile, serialize(items));
  }

  async saveReplay(replay: ReplayActionData, summary: ReplaySaveSummary): Promise<string> {
    const binary = await encodeReplayBinary(replay);
    const replayId = getReplayId(binary);
    const replayPath = path.join(this.replayDir, `${replayId}${REPLAY_EXT}`);
    await writeFile(replayPath, binary);

    const replayItem: ReplayListItem = {
      time: Math.floor(Date.now() / 1000),
      id: replayId,
      rank: [...summary.rank],
      turn: summary.turn,
    };

    const items = await this.loadIndex();
    items.push(replayItem);
    items.sort((a, b) => b.time - a.time);
    await this.saveIndex(items);

    return replayId;
  }

  async loadReplay(id: string): Promise<ReplayData> {
    if (!isReplayIdValid(id)) {
      throw new Error('Invalid replay id.');
    }
    const replayPath = path.resolve(this.replayDir, `${id}${REPLAY_EXT}`);
    const replayRoot = `${path.resolve(this.replayDir)}${path.sep}`;
    if (!replayPath.startsWith(replayRoot)) {
      throw new Error('Invalid replay path.');
    }
    const content = await readFile(replayPath);
    const replay = await decodeReplayBinary<ReplayActionData>(content);
    return this.buildReplayFromActions(replay);
  }

  async listReplays(): Promise<ReplayListItem[]> {
    const items = await this.loadIndex();
    items.sort((a, b) => b.time - a.time);
    return items;
  }
}
