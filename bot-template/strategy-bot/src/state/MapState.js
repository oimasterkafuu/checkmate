class MapState {
  constructor() {
    this.n = 0;
    this.m = 0;
    this.gridType = [];
    this.armyCnt = [];
  }

  reset(n, m) {
    this.n = n;
    this.m = m;
    this.gridType = new Array(n * m).fill(205);
    this.armyCnt = new Array(n * m).fill(0);
  }

  indexOfCell(x, y) {
    return x * this.m + y;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.n && y < this.m;
  }

  applyDiff(diffArray, targetArray) {
    if (!Array.isArray(diffArray)) {
      return;
    }

    for (let i = 0; i + 1 < diffArray.length; i += 2) {
      const idx = Number.parseInt(String(diffArray[i]), 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= targetArray.length) {
        continue;
      }

      const value = Number.parseInt(String(diffArray[i + 1]), 10);
      if (!Number.isFinite(value)) {
        continue;
      }
      targetArray[idx] = value;
    }
  }

  applyUpdatePayload(payload) {
    if (this.n === 0 || this.m === 0) {
      return false;
    }

    if (payload && payload.is_diff) {
      this.applyDiff(payload.grid_type, this.gridType);
      this.applyDiff(payload.army_cnt, this.armyCnt);
      return true;
    }

    if (!Array.isArray(payload?.grid_type) || !Array.isArray(payload?.army_cnt)) {
      return false;
    }

    if (
      payload.grid_type.length !== this.gridType.length ||
      payload.army_cnt.length !== this.armyCnt.length
    ) {
      return false;
    }

    this.gridType = payload.grid_type.slice();
    this.armyCnt = payload.army_cnt.slice();
    return true;
  }

  static decodeOwner(code) {
    if (!Number.isFinite(code)) {
      return 0;
    }

    if (code > 0 && code < 50) {
      return code;
    }
    if (code >= 50 && code < 100) {
      return code - 50;
    }
    if (code >= 100 && code < 150) {
      return code - 100;
    }
    if (code >= 150 && code < 200) {
      return code - 150;
    }

    return 0;
  }

  static isMountainCode(code) {
    return code === 201 || code === 205;
  }

  static decodeLegacyCell(code, army) {
    if (MapState.isMountainCode(code)) {
      return { color: 0, type: 4, amount: 0 };
    }

    if (code === 202) {
      return { color: 0, type: 0, amount: 0 };
    }

    if (code === 203) {
      return { color: 0, type: 3, amount: 0 };
    }

    if (code === 204) {
      return { color: 0, type: 0, amount: 0 };
    }

    if (code === 200) {
      return { color: 0, type: 0, amount: 0 };
    }

    if (code >= 100 && code < 150) {
      return {
        color: Math.max(0, code - 100),
        type: 1,
        amount: Math.max(0, army),
      };
    }

    if (code >= 50 && code < 100) {
      return {
        color: Math.max(0, code - 50),
        type: 3,
        amount: Math.max(0, army),
      };
    }

    if (code >= 150 && code < 200) {
      return {
        color: Math.max(0, code - 150),
        type: 2,
        amount: Math.max(0, army),
      };
    }

    if (code > 0 && code < 50) {
      return {
        color: code,
        type: 2,
        amount: Math.max(0, army),
      };
    }

    return { color: 0, type: 0, amount: 0 };
  }

  toLegacyMap() {
    const size = Math.max(this.n, this.m);
    const gameMap = Array.from({ length: size + 1 }, () =>
      Array.from({ length: size + 1 }, () => ({ color: 0, type: 4, amount: 0 })),
    );

    gameMap[0][0] = {
      type: 1,
      size,
      color: 0,
      amount: 0,
    };

    for (let i = 1; i <= this.n; i += 1) {
      for (let j = 1; j <= this.m; j += 1) {
        const idx = this.indexOfCell(i - 1, j - 1);
        gameMap[i][j] = MapState.decodeLegacyCell(this.gridType[idx], this.armyCnt[idx]);
      }
    }

    return {
      size,
      gameMap,
    };
  }
}

module.exports = {
  MapState,
};
