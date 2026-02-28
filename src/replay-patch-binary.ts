import { LeaderboardEntry, ReplayData, ReplayPatchPayload, UpdatePayload } from './types';

const MAGIC_BYTES = [0x52, 0x50, 0x42, 0x31] as const; // RPB1

const classToCode = (value: string): number => {
  if (value === 'dead') {
    return 1;
  }
  if (value === 'afk') {
    return 2;
  }
  return 0;
};

class ByteWriter {
  private readonly bytes: number[] = [];

  writeU8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeU16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  writeU32(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  writeBytes(buffer: Uint8Array): void {
    for (let i = 0; i < buffer.length; i += 1) {
      this.bytes.push(buffer[i]);
    }
  }

  writeString(value: string): void {
    const text = String(value ?? '');
    const raw = Buffer.from(text, 'utf-8');
    if (raw.length > 0xffff) {
      throw new Error('字符串长度超过 65535，无法编码到回放二进制。');
    }
    this.writeU16(raw.length);
    this.writeBytes(raw);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

const normalizeU32 = (value: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  if (num <= 0) {
    return 0;
  }
  if (num >= 0xffffffff) {
    return 0xffffffff;
  }
  return Math.floor(num);
};

const writeLeaderboard = (writer: ByteWriter, leaderboard: LeaderboardEntry[]): void => {
  writer.writeU16(leaderboard.length);
  for (const item of leaderboard) {
    writer.writeU8(normalizeU32(item.team));
    writer.writeString(item.uid);
    writer.writeU32(normalizeU32(item.army));
    writer.writeU32(normalizeU32(item.land));
    writer.writeU8(classToCode(item.class_));
    writer.writeU16(normalizeU32(item.dead));
    writer.writeU8(normalizeU32(item.id));
  }
};

const writeSurrenderProgress = (writer: ByteWriter, progress: Record<number, number>): void => {
  const entries = Object.entries(progress)
    .map(([id, ratio]) => ({
      id: normalizeU32(Number(id)),
      ratio: Math.max(0, Math.min(1, Number(ratio) || 0)),
    }))
    .filter((item) => item.id > 0)
    .sort((a, b) => a.id - b.id);
  writer.writeU16(entries.length);
  for (const item of entries) {
    writer.writeU8(item.id);
    writer.writeU8(Math.round(item.ratio * 255));
  }
};

const writeDiffU8 = (writer: ByteWriter, diff: number[]): void => {
  if (diff.length % 2 !== 0) {
    throw new Error('回放 patch grid diff 长度非法。');
  }
  const pairCount = diff.length / 2;
  writer.writeU32(pairCount);
  for (let i = 0; i < diff.length; i += 2) {
    const index = normalizeU32(diff[i]);
    if (index > 0xffff) {
      throw new Error('地图索引超过 65535，当前回放二进制格式不支持。');
    }
    writer.writeU16(index);
    writer.writeU8(normalizeU32(diff[i + 1]));
  }
};

const writeDiffU32 = (writer: ByteWriter, diff: number[]): void => {
  if (diff.length % 2 !== 0) {
    throw new Error('回放 patch army diff 长度非法。');
  }
  const pairCount = diff.length / 2;
  writer.writeU32(pairCount);
  for (let i = 0; i < diff.length; i += 2) {
    const index = normalizeU32(diff[i]);
    if (index > 0xffff) {
      throw new Error('地图索引超过 65535，当前回放二进制格式不支持。');
    }
    writer.writeU16(index);
    writer.writeU32(normalizeU32(diff[i + 1]));
  }
};

const writeFullGrid = (writer: ByteWriter, grid: number[]): void => {
  writer.writeU32(grid.length);
  for (let i = 0; i < grid.length; i += 1) {
    writer.writeU8(normalizeU32(grid[i]));
  }
};

const writeFullArmy = (writer: ByteWriter, army: number[]): void => {
  writer.writeU32(army.length);
  for (let i = 0; i < army.length; i += 1) {
    writer.writeU32(normalizeU32(army[i]));
  }
};

const writeInitialPayload = (writer: ByteWriter, initial: UpdatePayload): void => {
  writer.writeU32(normalizeU32(initial.turn));
  writer.writeU8(initial.game_end ? 1 : 0);
  writeLeaderboard(writer, initial.leaderboard);
  writeSurrenderProgress(writer, initial.surrender_progress);
  writeFullGrid(writer, initial.grid_type);
  writeFullArmy(writer, initial.army_cnt);
};

const writePatchPayload = (writer: ByteWriter, payload: ReplayPatchPayload): void => {
  writer.writeU32(normalizeU32(payload.turn));
  writer.writeU8(payload.game_end ? 1 : 0);
  writeLeaderboard(writer, payload.leaderboard);
  writeSurrenderProgress(writer, payload.surrender_progress);
  writeDiffU8(writer, payload.grid_type);
  writeDiffU32(writer, payload.army_cnt);
};

export const encodeReplayPatchBinary = (replay: ReplayData): Buffer => {
  if (replay.n > 0xffff || replay.m > 0xffff) {
    throw new Error('地图尺寸超过当前回放二进制格式限制。');
  }
  const writer = new ByteWriter();
  for (let i = 0; i < MAGIC_BYTES.length; i += 1) {
    writer.writeU8(MAGIC_BYTES[i]);
  }
  writer.writeU16(replay.n);
  writer.writeU16(replay.m);
  writer.writeU32(replay.patches.length);
  writeInitialPayload(writer, replay.initial);
  for (const patch of replay.patches) {
    writePatchPayload(writer, patch.forward);
    writePatchPayload(writer, patch.backward);
  }
  return writer.toBuffer();
};
