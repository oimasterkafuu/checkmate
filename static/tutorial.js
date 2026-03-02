(function () {
  const BOARD_ROWS = 9;
  const BOARD_COLS = 13;
  const PLAYER_ID = 1;
  const ENEMY_ID = 2;
  const SCALE_CLASS = 3;
  const TICK_MS = 650;
  const MIN_ZOOM = 0.72;
  const MAX_ZOOM = 2.25;
  const CLICK_TOLERANCE = 6;
  const PAN_TRIGGER_PIXELS = 18;

  const POS = {
    playerCrown: [4, 2],
    firstMove: [4, 3],
    scout: [4, 6],
    neutralCity: [4, 7],
    swamp: [4, 8],
    enemyLand: [4, 9],
    enemyCity: [4, 10],
    enemyCrown: [4, 11],
  };

  const DIRECTIONS = [
    { x: -1, y: 0, key: ['w', 'arrowup'], arrow: '↑' },
    { x: 1, y: 0, key: ['s', 'arrowdown'], arrow: '↓' },
    { x: 0, y: -1, key: ['a', 'arrowleft'], arrow: '←' },
    { x: 0, y: 1, key: ['d', 'arrowright'], arrow: '→' },
  ];
  const DIRE_CHARS = ['↑', '↓', '←', '→'];
  const DIRE_CLASSES = ['arrow_u', 'arrow_d', 'arrow_l', 'arrow_r'];

  const STEP_LIST = [
    {
      title: '拖动地图（游戏自动暂停）',
      body: '按住鼠标左键拖动地图。教学开始前，游戏会保持暂停。',
      hint: '完成拖动后自动进入下一步。',
      targets: [POS.playerCrown],
    },
    {
      title: '缩放地图（游戏自动暂停）',
      body: '使用滚轮放大/缩小地图，熟悉视野控制。',
      hint: '缩放至少 1 次后自动进入下一步。',
      targets: [POS.playerCrown],
    },
    {
      title: '游戏开始：皇冠兵力加速',
      body: '你的皇冠兵力会从 1 开始。为了加速教程，我们临时快速增兵到 100。',
      hint: '请观察兵力变化，系统会自动继续。',
      targets: [POS.playerCrown],
    },
    {
      title: '选择格子',
      body: '点击你的皇冠格子，完成选中。',
      hint: '被选中格会出现白色边框。',
      targets: [POS.playerCrown],
    },
    {
      title: '移动与攻击',
      body: '点击右侧相邻空地发起攻击（移动）。攻击会把除 1 之外的兵力推向目标格。',
      hint: '目标：占领高亮空地。',
      targets: [POS.firstMove],
    },
    {
      title: '继续推进兵线',
      body: '继续把兵力向右推进到下一个目标格。',
      hint: '目标：占领高亮目标格。',
      targets: [[4, 5]],
    },
    {
      title: '探索迷雾与障碍',
      body: '向右推进到侦察点。迷雾中的“障碍”提示通常表示山或城市。',
      hint: '目标：占领高亮侦察点。',
      targets: [POS.scout],
    },
    {
      title: '攻打中立城市',
      body: '城市是关键资源点，夺取后会持续增兵。',
      hint: '目标：拿下高亮中立城市。',
      targets: [POS.neutralCity],
    },
    {
      title: '渡过沼泽',
      body: '沼泽会持续损兵，兵力归零时会失去控制。',
      hint: '目标：穿过高亮沼泽，继续推进。',
      targets: [POS.swamp],
    },
    {
      title: '攻击敌方空地',
      body: '先撕开敌方前线空地，为后续攻城创造落点。',
      hint: '目标：占领高亮敌方空地。',
      targets: [POS.enemyLand],
    },
    {
      title: '攻击敌方城市',
      body: '夺取敌方城市可以压制对方增兵能力。',
      hint: '目标：占领高亮敌方城市。',
      targets: [POS.enemyCity],
    },
    {
      title: '胜利目标：夺取敌方皇冠',
      body: '最终目标是找到并攻陷敌方皇冠，接管敌方领土。',
      hint: '目标：在右侧区域找到并击败敌方皇冠。',
      targets: [POS.enemyCrown],
    },
    {
      title: '教程完成',
      body: '你已完成核心流程：拖图、缩放、探图、夺城、斩首。',
      hint: '可点击“重置教程”再练一次，然后返回首页进入实战。',
      targets: [],
    },
  ];

  const dom = {};
  let state = null;
  let tickTimer = 0;
  let crownBoostTimer = 0;

  function createTile(terrain, owner, army) {
    return {
      terrain: terrain,
      owner: owner,
      army: army,
    };
  }

  function createMatrix(rows, cols, factory) {
    const matrix = new Array(rows);
    for (let i = 0; i < rows; i += 1) {
      matrix[i] = new Array(cols);
      for (let j = 0; j < cols; j += 1) {
        matrix[i][j] = factory(i, j);
      }
    }
    return matrix;
  }

  function createInitialState() {
    return {
      board: createMatrix(BOARD_ROWS, BOARD_COLS, function () {
        return createTile('plain', 0, 0);
      }),
      visible: createMatrix(BOARD_ROWS, BOARD_COLS, function () {
        return false;
      }),
      discovered: createMatrix(BOARD_ROWS, BOARD_COLS, function () {
        return false;
      }),
      selected: { x: -1, y: -1 },
      queue: [],
      turn: 0,
      currentStep: 0,
      running: false,
      paused: true,
      pauseReason: '教学暂停：先熟悉地图控制。',
      didPan: false,
      didZoom: false,
      enemyDefeated: false,
      panX: 0,
      panY: 0,
      zoom: 1,
      pointer: {
        active: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        startPanX: 0,
        startPanY: 0,
        moved: false,
        downCell: null,
        downOnBack: false,
      },
    };
  }

  function setupScenarioBoard() {
    for (let i = 0; i < BOARD_ROWS; i += 1) {
      for (let j = 0; j < BOARD_COLS; j += 1) {
        state.board[i][j] = createTile('plain', 0, 0);
      }
    }

    const mountains = [
      [2, 6],
      [3, 6],
      [5, 6],
      [3, 8],
      [5, 8],
      [2, 11],
      [6, 10],
    ];
    for (let i = 0; i < mountains.length; i += 1) {
      const x = mountains[i][0];
      const y = mountains[i][1];
      state.board[x][y] = createTile('mountain', 0, 0);
    }

    state.board[POS.playerCrown[0]][POS.playerCrown[1]] = createTile('crown', PLAYER_ID, 1);

    state.board[4][7] = createTile('city', 0, 20);
    state.board[2][9] = createTile('city', 0, 25);
    state.board[4][8] = createTile('swamp', 0, 0);

    state.board[POS.enemyLand[0]][POS.enemyLand[1]] = createTile('plain', ENEMY_ID, 12);
    state.board[POS.enemyCity[0]][POS.enemyCity[1]] = createTile('city', ENEMY_ID, 18);
    state.board[POS.enemyCrown[0]][POS.enemyCrown[1]] = createTile('crown', ENEMY_ID, 28);

    state.board[3][10] = createTile('plain', ENEMY_ID, 8);
    state.board[5][10] = createTile('plain', ENEMY_ID, 9);
    state.board[3][11] = createTile('plain', ENEMY_ID, 7);
    state.board[5][11] = createTile('plain', ENEMY_ID, 7);
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < BOARD_ROWS && y < BOARD_COLS;
  }

  function tileAt(x, y) {
    if (!inBounds(x, y)) {
      return null;
    }
    return state.board[x][y];
  }

  function isAdjacent(a, b, x, y) {
    return Math.abs(a - x) + Math.abs(b - y) === 1;
  }

  function isPassable(x, y) {
    const tile = tileAt(x, y);
    return Boolean(tile) && tile.terrain !== 'mountain';
  }

  function isOwnTile(x, y) {
    const tile = tileAt(x, y);
    return Boolean(tile) && tile.owner === PLAYER_ID;
  }

  function setPaused(paused, reason) {
    state.paused = paused;
    state.pauseReason = reason || '';
  }

  function encodeVisibleTile(tile) {
    if (tile.terrain === 'mountain') {
      return { code: 201, army: 0 };
    }
    if (tile.terrain === 'swamp') {
      if (tile.owner > 0) {
        return { code: 150 + tile.owner, army: tile.army };
      }
      return { code: 204, army: 0 };
    }
    if (tile.terrain === 'city') {
      return { code: 50 + tile.owner, army: tile.army };
    }
    if (tile.terrain === 'crown') {
      return { code: 100 + tile.owner, army: tile.army };
    }
    if (tile.owner > 0 || tile.army > 0) {
      return { code: tile.owner, army: tile.army };
    }
    return { code: 200, army: 0 };
  }

  function encodeHiddenTile(tile) {
    if (tile.terrain === 'mountain' || tile.terrain === 'city') {
      return { code: 203, army: 0 };
    }
    if (tile.terrain === 'swamp') {
      return { code: 205, army: 0 };
    }
    return { code: 202, army: 0 };
  }

  function getDisplayCell(x, y) {
    const tile = tileAt(x, y);
    if (!tile) {
      return { code: 202, army: 0 };
    }
    const visible = state.visible[x][y];
    if (visible) {
      return encodeVisibleTile(tile);
    }
    return encodeHiddenTile(tile);
  }

  function refreshVisibility() {
    state.visible = createMatrix(BOARD_ROWS, BOARD_COLS, function () {
      return false;
    });
    for (let x = 0; x < BOARD_ROWS; x += 1) {
      for (let y = 0; y < BOARD_COLS; y += 1) {
        if (state.board[x][y].owner !== PLAYER_ID) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny)) {
              continue;
            }
            state.visible[nx][ny] = true;
            state.discovered[nx][ny] = true;
          }
        }
      }
    }
  }

  function getStepTargets(index) {
    const step = STEP_LIST[index] || STEP_LIST[STEP_LIST.length - 1];
    const targets = Array.isArray(step.targets) ? step.targets : [];
    const set = new Set();
    for (let i = 0; i < targets.length; i += 1) {
      const cell = targets[i];
      if (!Array.isArray(cell) || cell.length !== 2) {
        continue;
      }
      set.add(cell[0] + ',' + cell[1]);
    }
    return set;
  }

  function buildQueueRouteFlags() {
    const flags = new Array(4);
    for (let d = 0; d < 4; d += 1) {
      flags[d] = createMatrix(BOARD_ROWS, BOARD_COLS, function () {
        return false;
      });
    }
    for (let i = 0; i < state.queue.length; i += 1) {
      const cmd = state.queue[i];
      const dx = cmd.toX - cmd.fromX;
      const dy = cmd.toY - cmd.fromY;
      for (let d = 0; d < DIRECTIONS.length; d += 1) {
        if (DIRECTIONS[d].x === dx && DIRECTIONS[d].y === dy) {
          flags[d][cmd.fromX][cmd.fromY] = true;
          break;
        }
      }
    }
    return flags;
  }

  function buildCellClass(code) {
    let cls = 's' + SCALE_CLASS;
    if (code < 200) {
      if (code < 50) {
        cls += ' c' + code;
      } else if (code < 100) {
        cls += ' c' + (code - 50) + ' city';
      } else if (code < 150) {
        cls += ' c' + (code - 100) + ' general';
      } else {
        cls += ' c' + (code - 150) + ' swamp';
      }
    } else if (code === 200) {
      cls += ' empty';
    } else if (code === 201) {
      cls += ' mountain empty';
    } else if (code === 202) {
      cls += ' fog';
    } else if (code === 203) {
      cls += ' obstacle fog';
    } else if (code === 204) {
      cls += ' swamp';
    } else if (code === 205) {
      cls += ' swamp fog';
    }
    return cls;
  }

  function canIssueFromSelectedTo(x, y) {
    if (state.selected.x < 0 || state.selected.y < 0) {
      return false;
    }
    if (!inBounds(x, y) || !isAdjacent(state.selected.x, state.selected.y, x, y)) {
      return false;
    }
    if (!isPassable(x, y)) {
      return false;
    }
    const from = tileAt(state.selected.x, state.selected.y);
    if (!from) {
      return false;
    }
    const ownSelected = from.owner === PLAYER_ID;
    if (!ownSelected && state.queue.length === 0) {
      return false;
    }
    if (state.queue.length === 0 && from.army <= 1) {
      return false;
    }
    return true;
  }

  function renderMap() {
    const targets = getStepTargets(state.currentStep);
    const routeFlags = buildQueueRouteFlags();
    let html = '<table><tbody>';
    for (let x = 0; x < BOARD_ROWS; x += 1) {
      html += '<tr>';
      for (let y = 0; y < BOARD_COLS; y += 1) {
        const display = getDisplayCell(x, y);
        let cls = buildCellClass(display.code);

        if (state.selected.x === x && state.selected.y === y) {
          cls += ' selected';
        } else if (canIssueFromSelectedTo(x, y)) {
          cls += ' attackable';
        }

        if (targets.has(x + ',' + y)) {
          cls += ' tutorial-target';
        }

        let txt = '';
        if (display.code < 200 && (display.army > 0 || display.code === 50)) {
          txt = String(display.army);
          if (SCALE_CLASS === 1) {
            txt = '<div class="txt">' + txt + '</div>';
          }
        }

        for (let d = 0; d < 4; d += 1) {
          if (routeFlags[d][x][y]) {
            txt += '<div class="' + DIRE_CLASSES[d] + '">' + DIRE_CHARS[d] + '</div>';
          }
        }

        html += '<td data-x="' + x + '" data-y="' + y + '" class="' + cls + '">' + txt + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    dom.map.innerHTML = html;

    dom.map.style.setProperty('--pan-x', state.panX + 'px');
    dom.map.style.setProperty('--pan-y', state.panY + 'px');
    dom.map.style.setProperty('--zoom', String(state.zoom));
  }

  function formatTurn(turn) {
    return Math.floor(turn / 2) + (turn % 2 === 1 ? '.' : '');
  }

  function collectStats(owner) {
    let army = 0;
    let land = 0;
    for (let x = 0; x < BOARD_ROWS; x += 1) {
      for (let y = 0; y < BOARD_COLS; y += 1) {
        const tile = tileAt(x, y);
        if (!tile || tile.owner !== owner) {
          continue;
        }
        army += Math.max(0, tile.army);
        land += 1;
      }
    }
    return { army: army, land: land };
  }

  function renderLeaderboard() {
    const p1 = collectStats(PLAYER_ID);
    const p2 = collectStats(ENEMY_ID);
    let html = '<tr><td>队伍</td><td>玩家</td><td>兵力</td><td>领土</td></tr>';
    html +=
      '<tr class="' +
      (p1.land <= 0 ? 'dead' : '') +
      '"><td>1</td><td class="leaderboard-name c1">你（教程）</td><td>' +
      p1.army +
      '</td><td>' +
      p1.land +
      '</td></tr>';
    html +=
      '<tr class="' +
      (p2.land <= 0 ? 'dead' : '') +
      '"><td>2</td><td class="leaderboard-name c2">敌方</td><td>' +
      p2.army +
      '</td><td>' +
      p2.land +
      '</td></tr>';
    dom.leaderboard.innerHTML = html;
  }

  function renderHud() {
    dom.turnCounter.textContent = '回合 ' + formatTurn(state.turn);
  }

  function renderStepPanel() {
    const step = STEP_LIST[state.currentStep] || STEP_LIST[STEP_LIST.length - 1];
    dom.stepProgress.textContent = '步骤 ' + (state.currentStep + 1) + ' / ' + STEP_LIST.length;
    dom.stepTitle.textContent = step.title;
    dom.stepBody.textContent = step.body;
    dom.stepHint.textContent = step.hint;
  }

  function renderAll() {
    renderStepPanel();
    renderMap();
    renderLeaderboard();
    renderHud();
  }

  function addQueueCommand(fromX, fromY, toX, toY) {
    state.queue.push({
      fromX: fromX,
      fromY: fromY,
      toX: toX,
      toY: toY,
    });
  }

  function clearQueue() {
    state.queue = [];
    renderAll();
    evaluateStepProgress();
  }

  function popQueue() {
    if (!state.queue.length) {
      return;
    }
    const cmd = state.queue.pop();
    if (state.selected.x === cmd.toX && state.selected.y === cmd.toY) {
      state.selected.x = cmd.fromX;
      state.selected.y = cmd.fromY;
    }
    renderAll();
    evaluateStepProgress();
  }

  function applyCaptureIfEnemyDefeated() {
    for (let x = 0; x < BOARD_ROWS; x += 1) {
      for (let y = 0; y < BOARD_COLS; y += 1) {
        const tile = tileAt(x, y);
        if (!tile || tile.owner !== ENEMY_ID) {
          continue;
        }
        tile.owner = PLAYER_ID;
        if (tile.terrain === 'crown') {
          tile.terrain = 'city';
        }
      }
    }
    state.enemyDefeated = true;
    state.queue = [];
  }

  function executeMove(cmd) {
    if (!inBounds(cmd.fromX, cmd.fromY) || !inBounds(cmd.toX, cmd.toY)) {
      return false;
    }
    if (!isAdjacent(cmd.fromX, cmd.fromY, cmd.toX, cmd.toY)) {
      return false;
    }

    const from = tileAt(cmd.fromX, cmd.fromY);
    const to = tileAt(cmd.toX, cmd.toY);
    if (!from || !to || from.owner !== PLAYER_ID || from.army <= 1) {
      return false;
    }
    if (to.terrain === 'mountain') {
      return false;
    }

    const movingArmy = from.army - 1;
    if (movingArmy <= 0) {
      return false;
    }
    from.army -= movingArmy;

    if (to.owner === PLAYER_ID) {
      to.army += movingArmy;
      return true;
    }

    if (movingArmy > to.army) {
      const capturedArmy = movingArmy - to.army;
      const prevOwner = to.owner;
      const capturedEnemyCrown = to.terrain === 'crown' && prevOwner === ENEMY_ID;
      to.owner = PLAYER_ID;
      to.army = capturedArmy;
      if (capturedEnemyCrown) {
        applyCaptureIfEnemyDefeated();
      }
      return true;
    }

    to.army -= movingArmy;
    if (to.army === 0 && to.terrain === 'plain') {
      to.owner = 0;
    }
    return true;
  }

  function applyGrowth() {
    if (state.turn % 2 === 0) {
      for (let x = 0; x < BOARD_ROWS; x += 1) {
        for (let y = 0; y < BOARD_COLS; y += 1) {
          const tile = tileAt(x, y);
          if (!tile || tile.owner <= 0) {
            continue;
          }
          if (tile.terrain === 'city' || tile.terrain === 'crown') {
            tile.army += 1;
          }
        }
      }
    }

    if (state.turn % 50 === 0) {
      for (let x = 0; x < BOARD_ROWS; x += 1) {
        for (let y = 0; y < BOARD_COLS; y += 1) {
          const tile = tileAt(x, y);
          if (!tile || tile.owner <= 0) {
            continue;
          }
          tile.army += 1;
        }
      }
    }
  }

  function applySwampDrain() {
    for (let x = 0; x < BOARD_ROWS; x += 1) {
      for (let y = 0; y < BOARD_COLS; y += 1) {
        const tile = tileAt(x, y);
        if (!tile || tile.terrain !== 'swamp' || tile.owner <= 0) {
          continue;
        }
        tile.army -= 1;
        if (tile.army <= 0) {
          tile.army = 0;
          tile.owner = 0;
        }
      }
    }
  }

  function tick() {
    if (!state.running || state.paused) {
      return;
    }

    state.turn += 1;

    if (state.queue.length > 0) {
      const cmd = state.queue.shift();
      executeMove(cmd);
    }

    applyGrowth();
    applySwampDrain();
    refreshVisibility();
    renderAll();
    evaluateStepProgress();
  }

  function startTickLoop() {
    if (tickTimer) {
      window.clearInterval(tickTimer);
    }
    tickTimer = window.setInterval(tick, TICK_MS);
  }

  function stopCrownBoost() {
    if (crownBoostTimer) {
      window.clearInterval(crownBoostTimer);
      crownBoostTimer = 0;
    }
  }

  function startCrownBoost() {
    stopCrownBoost();
    state.running = true;
    state.turn = 0;
    state.queue = [];
    state.selected = { x: -1, y: -1 };
    setPaused(true, '教学加速中：皇冠兵力从 1 提升到 100。');

    const crown = tileAt(POS.playerCrown[0], POS.playerCrown[1]);
    if (crown) {
      crown.army = 1;
    }
    refreshVisibility();
    renderAll();

    crownBoostTimer = window.setInterval(function () {
      const crownTile = tileAt(POS.playerCrown[0], POS.playerCrown[1]);
      if (!crownTile) {
        stopCrownBoost();
        return;
      }
      crownTile.army = Math.min(100, crownTile.army + 11);
      renderAll();
      if (crownTile.army >= 100) {
        stopCrownBoost();
        setPaused(false, '');
        nextStep();
      }
    }, 140);
  }

  function isOwned(pos) {
    const tile = tileAt(pos[0], pos[1]);
    return Boolean(tile) && tile.owner === PLAYER_ID;
  }

  function isSelected(pos) {
    return state.selected.x === pos[0] && state.selected.y === pos[1];
  }

  function evaluateStepProgress() {
    switch (state.currentStep) {
      case 0:
        if (state.didPan) {
          nextStep();
        }
        break;
      case 1:
        if (state.didZoom) {
          nextStep();
        }
        break;
      case 2:
        break;
      case 3:
        if (isSelected(POS.playerCrown)) {
          nextStep();
        }
        break;
      case 4:
        if (isOwned(POS.firstMove)) {
          nextStep();
        }
        break;
      case 5:
        if (isOwned([4, 5])) {
          nextStep();
        }
        break;
      case 6:
        if (isOwned(POS.scout)) {
          nextStep();
        }
        break;
      case 7:
        if (isOwned(POS.neutralCity)) {
          nextStep();
        }
        break;
      case 8:
        if (isOwned(POS.swamp)) {
          nextStep();
        }
        break;
      case 9:
        if (isOwned(POS.enemyLand)) {
          nextStep();
        }
        break;
      case 10:
        if (isOwned(POS.enemyCity)) {
          nextStep();
        }
        break;
      case 11:
        if (state.enemyDefeated || isOwned(POS.enemyCrown)) {
          nextStep();
        }
        break;
      default:
        break;
    }
  }

  function enterStep(index) {
    if (index < 0) {
      index = 0;
    }
    if (index >= STEP_LIST.length) {
      index = STEP_LIST.length - 1;
    }
    state.currentStep = index;

    if (index === 0) {
      setPaused(true, '教学暂停：请先拖动地图。');
      state.running = false;
    } else if (index === 1) {
      setPaused(true, '教学暂停：请再试一次缩放地图。');
      state.running = false;
    } else if (index === 2) {
      startCrownBoost();
      return;
    } else if (index === STEP_LIST.length - 1) {
      setPaused(true, '教程结束。');
      state.running = false;
      state.queue = [];
    }

    renderAll();
    window.setTimeout(evaluateStepProgress, 0);
  }

  function nextStep() {
    const next = Math.min(STEP_LIST.length - 1, state.currentStep + 1);
    if (next === state.currentStep) {
      return;
    }
    enterStep(next);
  }

  function tryQueueAttackTo(x, y) {
    if (!state.running || !canIssueFromSelectedTo(x, y)) {
      return false;
    }
    addQueueCommand(state.selected.x, state.selected.y, x, y);
    state.selected = { x: x, y: y };
    renderAll();
    evaluateStepProgress();
    return true;
  }

  function handleTileClick(x, y) {
    if (!inBounds(x, y)) {
      return;
    }

    if (tryQueueAttackTo(x, y)) {
      return;
    }

    if (!state.running) {
      return;
    }

    if (isOwnTile(x, y) && state.visible[x][y]) {
      state.selected = { x: x, y: y };
    } else {
      state.selected = { x: -1, y: -1 };
    }

    renderAll();
    evaluateStepProgress();
  }

  function findCellFromEventTarget(target) {
    if (!target || typeof target.closest !== 'function') {
      return null;
    }
    const td = target.closest('td');
    if (!td) {
      return null;
    }
    const x = Number.parseInt(String(td.dataset.x || ''), 10);
    const y = Number.parseInt(String(td.dataset.y || ''), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x: x, y: y };
  }

  function isMapTarget(target) {
    if (!target) {
      return false;
    }
    if (target === dom.mapBack) {
      return true;
    }
    if (typeof target.closest === 'function' && target.closest('#map')) {
      return true;
    }
    return false;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !isMapTarget(event.target)) {
      return;
    }
    state.pointer.active = true;
    state.pointer.pointerId = event.pointerId;
    state.pointer.startX = event.clientX;
    state.pointer.startY = event.clientY;
    state.pointer.startPanX = state.panX;
    state.pointer.startPanY = state.panY;
    state.pointer.moved = false;
    state.pointer.downCell = findCellFromEventTarget(event.target);
    state.pointer.downOnBack = event.target === dom.mapBack;
    dom.map.classList.add('dragging');

    if (typeof event.target.setPointerCapture === 'function') {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch {
        // noop
      }
    }
  }

  function onPointerMove(event) {
    if (!state.pointer.active || state.pointer.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - state.pointer.startX;
    const dy = event.clientY - state.pointer.startY;

    if (Math.abs(dx) > CLICK_TOLERANCE || Math.abs(dy) > CLICK_TOLERANCE) {
      state.pointer.moved = true;
    }

    state.panX = state.pointer.startPanX + dx;
    state.panY = state.pointer.startPanY + dy;
    dom.map.style.setProperty('--pan-x', state.panX + 'px');
    dom.map.style.setProperty('--pan-y', state.panY + 'px');

    if (!state.didPan && Math.sqrt(dx * dx + dy * dy) > PAN_TRIGGER_PIXELS) {
      state.didPan = true;
      evaluateStepProgress();
    }
  }

  function onPointerUp(event) {
    if (!state.pointer.active || state.pointer.pointerId !== event.pointerId) {
      return;
    }

    const moved = state.pointer.moved;
    const downCell = state.pointer.downCell;
    const downOnBack = state.pointer.downOnBack;

    state.pointer.active = false;
    state.pointer.pointerId = -1;
    state.pointer.downCell = null;
    state.pointer.downOnBack = false;

    dom.map.classList.remove('dragging');

    if (!moved) {
      if (downCell) {
        handleTileClick(downCell.x, downCell.y);
      } else if (downOnBack && state.running) {
        state.selected = { x: -1, y: -1 };
        renderAll();
      }
    }
  }

  function onWheel(event) {
    if (!isMapTarget(event.target)) {
      return;
    }
    event.preventDefault();

    const oldZoom = state.zoom;
    if (event.deltaY > 0) {
      state.zoom = Math.max(MIN_ZOOM, state.zoom - 0.08);
    } else {
      state.zoom = Math.min(MAX_ZOOM, state.zoom + 0.08);
    }

    if (oldZoom !== state.zoom) {
      dom.map.style.setProperty('--zoom', String(state.zoom));
      if (!state.didZoom) {
        state.didZoom = true;
        evaluateStepProgress();
      }
    }
  }

  function tryMoveByDirection(dx, dy) {
    if (state.selected.x < 0 || state.selected.y < 0) {
      return;
    }
    const x = state.selected.x + dx;
    const y = state.selected.y + dy;
    if (!inBounds(x, y)) {
      return;
    }
    tryQueueAttackTo(x, y);
  }

  function onKeyDown(event) {
    const target = event.target;
    const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') {
      return;
    }

    const key = String(event.key || '').toLowerCase();

    for (let i = 0; i < DIRECTIONS.length; i += 1) {
      if (DIRECTIONS[i].key.indexOf(key) >= 0) {
        event.preventDefault();
        tryMoveByDirection(DIRECTIONS[i].x, DIRECTIONS[i].y);
        return;
      }
    }

    if (key === 'q') {
      event.preventDefault();
      clearQueue();
      return;
    }
    if (key === 'e') {
      event.preventDefault();
      popQueue();
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      state.selected = { x: -1, y: -1 };
      renderAll();
      evaluateStepProgress();
    }
  }

  function bindEvents() {
    dom.homeBtn.addEventListener('click', function () {
      location.href = '/';
    });

    dom.resetBtn.addEventListener('click', function () {
      resetTutorial();
    });

    dom.map.addEventListener('pointerdown', onPointerDown);
    dom.mapBack.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);

    dom.map.addEventListener('wheel', onWheel, { passive: false });
    dom.mapBack.addEventListener('wheel', onWheel, { passive: false });

    document.addEventListener('keydown', onKeyDown);
  }

  function resetTutorial() {
    stopCrownBoost();
    state = createInitialState();
    setupScenarioBoard();
    refreshVisibility();
    renderAll();
    enterStep(0);
  }

  async function loadUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        throw new Error('unauthorized');
      }
      const data = await res.json();
      dom.accountName.textContent = String(data.username || '');
      return true;
    } catch {
      location.href = '/login';
      return false;
    }
  }

  function cacheDom() {
    dom.map = document.getElementById('map');
    dom.mapBack = document.getElementById('map_back');
    dom.turnCounter = document.getElementById('turn-counter');
    dom.leaderboard = document.getElementById('game-leaderboard');
    dom.stepProgress = document.getElementById('tutorial-step-progress');
    dom.stepTitle = document.getElementById('tutorial-step-title');
    dom.stepBody = document.getElementById('tutorial-step-body');
    dom.stepHint = document.getElementById('tutorial-step-hint');
    dom.homeBtn = document.getElementById('room-home-btn');
    dom.resetBtn = document.getElementById('tutorial-reset-btn');
    dom.accountName = document.getElementById('account-name');
  }

  async function main() {
    cacheDom();
    const authed = await loadUser();
    if (!authed) {
      return;
    }
    bindEvents();
    resetTutorial();
    startTickLoop();
  }

  main();
})();
