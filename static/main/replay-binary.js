function decodeReplayBinary(buffer) {
  var view = new DataView(buffer);
  var offset = 0;

  function ensure(size) {
    if (offset + size > view.byteLength) {
      throw new Error('回放数据损坏');
    }
  }

  function readU8() {
    ensure(1);
    var value = view.getUint8(offset);
    offset += 1;
    return value;
  }

  function readU16() {
    ensure(2);
    var value = view.getUint16(offset, true);
    offset += 2;
    return value;
  }

  function readU32() {
    ensure(4);
    var value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readBytes(size) {
    ensure(size);
    var bytes = new Uint8Array(buffer, offset, size);
    offset += size;
    return bytes;
  }

  function readString() {
    var len = readU16();
    if (len === 0) return '';
    var bytes = readBytes(len);
    if (replay_text_decoder) return replay_text_decoder.decode(bytes);
    var text = '';
    for (var i = 0; i < bytes.length; i++) {
      text += String.fromCharCode(bytes[i]);
    }
    try {
      return decodeURIComponent(escape(text));
    } catch {
      return text;
    }
  }

  function readLeaderboard() {
    var count = readU16();
    var leaderboard = new Array(count);
    for (var i = 0; i < count; i++) {
      var team = readU8();
      var uid = readString();
      var army = readU32();
      var land = readU32();
      var classCode = readU8();
      var dead = readU16();
      var id = readU8();
      leaderboard[i] = {
        team: team,
        uid: uid,
        army: army,
        land: land,
        class_: replay_class_from_code[classCode] || '',
        dead: dead,
        id: id,
      };
    }
    return leaderboard;
  }

  function readSurrenderProgress() {
    var count = readU16();
    var progress = {};
    for (var i = 0; i < count; i++) {
      var ownerId = readU8();
      var ratio = readU8() / 255;
      if (ratio > 0) {
        progress[ownerId] = ratio;
      }
    }
    return progress;
  }

  function readFullGrid() {
    var len = readU32();
    var values = new Array(len);
    for (var i = 0; i < len; i++) {
      values[i] = readU8();
    }
    return values;
  }

  function readFullArmy() {
    var len = readU32();
    var values = new Array(len);
    for (var i = 0; i < len; i++) {
      values[i] = readU32();
    }
    return values;
  }

  function readGridDiff() {
    var pairCount = readU32();
    var diff = new Array(pairCount * 2);
    for (var i = 0; i < pairCount; i++) {
      diff[i * 2] = readU16();
      diff[i * 2 + 1] = readU8();
    }
    return diff;
  }

  function readArmyDiff() {
    var pairCount = readU32();
    var diff = new Array(pairCount * 2);
    for (var i = 0; i < pairCount; i++) {
      diff[i * 2] = readU16();
      diff[i * 2 + 1] = readU32();
    }
    return diff;
  }

  function readInitialPayload() {
    var turn = readU32();
    var gameEnd = readU8() == 1;
    var leaderboard = readLeaderboard();
    var surrenderProgress = readSurrenderProgress();
    var grid = readFullGrid();
    var army = readFullArmy();
    return {
      grid_type: grid,
      army_cnt: army,
      lst_move: { x: -1, y: -1, dx: -1, dy: -1, half: false },
      leaderboard: leaderboard,
      turn: turn,
      kills: {},
      surrender_progress: surrenderProgress,
      game_end: gameEnd,
      is_diff: false,
    };
  }

  function readPatchPayload() {
    var turn = readU32();
    var gameEnd = readU8() == 1;
    var leaderboard = readLeaderboard();
    var surrenderProgress = readSurrenderProgress();
    var gridDiff = readGridDiff();
    var armyDiff = readArmyDiff();
    return {
      grid_type: gridDiff,
      army_cnt: armyDiff,
      lst_move: { x: -1, y: -1, dx: -1, dy: -1, half: false },
      leaderboard: leaderboard,
      turn: turn,
      kills: {},
      surrender_progress: surrenderProgress,
      game_end: gameEnd,
      is_diff: true,
    };
  }

  for (var i = 0; i < replay_binary_magic.length; i++) {
    if (readU8() != replay_binary_magic[i]) {
      throw new Error('回放格式不支持');
    }
  }

  var n = readU16();
  var m = readU16();
  var patchCount = readU32();
  var initial = readInitialPayload();
  var patches = new Array(patchCount);
  for (var i = 0; i < patchCount; i++) {
    patches[i] = {
      forward: readPatchPayload(),
      backward: readPatchPayload(),
    };
  }
  return {
    n: n,
    m: m,
    initial: initial,
    patches: patches,
  };
}
