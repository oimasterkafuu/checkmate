/**
 * 游戏策略算法模块
 * 负责计算最佳移动策略
 */
class GameStrategy {
  constructor() {
    this.directions = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    // 皇冠距离地图，存储每个格子到最近皇冠的距离
    this.crownDistanceMap = null;
    this.isInitialized = false;

    // 新增：强制移动标志和回合计数
    this.forceMoveFlag = false;
    this.roundCount = 0;

    // 视野系统
    this.shown = null; // 记录曾经看到过的地方
    this.knownCrowns = []; // 已知的敌方皇冠位置
    this.knownNotCrowns = new Set(); // 已知不是皇冠的位置
    this.gameSize = 0;
    // 新增：敌人移动追踪属性
    this.previousColorMap = null; // 上一回合的颜色分布
    this.enemyMoveHistory = {}; // 记录各敌方最近3次移动 { color: [ {x,y} ] }
    this.currentThreat = null; // 当前根据移动识别到的威胁
    this.lastDefenseMove = null; // 记录最后一次防御移动，防止反复跳动
    // 调试开关：守家相关
    this.debugDefense = false; // 设置为true输出详细调试信息
  }

  /**
   * 初始化皇冠距离地图
   * @param {Array} gameMap 游戏地图
   * @param {number} size 地图大小
   */
  initializeCrownDistanceMap(gameMap, size, myColor) {
    if (this.isInitialized) return;

    // 初始化距离地图，默认值为无穷大
    this.crownDistanceMap = Array(size + 1)
      .fill(null)
      .map(() => Array(size + 1).fill(Infinity));

    // 找到所有皇冠位置 (type=1 表示皇冠)
    // 更新：只判断自己的皇冠
    const crowns = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;
        if (gameMap[i][j].type === 1 && gameMap[i][j].color === myColor) {
          // 皇冠
          crowns.push({ x: i, y: j });
        }
      }
    }

    // 对每个皇冠进行BFS，计算到其他格子的距离
    crowns.forEach((crown, index) => {
      this.bfsFromCrown(gameMap, crown.x, crown.y, size);
    });

    this.isInitialized = true;
  }

  /**
   * 从指定皇冠位置进行BFS，更新距离地图
   * @param {Array} gameMap 游戏地图
   * @param {number} startX 皇冠X坐标
   * @param {number} startY 皇冠Y坐标
   * @param {number} size 地图大小
   */
  bfsFromCrown(gameMap, startX, startY, size) {
    const queue = [{ x: startX, y: startY, distance: 0 }];
    const visited = new Set();
    visited.add(`${startX},${startY}`);

    // 皇冠位置距离为0
    this.crownDistanceMap[startX][startY] = Math.min(
      this.crownDistanceMap[startX][startY],
      0
    );

    while (queue.length > 0) {
      const current = queue.shift();

      // 探索四个方向
      for (let dir of this.directions) {
        const newX = current.x + dir.dx;
        const newY = current.y + dir.dy;
        const key = `${newX},${newY}`;

        // 边界检查
        if (newX <= 0 || newX > size || newY <= 0 || newY > size) continue;

        if (!gameMap[newX] || !gameMap[newX][newY]) continue;
        if (visited.has(key)) continue;

        const cell = gameMap[newX][newY];

        // 只计算可通行格子的距离（包括死胡同检测）
        if (this.isPassable(cell, gameMap, newX, newY, size)) {
          visited.add(key);
          const newDistance = current.distance + 1;

          // 更新最小距离
          this.crownDistanceMap[newX][newY] = Math.min(
            this.crownDistanceMap[newX][newY],
            newDistance
          );

          queue.push({ x: newX, y: newY, distance: newDistance });
        }
      }
    }
  }

  /**
   * 获取指定位置到最近皇冠的距离
   * @param {number} x X坐标
   * @param {number} y Y坐标
   * @returns {number} 距离值
   */
  getCrownDistance(x, y) {
    if (
      !this.crownDistanceMap ||
      !this.crownDistanceMap[x] ||
      this.crownDistanceMap[x][y] === undefined
    ) {
      return Infinity;
    }
    return this.crownDistanceMap[x][y];
  }

  /**
   * 重置初始化状态，用于新游戏开始时重新计算皇冠距离
   */
  resetInitialization() {
    this.isInitialized = false;
    this.crownDistanceMap = null;

    // 重置强制移动相关状态
    this.forceMoveFlag = false;
    this.roundCount = 0;

    // 重置视野系统
    this.shown = null;
    this.knownCrowns = [];
    this.knownNotCrowns = new Set();
    this.gameSize = 0;
    // 新增：重置敌人移动追踪
    this.previousColorMap = null;
    this.enemyMoveHistory = {};
    this.currentThreat = null;
  }

  /**
   * 初始化视野地图
   * @param {number} size 地图大小
   */
  initializeVision(size) {
    if (this.gameSize !== size) {
      this.gameSize = size;
      this.shown = Array(size + 1)
        .fill(null)
        .map(() => Array(size + 1).fill(false));
    }
  }

  /**
   * 判断指定位置是否在视野范围内
   * @param {Array} gameMap 游戏地图
   * @param {number} i X坐标
   * @param {number} j Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否可见
   */
  judgeShown(gameMap, i, j, myColor, size) {
    let visiRound = 1;
    if (gameMap[0] && gameMap[0][0] && gameMap[0][0].type == 2) visiRound = 2;

    for (let t1 = -visiRound; t1 <= visiRound; ++t1) {
      for (let t2 = -visiRound; t2 <= visiRound; ++t2) {
        let ii = i + t1,
          jj = j + t2;
        if (ii <= 0 || jj <= 0 || ii > size || jj > size) continue;
        if (!gameMap[ii] || !gameMap[ii][jj]) continue;
        if (gameMap[ii][jj].color == myColor) return true;
      }
    }
    return false;
  }

  /**
   * 更新视野和已知信息
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   */
  updateVision(gameMap, myColor, size) {
    this.initializeVision(size);

    // 更新视野地图
    for (let i = 1; i <= size; i++) {
      for (let j = 1; j <= size; j++) {
        if (this.judgeShown(gameMap, i, j, myColor, size)) {
          this.shown[i][j] = true;

          // 检查这个位置的信息
          if (gameMap[i] && gameMap[i][j]) {
            const cell = gameMap[i][j];
            const key = `${i},${j}`;

            // 如果是敌方皇冠，加入已知皇冠列表
            if (cell.type === 1 && cell.color !== 0 && cell.color !== myColor) {
              const exists = this.knownCrowns.some(
                (crown) => crown.x === i && crown.y === j
              );
              if (!exists) {
                this.knownCrowns.push({ x: i, y: j, color: cell.color });
              }
            }
            // 如果不是皇冠，标记为已知非皇冠
            else if (cell.type !== 1) {
              this.knownNotCrowns.add(key);
            }
          }
        }
      }
    }

    // 检查已知皇冠是否仍然存在（如果被攻下就移除）
    this.updateKnownCrowns(gameMap, myColor, size);

    // 检测可能的皇冠位置（三面环山，一面敌方城市）
    this.detectPossibleCrowns(gameMap, myColor, size);

    // 调试输出视野信息
    if (false && this.roundCount % 50 === 0) {
      // 每50回合输出一次
      const seenCrowns = this.knownCrowns.filter((c) => !c.suspected).length;
      const suspectedCrowns = this.knownCrowns.filter(
        (c) => c.suspected
      ).length;
    }
  }

  /**
   * 更新已知皇冠状态，移除已被攻下的皇冠
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   */
  updateKnownCrowns(gameMap, myColor, size) {
    // 检查每个已知皇冠的当前状态
    const stillExistingCrowns = [];

    for (let crown of this.knownCrowns) {
      const x = crown.x;
      const y = crown.y;

      // 检查这个位置是否仍在视野内
      if (
        x > 0 &&
        x <= size &&
        y > 0 &&
        y <= size &&
        this.shown[x] &&
        this.shown[x][y]
      ) {
        // 在视野内，检查是否仍然是皇冠
        if (gameMap[x] && gameMap[x][y]) {
          const cell = gameMap[x][y];

          // 如果仍然是敌方皇冠，保留
          if (cell.type === 1 && cell.color !== 0 && cell.color !== myColor) {
            stillExistingCrowns.push(crown);
          } else {
            // 不再是皇冠，标记为非皇冠位置
            const key = `${x},${y}`;
            this.knownNotCrowns.add(key);

            if (false) {
              // 调试输出
              const crownType = crown.suspected ? "推测" : "已见";
            }
          }
        } else {
          // 位置无效，移除
          const key = `${x},${y}`;
          this.knownNotCrowns.add(key);
        }
      } else {
        // 不在视野内，暂时保留（可能重新进入视野时验证）
        stillExistingCrowns.push(crown);
      }
    }

    // 更新已知皇冠列表
    this.knownCrowns = stillExistingCrowns;
  }

  /**
   * 检测可能的皇冠位置（三面环山，一面敌方城市）
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   */
  detectPossibleCrowns(gameMap, myColor, size) {
    for (let i = 1; i <= size; i++) {
      for (let j = 1; j <= size; j++) {
        // 如果这个位置是城市/山，就肯定不可能
        if (gameMap[i] && gameMap[i][j]) {
          const cell = gameMap[i][j];
          if (cell.type === 2 || cell.type === 3 || cell.type === 4) {
            const key = `${i},${j}`;
            this.knownNotCrowns.add(key);
          }
        }

        // 先检查是否三面环山，一面敌方城市，并收集山的位置
        let mountainCount = 0;
        let enemyCityCount = 0;
        let enemyColor = null;
        let mountainDirections = [];

        for (let dir of this.directions) {
          const ni = i + dir.dx;
          const nj = j + dir.dy;
          if (ni <= 0 || ni > size || nj <= 0 || nj > size) {
            mountainCount++; // 边界视为山
            mountainDirections.push(dir);
            continue;
          }

          if (gameMap[ni] && gameMap[ni][nj]) {
            const cell = gameMap[ni][nj];
            if (cell.type === 4) {
              // 山
              mountainCount++;
              mountainDirections.push(dir);
            } else if (
              (cell.type === 2 || cell.type === 3) &&
              cell.color !== 0 &&
              cell.color !== myColor
            ) {
              // 敌方城市
              enemyCityCount++;
              enemyColor = cell.color;
            }
          }
        }

        // 如果不是三面环山，一面敌方城市的模式，跳过
        if (mountainCount !== 3 || enemyCityCount !== 1) continue;

        // 检查三面环山的位置是否都shown过（城市那面不需要检查）
        let mountainsAllShown = true;
        for (let dir of mountainDirections) {
          const ni = i + dir.dx;
          const nj = j + dir.dy;
          if (ni <= 0 || ni > size || nj <= 0 || nj > size) continue; // 边界默认为shown
          if (!this.shown[ni][nj]) {
            mountainsAllShown = false;
            break;
          }
        }

        if (!mountainsAllShown) continue;

        // 如果地图的这个地方是白色的，那么不可能
        if (gameMap[i][j].color === 0) continue;

        // 满足条件，推测这里是皇冠
        const key = `${i},${j}`;
        if (!this.knownNotCrowns.has(key)) {
          const exists = this.knownCrowns.some(
            (crown) => crown.x === i && crown.y === j
          );
          if (!exists) {
            this.knownCrowns.push({
              x: i,
              y: j,
              color: enemyColor,
              suspected: true, // 标记为推测的皇冠
            });

            if (false) {
              // 调试输出
            }
          }
        }
      }
    }
  }

  /**
   * 检查指定位置是否是死胡同
   * @param {Array} gameMap 游戏地图
   * @param {number} x X坐标
   * @param {number} y Y坐标
   * @param {number} size 地图大小
   * @returns {boolean} 是否是死胡同
   */
  isDeadEnd(gameMap, x, y, size) {
    return false;

    if (x <= 0 || x > size || y <= 0 || y > size) return false;
    if (!gameMap[x] || !gameMap[x][y]) return false;

    const cell = gameMap[x][y];

    // 只有空白格子才可能是死胡同
    if (cell.color !== 0) return false;

    let mountainCount = 0;
    let cityCount = 0;

    // 检查四个方向
    for (let dir of this.directions) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      // 边界视为山
      if (nx <= 0 || nx > size || ny <= 0 || ny > size) {
        mountainCount++;
        continue;
      }

      if (!gameMap[nx] || !gameMap[nx][ny]) continue;

      const adjCell = gameMap[nx][ny];
      if (adjCell.type === 4) {
        // 山
        mountainCount++;
      } else if (adjCell.type === 2 || adjCell.type === 3) {
        // 城市
        cityCount++;
      }
    }

    // 死胡同条件：3面环山，1面为城市
    return mountainCount === 3 && cityCount === 1;
  }

  /**
   * 检查地形是否可通行（包含死胡同检测）
   * @param {Object} cell 地图格子
   * @param {Array} gameMap 游戏地图（可选，用于死胡同检测）
   * @param {number} x X坐标（可选，用于死胡同检测）
   * @param {number} y Y坐标（可选，用于死胡同检测）
   * @param {number} size 地图大小（可选，用于死胡同检测）
   * @returns {boolean} 是否可通行
   */
  isPassable(cell, gameMap = null, x = null, y = null, size = null) {
    // 基本可通行性检查：只有山(type=4)不可通行
    if (!cell) return false;
    if (cell.type === 4) return false;

    // 如果提供了地图信息，检查是否是死胡同
    if (gameMap && x !== null && y !== null && size !== null) {
      if (this.isDeadEnd(gameMap, x, y, size)) {
        return false; // 死胡同不可通行
      }
    }

    return true;
  }

  /**
   * 检查是否可以攻击敌方皇冠
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 可攻击的敌方皇冠位置，如果没有则返回null
   */
  checkEnemyCrownAttack(gameMap, myColor, size) {
    // 找到我方所有可攻击的格子
    const myCells = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j] || gameMap[i][j].color !== myColor) continue;

        // 检查周围是否有敌方皇冠
        for (let dir of this.directions) {
          const adjX = i + dir.dx;
          const adjY = j + dir.dy;

          if (adjX < 1 || adjX > size || adjY < 1 || adjY > size) continue;
          if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

          const adjCell = gameMap[adjX][adjY];
          // 检查是否是敌方皇冠且可攻击
          if (
            adjCell.color !== 0 &&
            adjCell.color !== myColor &&
            adjCell.type === 1 &&
            gameMap[i][j].amount > adjCell.amount + 1
          ) {
            return {
              fromX: i,
              fromY: j,
              toX: adjX,
              toY: adjY,
              fromAmount: gameMap[i][j].amount,
              toAmount: adjCell.amount,
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * 检查指定位置是否是边缘格子
   * @param {Array} gameMap 游戏地图
   * @param {number} x X坐标
   * @param {number} y Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否是边缘
   */
  isEdgeCell(gameMap, x, y, myColor, size) {
    // 检查指定位置是否是边缘格子
    if (!gameMap[x] || !gameMap[x][y]) return false;
    if (gameMap[x][y].color !== myColor) return false;

    // 检查四个方向是否有非我方且可到达的格子
    for (let dir of this.directions) {
      const adjX = x + dir.dx;
      const adjY = y + dir.dy;

      if (adjX <= 0 || adjX > size || adjY <= 0 || adjY > size) continue;

      if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

      const adjCell = gameMap[adjX][adjY];

      // 如果相邻格子不是我方且可到达，则当前位置是边缘
      if (
        adjCell.color !== myColor &&
        this.isPassable(adjCell, gameMap, adjX, adjY, size)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查边缘格子是否与敌人相邻
   * @param {Array} gameMap 游戏地图
   * @param {number} x X坐标
   * @param {number} y Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否与敌人相邻
   */
  isEdgeCellWithEnemy(gameMap, x, y, myColor, size) {
    if (!this.isEdgeCell(gameMap, x, y, myColor, size)) {
      return false;
    }

    // 检查四个方向是否有敌方格子
    for (let dir of this.directions) {
      const adjX = x + dir.dx;
      const adjY = y + dir.dy;

      if (adjX <= 0 || adjX > size || adjY <= 0 || adjY > size) continue;

      if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

      const adjCell = gameMap[adjX][adjY];

      // 如果有敌方格子，则与敌人相邻
      if (adjCell.color !== 0 && adjCell.color !== myColor) {
        return true;
      }
    }

    return false;
  }

  /**
   * BFS搜索到最近边缘的路径
   * @param {Array} gameMap 游戏地图
   * @param {Object} fromCell 起始格子 {x, y}
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @param {boolean} preferEnemyEdge 是否优先选择与敌人相邻的边缘格子
   * @returns {Object|null} 移动指令或null
   */
  findPathToNearestEdge(
    gameMap,
    fromCell,
    myColor,
    size,
    preferEnemyEdge = false
  ) {
    const visited = new Set();
    const queue = [{ x: fromCell.x, y: fromCell.y, path: [] }];
    visited.add(`${fromCell.x},${fromCell.y}`);

    // 如果优先选择与敌人相邻的边缘格子，需要收集所有边缘格子
    const allEdgeCells = preferEnemyEdge ? [] : null;

    while (queue.length > 0) {
      const current = queue.shift();

      // 检查当前位置是否是边缘
      if (this.isEdgeCell(gameMap, current.x, current.y, myColor, size)) {
        if (preferEnemyEdge) {
          // 收集所有边缘格子
          allEdgeCells.push({
            x: current.x,
            y: current.y,
            path: current.path,
            hasEnemy: this.isEdgeCellWithEnemy(
              gameMap,
              current.x,
              current.y,
              myColor,
              size
            ),
          });
        } else {
          // 找到边缘！返回第一步移动
          if (current.path.length > 0) {
            const firstStep = current.path[0];
            return {
              fromX: fromCell.x,
              fromY: fromCell.y,
              toX: firstStep.x,
              toY: firstStep.y,
              half: false,
            };
          }
          // 起始位置就是边缘，不应该到这里
          break;
        }
      }

      // 继续BFS搜索
      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const nextCell = gameMap[nextX][nextY];
        if (!this.isPassable(nextCell, gameMap, nextX, nextY, size)) continue;

        // 只在我方格子内搜索
        if (nextCell.color === myColor) {
          visited.add(key);
          const newPath = [...current.path];
          if (newPath.length === 0) {
            newPath.push({ x: nextX, y: nextY });
          }
          queue.push({ x: nextX, y: nextY, path: newPath });
        }
      }
    }

    // 如果优先选择与敌人相邻的边缘格子，处理收集到的边缘格子
    if (preferEnemyEdge && allEdgeCells.length > 0) {
      // 优先选择与敌人相邻的边缘格子
      const enemyAdjacentEdges = allEdgeCells.filter((edge) => edge.hasEnemy);
      const targetEdges =
        enemyAdjacentEdges.length > 0 ? enemyAdjacentEdges : allEdgeCells;

      // 选择路径最短的边缘格子
      let bestEdge = targetEdges[0];
      for (let edge of targetEdges) {
        if (edge.path.length < bestEdge.path.length) {
          bestEdge = edge;
        }
      }

      // 返回第一步移动
      if (bestEdge.path.length > 0) {
        const firstStep = bestEdge.path[0];
        return {
          fromX: fromCell.x,
          fromY: fromCell.y,
          toX: firstStep.x,
          toY: firstStep.y,
          half: false,
        };
      }
    }

    return null;
  }

  /**
   * 检查边缘格是否应该分兵
   * @param {Array} gameMap 游戏地图
   * @param {number} x X坐标
   * @param {number} y Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 分兵移动指令或null
   */
  checkSplitMove(gameMap, x, y, myColor, size) {
    const myCell = gameMap[x][y];

    // 必须是我方格子且有足够兵力
    if (!myCell || myCell.color !== myColor || myCell.amount <= 1) {
      return null;
    }

    // 必须是边缘格子
    if (!this.isEdgeCell(gameMap, x, y, myColor, size)) {
      return null;
    }

    // 统计边缘周围非我方且可移动的位置
    const targetPositions = [];
    const haveEnemy = this.isEdgeCellWithEnemy(gameMap, x, y, myColor, size);

    for (let dir of this.directions) {
      const adjX = x + dir.dx;
      const adjY = y + dir.dy;

      if (adjX <= 0 || adjX > size || adjY <= 0 || adjY > size) continue;

      if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

      const adjCell = gameMap[adjX][adjY];

      // 非我方且可移动
      if (
        adjCell.color !== myColor &&
        this.isPassable(adjCell, gameMap, adjX, adjY, size)
      ) {
        targetPositions.push({
          x: adjX,
          y: adjY,
          amount: adjCell.amount,
        });
      }
    }

    // 至少有2处可移动位置
    if (targetPositions.length < 2) {
      return null;
    }

    // 新的分兵条件: 当前格子兵力必须大于每个相邻非我方格子兵力的2倍
    let canSplit = true;
    for (const pos of targetPositions) {
      if (myCell.amount <= pos.amount * 2) {
        canSplit = false;
        break;
      }
    }

    // 统计总兵力，总兵力至少 5 倍（如果旁边有敌人的话）
    // const totalForce = targetPositions.reduce((sum, pos) => sum + pos.amount, 0);
    // const hasEnemy = this.isEdgeCellWithEnemy(gameMap, x, y, myColor, size);

    // if (myCell.amount < totalForce * 3 && hasEnemy) {
    //     canSplit = false;
    // }

    if (canSplit) {
      // 检查是否为小地图或皇冠距离过近
      const useSimplifiedStrategy = this.isSmallMapOrCloseCompetition(
        gameMap,
        myColor,
        size
      );

      let priorityTargets;
      if (useSimplifiedStrategy) {
        // 小地图或皇冠距离过近：关闭isSafeToAttackEnemyEmpty，使用bot3的兵力优先级
        priorityTargets = targetPositions.map((pos) => ({
          ...pos,
          priority: this.getAttackPriorityBot3Style(
            gameMap,
            pos.x,
            pos.y,
            gameMap[pos.x][pos.y],
            myColor,
            size
          ),
        }));
      } else {
        // 正常情况：使用安全检查和bot4的战线推进优先级
        priorityTargets = targetPositions
          .filter((pos) =>
            this.isSafeToAttackEnemyEmpty(
              gameMap,
              x,
              y,
              pos.x,
              pos.y,
              myColor,
              size
            )
          )
          .map((pos) => ({
            ...pos,
            priority: this.getAttackPriority(
              gameMap,
              pos.x,
              pos.y,
              gameMap[pos.x][pos.y],
              myColor,
              size
            ),
          }));

        // 如果过滤后没有安全的目标，取消分兵
        if (priorityTargets.length === 0) {
          return null;
        }
      }

      // 按战线推进优先级排序
      priorityTargets.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority; // 优先级升序（数字越小优先级越高）
        }

        // 同优先级时，按我方控制力排序
        const controlA = this.calculateMyControlInRange(
          gameMap,
          a.x,
          a.y,
          myColor,
          size
        );
        const controlB = this.calculateMyControlInRange(
          gameMap,
          b.x,
          b.y,
          myColor,
          size
        );
        if (controlA !== controlB) {
          return controlB - controlA; // 控制力降序（控制力越大越好）
        }

        // 控制力也相同时，优先攻击兵力少的目标
        return a.amount - b.amount;
      });

      const bestTarget = priorityTargets[0];

      return {
        fromX: x,
        fromY: y,
        toX: bestTarget.x,
        toY: bestTarget.y,
        half: true, // 分兵
      };
    }

    return null;
  }

  /**
   * 计算目标格子周围BFS距离小于3范围内的兵力优势
   * @param {Array} gameMap 游戏地图
   * @param {number} targetX 目标格子X坐标
   * @param {number} targetY 目标格子Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 兵力优势值（正数表示我方优势，负数表示敌方优势）
   */
  calculateForceAdvantage(gameMap, targetX, targetY, myColor, size) {
    const visited = new Set();
    const queue = [{ x: targetX, y: targetY, distance: 0 }];
    visited.add(`${targetX},${targetY}`);

    let myForce = 0;
    let enemyForce = 0;

    while (queue.length > 0) {
      const current = queue.shift();

      // 只计算距离小于3的格子
      if (current.distance >= 3) continue;

      // 计算当前格子的兵力贡献
      if (gameMap[current.x] && gameMap[current.x][current.y]) {
        const cell = gameMap[current.x][current.y];
        if (this.isPassable(cell, gameMap, current.x, current.y, size)) {
          if (cell.color === myColor) {
            myForce += cell.amount * 0.5;
          } else if (cell.color !== 0) {
            enemyForce += cell.amount;
          }
        }
      }

      // 继续BFS搜索
      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const nextCell = gameMap[nextX][nextY];
        if (!this.isPassable(nextCell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);
        queue.push({ x: nextX, y: nextY, distance: current.distance + 1 });
      }
    }

    // 返回兵力优势（我方兵力 - 敌方兵力）
    return myForce - enemyForce;
  }

  /**
   * 计算目标周围距离小于3的格子中我方格子的数量
   * @param {Array} gameMap 游戏地图
   * @param {number} targetX 目标格子X坐标
   * @param {number} targetY 目标格子Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 我方格子数量
   */
  calculateMyControlInRange(gameMap, targetX, targetY, myColor, size) {
    const visited = new Set();
    const queue = [{ x: targetX, y: targetY, distance: 0 }];
    visited.add(`${targetX},${targetY}`);

    let myControlCount = 0;

    while (queue.length > 0) {
      const current = queue.shift();

      // 只计算距离小于3的格子
      if (current.distance >= 3) continue;

      // 计算当前格子的控制贡献
      if (gameMap[current.x] && gameMap[current.x][current.y]) {
        const cell = gameMap[current.x][current.y];
        if (this.isPassable(cell, gameMap, current.x, current.y, size)) {
          if (cell.color === myColor) {
            myControlCount++;
          } else if (cell.color !== 0) {
            myControlCount--;
          }
        }
      }

      // 继续BFS搜索
      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const nextCell = gameMap[nextX][nextY];
        if (!this.isPassable(nextCell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);
        queue.push({ x: nextX, y: nextY, distance: current.distance + 1 });
      }
    }

    return myControlCount;
  }

  /**
   * 获取目标的攻击优先级（基于战线推进）
   * @param {Array} gameMap 游戏地图
   * @param {number} targetX 目标格子X坐标
   * @param {number} targetY 目标格子Y坐标
   * @param {Object} targetCell 目标格子
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 优先级数字，越小优先级越高
   */
  getAttackPriority(gameMap, targetX, targetY, targetCell, myColor, size) {
    // 计算目标周围我方控制力
    const myControlCount = this.calculateMyControlInRange(
      gameMap,
      targetX,
      targetY,
      myColor,
      size
    );

    // 基于战线推进的优先级计算：我方格子越多，优先级越高（数字越小）
    let basePriority;
    if (targetCell.color !== 0 && targetCell.color !== myColor) {
      // 敌方占领的格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        // 敌方城市：基础优先级1-5
        basePriority = Math.max(1, 6 - Math.floor(myControlCount / 2));
      } else {
        // 敌方空地：基础优先级6-10
        basePriority = Math.max(6, 11 - Math.floor(myControlCount / 2));
      }
    } else if (targetCell.color === 0) {
      // 中立格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        // 中立城市：基础优先级11-15
        basePriority = Math.max(11, 16 - Math.floor(myControlCount / 2));
      } else {
        // 中立空地：基础优先级16-20
        basePriority = Math.max(16, 21 - Math.floor(myControlCount / 2));
      }
    } else {
      basePriority = 99;
    }

    // 前100回合规则：敌人领地优先级永远高于中立领地
    if (this.roundCount <= 100 && targetCell.color === 0) {
      // 中立格子在前100回合时优先级降低，确保敌人领地优先级更高
      basePriority += 20; // 将中立格子优先级大幅降低
    }

    // 皇冠距离加成：距离皇冠4格以内的位置获得额外优先级
    const crownDistance = this.getCrownDistance(targetX, targetY);
    let crownBonus = 0;
    if (crownDistance <= 4) {
      // 距离越近，加成越大（优先级数字越小）
      // 距离1: -3, 距离2: -2, 距离3: -1, 距离4: -0.5
      crownBonus = Math.max(0.5, 4 - crownDistance);
    }

    const finalPriority = Math.max(1, basePriority - crownBonus);

    // 调试输出（可选）
    if (false) {
      // 可以设置为true来查看战线推进计算
    }

    return finalPriority;
  }

  /**
   * 获取目标类型的可读名称
   * @param {Object} targetCell 目标格子
   * @param {number} myColor 我方颜色
   * @returns {string} 目标类型名称
   */
  getTargetTypeName(targetCell, myColor) {
    if (targetCell.color !== 0 && targetCell.color !== myColor) {
      // 敌方占领的格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        return "敌人城市";
      } else {
        return "敌人空地";
      }
    } else if (targetCell.color === 0) {
      // 中立格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        return "天然城市";
      } else {
        return "天然空地";
      }
    }
    return "未知目标";
  }

  /**
   * 检查攻击敌方空地是否安全（不会被敌方城市反击）
   * @param {Array} gameMap 游戏地图
   * @param {number} fromX 攻击方X坐标
   * @param {number} fromY 攻击方Y坐标
   * @param {number} targetX 目标X坐标
   * @param {number} targetY 目标Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否安全攻击
   */
  isSafeToAttackEnemyEmpty(
    gameMap,
    fromX,
    fromY,
    targetX,
    targetY,
    myColor,
    size
  ) {
    const myCell = gameMap[fromX][fromY];
    const targetCell = gameMap[targetX][targetY];

    // 只对敌方空地进行此检查（敌方占领的空地，type=0）
    if (
      targetCell.color === 0 ||
      targetCell.color === myColor ||
      targetCell.type === 1 ||
      targetCell.type === 2 /* || targetCell.type === 3 */
    ) {
      return true; // 不是敌方空地，跳过检查
    }

    // 计算攻击后剩余的兵力
    const remainingForce = myCell.amount - 1 - targetCell.amount;
    if (remainingForce <= 0) {
      return false; // 攻击失败，不安全
    }

    // 检查目标位置周围是否有敌方城市能够反击
    for (let dir of this.directions) {
      const adjX = targetX + dir.dx;
      const adjY = targetY + dir.dy;

      if (adjX <= 0 || adjX > size || adjY <= 0 || adjY > size) continue;
      if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

      const adjCell = gameMap[adjX][adjY];

      // 检查是否是敌方城市且能反击

      // 为了暴露皇冠，去打敌方城市
      if (adjCell.type === 1) {
        return true;
      }

      if (
        adjCell.color !== 0 &&
        adjCell.color !== myColor /* && 
                (adjCell.type === 2 || adjCell.type === 3) */ &&
        adjCell.amount >= remainingForce + 1
      ) {
        if (false) {
          // 调试输出
        }
        return false; // 不安全，敌方城市可以反击
      }
    }

    return true; // 安全攻击
  }

  /**
   * 收集边缘格的所有可攻击目标并按优先级排序
   * @param {Array} gameMap 游戏地图
   * @param {number} x 边缘格X坐标
   * @param {number} y 边缘格Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Array} 按优先级排序的攻击目标列表
   */
  getAttackTargets(gameMap, x, y, myColor, size) {
    const myCell = gameMap[x][y];
    const targets = [];

    // 检查是否为小地图或皇冠距离过近
    const useSimplifiedStrategy = this.isSmallMapOrCloseCompetition(
      gameMap,
      myColor,
      size
    );

    for (let dir of this.directions) {
      const targetX = x + dir.dx;
      const targetY = y + dir.dy;

      if (targetX <= 0 || targetX > size || targetY <= 0 || targetY > size)
        continue;

      if (!gameMap[targetX] || !gameMap[targetX][targetY]) continue;

      const targetCell = gameMap[targetX][targetY];

      // 检查是否是合法攻击目标
      if (
        targetCell.color !== myColor &&
        this.isPassable(targetCell, gameMap, targetX, targetY, size)
      ) {
        // 计算攻击所需的最低兵力
        let requiredForce;
        if (targetCell.amount === 0) {
          // 空白城市需要10兵力攻击 + 1兵力留守原位置 = 11兵力（不考虑新位置留守，因为这是攻击判断）
          requiredForce = 11;
        } else {
          // 有兵力的格子：需要超过目标兵力 + 1兵力留守原位置
          requiredForce = targetCell.amount + 2;
        }

        if (myCell.amount >= requiredForce) {
          // 根据策略决定是否进行安全检查
          const isSafeToAttack =
            useSimplifiedStrategy ||
            this.isSafeToAttackEnemyEmpty(
              gameMap,
              x,
              y,
              targetX,
              targetY,
              myColor,
              size
            );

          if (isSafeToAttack) {
            const priority = useSimplifiedStrategy
              ? this.getAttackPriorityBot3Style(
                  gameMap,
                  targetX,
                  targetY,
                  targetCell,
                  myColor,
                  size
                )
              : this.getAttackPriority(
                  gameMap,
                  targetX,
                  targetY,
                  targetCell,
                  myColor,
                  size
                );

            targets.push({
              x: targetX,
              y: targetY,
              cell: targetCell,
              priority: priority,
            });
          }
        } // 结束兵力检查的if块
      }
    }

    // 按战线推进优先级排序
    targets.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // 优先级升序（数字越小优先级越高）
      }

      // 同优先级时，按我方控制力排序
      const controlA = this.calculateMyControlInRange(
        gameMap,
        a.x,
        a.y,
        myColor,
        size
      );
      const controlB = this.calculateMyControlInRange(
        gameMap,
        b.x,
        b.y,
        myColor,
        size
      );
      if (controlA !== controlB) {
        return controlB - controlA; // 控制力降序（控制力越大越好）
      }

      // 控制力也相同时，优先攻击兵力少的目标（更容易成功）
      return a.cell.amount - b.cell.amount;
    });

    return targets;
  }

  /**
   * 检查并更新强制移动标志
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   */
  updateForceMoveFlag(gameMap, myColor, size) {
    this.roundCount++;

    // 每500回合检查一次
    if (false && this.roundCount % 500 === 0) {

      // 找到我方最大兵力的格子
      let maxCell = null;
      let maxAmount = 0;

      for (let i = 1; i <= size; i++) {
        if (!gameMap[i]) continue;
        for (let j = 1; j <= size; j++) {
          if (!gameMap[i][j] || gameMap[i][j].color !== myColor) continue;

          if (gameMap[i][j].amount > maxAmount) {
            maxAmount = gameMap[i][j].amount;
            maxCell = { x: i, y: j, amount: maxAmount };
          }
        }
      }

      if (maxCell) {
        // 检查最大兵力格子是否已经是边缘
        if (
          this.isEdgeCellWithEnemy(gameMap, maxCell.x, maxCell.y, myColor, size)
        ) {
          this.forceMoveFlag = false;
        } else {
          this.forceMoveFlag = true;
        }
      }
    }
  }

  /**
   * 计算扩张到指定位置的收益值
   * @param {Array} gameMap 游戏地图
   * @param {number} toX 目标X坐标
   * @param {number} toY 目标Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @param {number} searchDepth 搜索深度
   * @returns {number} 扩张收益值
   */
  calculateExpansionValue(gameMap, toX, toY, myColor, size, searchDepth = 30) {
    let value = 0;
    const visited = new Set();
    const queue = [{ x: toX, y: toY, depth: 0 }];
    visited.add(`${toX},${toY}`);

    // 基础价值：目标位置本身的价值
    if (gameMap[toX] && gameMap[toX][toY]) {
      const targetCell = gameMap[toX][toY];
      if (targetCell.color === 0) {
        // 中立格子
        if (targetCell.type === 2 || targetCell.type === 3) {
          // 早期游戏更重视城市，后期重视空地扩张
          value += this.roundCount <= 200 ? 60 : 40; // 中立城市价值
        } else {
          value += this.roundCount <= 200 ? 8 : 15; // 中立空地价值
        }
        // 扣除攻击成本
        value -= targetCell.amount * 2;
      }
    }

    // BFS搜索周围可到达的有价值区域
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth >= searchDepth) continue;

      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const cell = gameMap[nextX][nextY];
        if (!this.isPassable(cell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);

        // 计算这个位置的价值
        let cellValue = 0;
        if (cell.color === 0) {
          // 中立格子
          if (cell.type === 2 || cell.type === 3) {
            // 中立城市价值，考虑距离和游戏阶段
            cellValue =
              (this.roundCount <= 200 ? 35 : 25) / (current.depth + 1);
          } else {
            // 中立空地价值
            cellValue = (this.roundCount <= 200 ? 4 : 8) / (current.depth + 1);
          }
          // 扣除攻击成本
          cellValue -= cell.amount / (current.depth + 1);
        } else if (cell.color !== myColor) {
          // 敌方格子
          // 发现敌人有战略价值，但不要直接攻击（应该由攻击规则处理）
          cellValue = 15 / (current.depth + 1);
        }

        value += cellValue;

        // 如果还没达到搜索深度，继续探索
        if (current.depth + 1 < searchDepth) {
          queue.push({ x: nextX, y: nextY, depth: current.depth + 1 });
        }
      }
    }

    // 皇冠距离修正：离皇冠越近价值越高
    const crownDistance = this.getCrownDistance(toX, toY);
    if (crownDistance !== Infinity) {
      // 早期游戏更重视离皇冠近，后期更重视扩张范围
      const distanceBonus =
        this.roundCount <= 200
          ? Math.max(0, 25 - crownDistance * 1.5)
          : Math.max(0, 15 - crownDistance);
      value += distanceBonus;
    }

    // 边界奖励：靠近地图边缘的位置有额外价值（有利于扩张）
    // const edgeDistance = Math.min(toX - 1, size - toX, toY - 1, size - toY);
    // if (edgeDistance <= 3) {
    //     value += (4 - edgeDistance) * 3; // 离边缘越近价值越高
    // }

    return value;
  }

  /**
   * 检查扩张方向是否能看到敌人
   * @param {Array} gameMap 游戏地图
   * @param {number} fromX 起始X坐标
   * @param {number} fromY 起始Y坐标
   * @param {number} dirIndex 方向索引
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否能看到敌人
   */
  canSeeEnemyInDirection(gameMap, fromX, fromY, dirIndex, myColor, size) {
    const dir = this.directions[dirIndex];
    const toX = fromX + dir.dx;
    const toY = fromY + dir.dy;

    if (toX <= 0 || toX > size || toY <= 0 || toY > size) return false;
    if (!gameMap[toX] || !gameMap[toX][toY]) return false;
    if (!this.isPassable(gameMap[toX][toY], gameMap, toX, toY, size))
      return false;

    // 检查目标位置周围是否有敌人
    for (let checkDir of this.directions) {
      const checkX = toX + checkDir.dx;
      const checkY = toY + checkDir.dy;

      if (checkX <= 0 || checkX > size || checkY <= 0 || checkY > size)
        continue;
      if (!gameMap[checkX] || !gameMap[checkX][checkY]) continue;

      const checkCell = gameMap[checkX][checkY];
      if (checkCell.color !== 0 && checkCell.color !== myColor) {
        return true; // 发现敌人
      }
    }

    return false;
  }

  /**
   * 检测敌人是否威胁皇冠区域
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @param {number} threatDistance 威胁距离阈值（默认6格）
   * @returns {boolean} 是否存在威胁
   */
  detectEnemyThreatNearCrown(gameMap, myColor, size, threatDistance = 6) {
    // 找到所有我方皇冠
    const myCrowns = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;
        if (gameMap[i][j].type === 1 && gameMap[i][j].color === myColor) {
          myCrowns.push({ x: i, y: j });
        }
      }
    }

    // 检查每个皇冠周围是否有敌人威胁
    for (const crown of myCrowns) {
      let threatLevel = 0;

      for (
        let i = Math.max(1, crown.x - threatDistance);
        i <= Math.min(size, crown.x + threatDistance);
        i++
      ) {
        if (!gameMap[i]) continue;
        for (
          let j = Math.max(1, crown.y - threatDistance);
          j <= Math.min(size, crown.y + threatDistance);
          j++
        ) {
          if (!gameMap[i][j]) continue;

          const cell = gameMap[i][j];
          // 检查是否是敌人格子（非中立、非我方）
          if (cell.color !== 0 && cell.color !== myColor) {
            const distance = Math.abs(i - crown.x) + Math.abs(j - crown.y);
            if (distance <= threatDistance) {
              // 距离越近威胁越大，兵力越多威胁越大
              const distanceThreat = (threatDistance - distance + 1) * 2;
              const forceThreat = Math.min(cell.amount, 10); // 兵力威胁上限10
              threatLevel += distanceThreat + forceThreat;
            }
          }
        }
      }

      // 威胁值超过阈值时认为存在威胁，降低阈值使防御更敏感
      if (threatLevel >= 12) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取皇冠附近的防御性扩张移动
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 防御性扩张移动或null
   */
  getDefensiveExpansionNearCrown(gameMap, myColor, size) {
    const possibleMoves = this.getAllPossibleExpansionMoves(
      gameMap,
      myColor,
      size
    );
    if (possibleMoves.length === 0) return null;

    // 只考虑离皇冠较近的扩张移动
    const defensiveMoves = [];
    for (const move of possibleMoves) {
      const crownDistance = this.getCrownDistance(move.toX, move.toY);

      // 只考虑距离皇冠5格以内的扩张
      if (crownDistance <= 5) {
        // 确保目标是中立格子（不攻击敌人）
        const targetCell = gameMap[move.toX][move.toY];
        if (targetCell.color === 0) {
          const expansionValue = this.calculateSimpleExpansionValue(
            gameMap,
            move.toX,
            move.toY,
            myColor,
            size
          );

          defensiveMoves.push({
            ...move,
            value: expansionValue,
            crownDistance: crownDistance,
          });
        }
      }
    }

    if (defensiveMoves.length === 0) return null;

    // 按皇冠距离和价值排序：距离越近优先级越高，同距离时价值越高优先级越高
    defensiveMoves.sort((a, b) => {
      if (a.crownDistance !== b.crownDistance) {
        return a.crownDistance - b.crownDistance; // 距离近的优先
      }
      return b.value - a.value; // 价值高的优先
    });

    return defensiveMoves[0];
  }

  /**
   * 获取最佳扩张移动（使用状态模拟）
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 最佳扩张移动或null
   */
  getBestExpansionMove(gameMap, myColor, size) {
    // 获取所有可能的扩张移动
    const possibleMoves = this.getAllPossibleExpansionMoves(
      gameMap,
      myColor,
      size
    );

    if (possibleMoves.length === 0) return null;

    // 为每个移动计算扩张价值
    const evaluatedMoves = [];

    for (const move of possibleMoves) {
      // 检查这个方向是否看不到敌人（符合用户需求）
      const dirIndex = this.directions.findIndex(
        (dir) =>
          move.fromX + dir.dx === move.toX && move.fromY + dir.dy === move.toY
      );

      if (dirIndex !== -1) {
        const hasEnemyInDirection = this.canSeeEnemyInDirection(
          gameMap,
          move.fromX,
          move.fromY,
          dirIndex,
          myColor,
          size
        );

        // 如果这个方向能看到敌人，跳过（因为应该由攻击规则处理）
        if (hasEnemyInDirection) continue;
      }

      // 使用状态模拟计算扩张价值
      const expansionValue = this.calculateExpansionValue(
        gameMap,
        move.toX,
        move.toY,
        myColor,
        size,
        3
      );

      // 如果价值过低，跳过
      if (expansionValue <= 0) continue;

      evaluatedMoves.push({
        ...move,
        value: expansionValue,
      });
    }

    // 如果没有有价值的扩张移动，返回null
    if (evaluatedMoves.length === 0) return null;

    // 按价值排序，选择最佳扩张移动
    evaluatedMoves.sort((a, b) => {
      if (Math.abs(a.value - b.value) < 10) {
        // 价值相近时，优先选择离皇冠距离更近的
        const distanceA = this.getCrownDistance(a.toX, a.toY);
        const distanceB = this.getCrownDistance(b.toX, b.toY);
        if (distanceA !== distanceB) {
          return distanceA - distanceB;
        }
        // 距离也相近时，优先选择半兵移动（保守策略）
        if (a.half !== b.half) {
          return a.half ? -1 : 1;
        }
      }
      return b.value - a.value; // 价值降序
    });

    const bestMove = evaluatedMoves[0];

    // 调试输出（可选）
    if (false) {
      // 设置为true查看扩张决策
      const fromCell = gameMap[bestMove.fromX][bestMove.fromY];
      const targetCell = gameMap[bestMove.toX][bestMove.toY];
    }

    return {
      fromX: bestMove.fromX,
      fromY: bestMove.fromY,
      toX: bestMove.toX,
      toY: bestMove.toY,
      half: bestMove.half,
    };
  }

  /**
   * 获取最佳移动
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 移动指令或null
   */
  getBestMove(gameMap, myColor, size) {
    // 更新回合计数
    this.roundCount++;

    // 初始化皇冠距离地图（只在第一次调用时执行）
    this.initializeCrownDistanceMap(gameMap, size, myColor);

    // 更新视野信息
    this.updateVision(gameMap, myColor, size);

    // 更新强制移动标志
    this.updateForceMoveFlag(gameMap, myColor, size);

    // 规则0: 检查是否可以攻击敌方皇冠（最高优先级）
    const crownAttack = this.checkEnemyCrownAttack(gameMap, myColor, size);
    if (crownAttack) {
      return {
        fromX: crownAttack.fromX,
        fromY: crownAttack.fromY,
        toX: crownAttack.toX,
        toY: crownAttack.toY,
        half: false,
      };
    }

    // 规则0.5: 检查是否可以快速集兵攻击敌人皇冠
    const fastCrownAttack = this.checkFastCrownAttack(gameMap, myColor, size);
    if (fastCrownAttack) {
      return fastCrownAttack;
    }

    // 新增规则0.8: 根据连续敌人移动方向检测威胁并触发守家
    const emergencyDefense = this.handleEnemyMovementThreat(
      gameMap,
      myColor,
      size
    );
    if (this.debugDefense && emergencyDefense) {
    }
    if (emergencyDefense) {
      return emergencyDefense;
    }

    // 规则1: 使用优先级系统找到最佳攻击移动（如果强制移动未激活）

    // 如果强制移动激活，检查最大兵力格子是否在边缘
    if (this.forceMoveFlag) {
      // 找到当前最大兵力的格子
      let maxCell = null;
      let maxAmount = 0;

      for (let i = 1; i <= size; i++) {
        if (!gameMap[i]) continue;
        for (let j = 1; j <= size; j++) {
          if (!gameMap[i][j] || gameMap[i][j].color !== myColor) continue;

          if (gameMap[i][j].amount > maxAmount) {
            maxAmount = gameMap[i][j].amount;
            maxCell = { x: i, y: j, amount: maxAmount };
          }
        }
      }

      if (maxCell) {
        if (!this.isEdgeCell(gameMap, maxCell.x, maxCell.y, myColor, size)) {
          // 跳过规则1，直接执行规则2
        } else {
          // 最大兵力格子已在边缘，取消强制移动
          this.forceMoveFlag = false;
        }
      }
    }

    // 只有在强制移动未激活时才执行规则1
    if (!this.forceMoveFlag) {
      // 收集所有可攻击的边缘格子
      const edgeAttacks = [];

      for (let i = 1; i <= size; i++) {
        if (!gameMap[i]) continue;
        for (let j = 1; j <= size; j++) {
          if (!gameMap[i][j]) continue;

          const myCell = gameMap[i][j];
          if (myCell.color !== myColor || myCell.amount <= 1) continue;

          // 获取这个格子的所有攻击目标
          const targets = this.getAttackTargets(gameMap, i, j, myColor, size);

          if (targets.length > 0) {
            // 检查是否应该分兵（如果当前位置是边缘且满足分兵条件）
            const splitMove = this.checkSplitMove(gameMap, i, j, myColor, size);
            if (splitMove) {
              return splitMove;
            }

            // 添加到边缘攻击列表，使用最高优先级目标
            const bestTarget = targets[0]; // 已经按优先级排序
            edgeAttacks.push({
              fromX: i,
              fromY: j,
              toX: bestTarget.x,
              toY: bestTarget.y,
              priority: bestTarget.priority,
              targetType: this.getTargetTypeName(bestTarget.cell, myColor),
            });
          }
        }
      }

      // 如果有攻击目标，选择优先级最高的
      if (edgeAttacks.length > 0) {
        // 按优先级排序，同优先级按皇冠距离排序
        edgeAttacks.sort((a, b) => {
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          // 同优先级时，优先选择离皇冠距离更近的
          const distanceA = this.getCrownDistance(a.toX, a.toY);
          const distanceB = this.getCrownDistance(b.toX, b.toY);
          if (distanceA !== distanceB) {
            return distanceA - distanceB;
          }
          return Math.random() - 0.5;
        });

        const bestAttack = edgeAttacks[0];

        return {
          fromX: bestAttack.fromX,
          fromY: bestAttack.fromY,
          toX: bestAttack.toX,
          toY: bestAttack.toY,
          half: false,
        };
      }
    } // 结束规则1的if (!this.forceMoveFlag)块

    // 规则1.3: 检测敌人威胁，如果有威胁且仍有中立格子，优先在皇冠附近防御性扩张
    if (!this.forceMoveFlag) {
      const isUnderThreat = this.detectEnemyThreatNearCrown(
        gameMap,
        myColor,
        size
      );
      if (isUnderThreat) {
        const defensiveMove = this.getDefensiveExpansionNearCrown(
          gameMap,
          myColor,
          size
        );
        if (defensiveMove) {
          if (false) {
            // 可以设置为true来查看防御扩张日志
          }
          return defensiveMove;
        }
      }
    }

    // 规则1.5: 智能扩张策略 - 在没有敌人可攻击时，计算最佳扩张方向
    if (!this.forceMoveFlag) {
      const expansionMove = this.getBestExpansionMove(gameMap, myColor, size);
      if (expansionMove) {
        if (false) {
          // 可以设置为true来查看扩张日志
        }
        return expansionMove;
      }
    }

    // 规则2: 使用动态规划寻找最优Fx值的格子进行移动
    const bestMove = this.findBestMoveByFxValue(gameMap, myColor, size);
    if (bestMove) {
      return bestMove;
    }

    // 如果新算法没有找到合适的移动，回退到原始算法作为备选

    // 找到所有我方格子并按兵力排序
    const myCells = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;

        const cell = gameMap[i][j];
        if (cell.color === myColor && cell.amount > 1) {
          myCells.push({ x: i, y: j, amount: cell.amount });
        }
      }
    }

    if (myCells.length === 0) return null;

    // 按兵力从大到小排序
    myCells.sort((a, b) => b.amount - a.amount);

    // 从最大兵力开始，找第一个不是边缘的格子
    for (let i = 0; i < myCells.length; i++) {
      const cell = myCells[i];

      // 检查这个格子是否是边缘
      if (
        !this.isEdgeCell(gameMap, cell.x, cell.y, myColor, size) ||
        (this.forceMoveFlag &&
          !this.isEdgeCellWithEnemy(gameMap, cell.x, cell.y, myColor, size))
      ) {
        // 不是边缘，让它BFS搜索到最近的边缘
        // 如果强制移动激活，优先选择与敌人相邻的边缘格子
        const moveToEdge = this.findPathToNearestEdge(
          gameMap,
          cell,
          myColor,
          size,
          this.forceMoveFlag
        );

        if (moveToEdge) {
          return moveToEdge;
        }
      }
    }

    return null;
  }

  /**
   * 从敌人皇冠反向搜索到我方领地的攻击路径
   * @param {Array} gameMap 游戏地图
   * @param {number} crownX 敌人皇冠X坐标
   * @param {number} crownY 敌人皇冠Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 攻击路径信息或null
   */
  findAttackPathFromCrown(gameMap, crownX, crownY, myColor, size) {
    const visited = new Set();
    const queue = [{ x: crownX, y: crownY, path: [{ x: crownX, y: crownY }] }];
    visited.add(`${crownX},${crownY}`);

    while (queue.length > 0) {
      const current = queue.shift();

      // 探索四个方向
      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const nextCell = gameMap[nextX][nextY];
        if (!this.isPassable(nextCell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);
        const newPath = [...current.path, { x: nextX, y: nextY }];

        // 如果到达我方格子，检查这条路径是否可行
        if (nextCell.color === myColor) {
          // 计算路径信息
          const pathLength = newPath.length - 1; // 减去起点

          // 策略仅适用于路径长度小于30的情况
          if (pathLength >= 30) {
            continue;
          }

          const pathObstacleForce = this.calculatePathObstacleForce(
            gameMap,
            newPath,
            myColor
          );
          const pathMyForce = this.calculatePathMyForce(
            gameMap,
            newPath,
            myColor
          );

          // 判断条件：路径上我方兵力 > 路径阻挡兵力 * 1.2 + 路径长度
          const requiredForce = pathObstacleForce * 1.2 + pathLength;

          if (pathMyForce > requiredForce) {
            return {
              path: newPath,
              pathLength: pathLength,
              pathObstacleForce: pathObstacleForce,
              pathMyForce: pathMyForce,
              requiredForce: requiredForce,
              crownX: crownX,
              crownY: crownY,
            };
          }
        }

        // 继续搜索（限制搜索深度为30）
        if (newPath.length <= 30) {
          queue.push({ x: nextX, y: nextY, path: newPath });
        }
      }
    }

    return null;
  }

  /**
   * 计算路径上所有阻挡兵力（不包括我方）
   * @param {Array} gameMap 游戏地图
   * @param {Array} path 路径数组
   * @param {number} myColor 我方颜色
   * @returns {number} 路径阻挡兵力总和
   */
  calculatePathObstacleForce(gameMap, path, myColor) {
    let totalObstacleForce = 0;

    for (let pos of path) {
      if (gameMap[pos.x] && gameMap[pos.x][pos.y]) {
        const cell = gameMap[pos.x][pos.y];
        // 计算所有非我方格子的兵力（包括敌方和中立）
        if (cell.color !== myColor) {
          totalObstacleForce += cell.amount;
        }
      }
    }

    return totalObstacleForce;
  }

  /**
   * 计算路径上我方兵力总和
   * @param {Array} gameMap 游戏地图
   * @param {Array} path 路径数组
   * @param {number} myColor 我方颜色
   * @returns {number} 路径上我方兵力总和
   */
  calculatePathMyForce(gameMap, path, myColor) {
    let totalMyForce = 0;

    for (let pos of path) {
      if (gameMap[pos.x] && gameMap[pos.x][pos.y]) {
        const cell = gameMap[pos.x][pos.y];
        if (cell.color === myColor && cell.amount > 1) {
          totalMyForce += cell.amount - 1; // 保留1兵力守家
        }
      }
    }

    return totalMyForce;
  }

  /**
   * 检查是否可以进行快速攻击敌人皇冠（仅适用于路径长度<30）
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Object|null} 快速攻击指令或null
   */
  checkFastCrownAttack(gameMap, myColor, size) {
    // 只搜索已知的敌人皇冠（避免开挂）
    if (this.knownCrowns.length === 0) return null;

    const enemyCrowns = this.knownCrowns;

    // 对每个敌人皇冠从其位置开始反向搜索攻击路径
    for (let crown of enemyCrowns) {
      const pathInfo = this.findAttackPathFromCrown(
        gameMap,
        crown.x,
        crown.y,
        myColor,
        size
      );
      if (!pathInfo) continue;

      // 找到可行路径！现在寻找路径上离敌人皇冠最近的我方格子开始推进
      const path = pathInfo.path;

      // 从路径终点（我方领地）开始，找到第一个我方格子
      for (let i = path.length - 1; i >= 1; i--) {
        const pos = path[i];
        if (
          gameMap[pos.x] &&
          gameMap[pos.x][pos.y] &&
          gameMap[pos.x][pos.y].color === myColor &&
          gameMap[pos.x][pos.y].amount > 1
        ) {
          // 找到下一步移动目标（向敌人皇冠方向）
          const nextPos = path[i - 1];

          if (false) {
            // 调试输出
            const crownType = crown.suspected ? "推测" : "已见";
          }

          return {
            fromX: pos.x,
            fromY: pos.y,
            toX: nextPos.x,
            toY: nextPos.y,
            half: false,
          };
        }
      }
    }

    return null;
  }

  /**
   * 简化版BFS计算每个格子的Fx值
   * Fx = 格子x到边界的最短路径上的所有兵力 / 格子x到边界的距离
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Map} 返回每个格子的Fx值和最佳路径信息
   */
  calculateOptimalFxValues(gameMap, myColor, size) {
    const cellInfo = new Map();
    const visited = new Set();

    // 使用多轮BFS，每轮扩散一层
    let currentLevel = [];
    let nextLevel = [];

    // 找到所有边缘格子作为第0层，并计算边缘敌方兵力
    const edgeEnemyForces = new Map(); // 记录每个边缘格子周围的敌方兵力

    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;

        const cell = gameMap[i][j];
        if (
          cell.color === myColor &&
          this.isEdgeCell(gameMap, i, j, myColor, size)
        ) {
          const key = `${i},${j}`;

          // 计算这个边缘格子周围的敌方兵力
          let maxEnemyForce = 0;
          for (let dir of this.directions) {
            const adjX = i + dir.dx;
            const adjY = j + dir.dy;

            if (adjX <= 0 || adjX > size || adjY <= 0 || adjY > size) continue;
            if (!gameMap[adjX] || !gameMap[adjX][adjY]) continue;

            const adjCell = gameMap[adjX][adjY];
            if (adjCell.color !== myColor && adjCell.color !== 0) {
              maxEnemyForce = Math.max(maxEnemyForce, adjCell.amount);
            }
          }

          edgeEnemyForces.set(key, maxEnemyForce);

          cellInfo.set(key, {
            distance: 0,
            totalForce: cell.amount,
            fx: Infinity, // 边缘格子不参与选择
            nextStep: null,
            maxEnemyForce: maxEnemyForce,
          });
          visited.add(key);
          currentLevel.push({
            x: i,
            y: j,
            distance: 0,
            totalForce: cell.amount,
            maxEnemyForce: maxEnemyForce,
          });
        }
      }
    }

    // 逐层扩散，最多扩散30层避免无限循环
    let distance = 1;
    while (currentLevel.length > 0 && distance <= 30) {
      nextLevel = [];

      for (const current of currentLevel) {
        // 探索四个方向的邻居
        for (let dir of this.directions) {
          const nextX = current.x + dir.dx;
          const nextY = current.y + dir.dy;
          const nextKey = `${nextX},${nextY}`;

          if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size)
            continue;
          if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
          if (visited.has(nextKey)) continue;

          const nextCell = gameMap[nextX][nextY];
          if (
            !this.isPassable(nextCell, gameMap, nextX, nextY, size) ||
            nextCell.color !== myColor
          )
            continue;

          const newTotalForce = current.totalForce + nextCell.amount;

          // 关键检查：如果路径总兵力达不到边缘敌方兵力，直接跳过
          // if (current.maxEnemyForce > 0 && newTotalForce <= current.maxEnemyForce) {
          //     continue; // 兵力不足，跳过这个路径
          // }

          // 修改fx计算公式：fx = (当前总兵力 - 边缘目的地兵力) / 路径长度
          const newFx = (newTotalForce - current.maxEnemyForce) / distance;

          cellInfo.set(nextKey, {
            distance: distance,
            totalForce: newTotalForce,
            fx: newFx,
            nextStep: { x: current.x, y: current.y },
            maxEnemyForce: current.maxEnemyForce,
          });

          visited.add(nextKey);
          nextLevel.push({
            x: nextX,
            y: nextY,
            distance: distance,
            totalForce: newTotalForce,
            maxEnemyForce: current.maxEnemyForce,
          });
        }
      }

      currentLevel = nextLevel;
      distance++;
    }

    return cellInfo;
  }

  /**
   * 改进的规则2：使用动态规划寻找最优Fx值的格子
   */
  findBestMoveByFxValue(gameMap, myColor, size) {
    // 计算所有格子的Fx值
    const cellFxInfo = this.calculateOptimalFxValues(gameMap, myColor, size);

    let bestCell = null;
    let bestFx = -1;

    // 遍历所有非边缘的我方格子，找到Fx值最大的
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;

        const cell = gameMap[i][j];
        if (cell.color === myColor && cell.amount > 1) {
          const key = `${i},${j}`;
          const fxInfo = cellFxInfo.get(key);

          // 跳过边缘格子（除非强制移动且该边缘格子不与敌人相邻）
          const isEdge = this.isEdgeCell(gameMap, i, j, myColor, size);
          if (
            isEdge &&
            !(
              this.forceMoveFlag &&
              !this.isEdgeCellWithEnemy(gameMap, i, j, myColor, size)
            )
          ) {
            continue;
          }

          if (fxInfo && fxInfo.fx > bestFx && fxInfo.nextStep) {
            // 检查总兵力是否至少是边缘敌方兵力的2倍
            if (
              fxInfo.maxEnemyForce > 0 &&
              fxInfo.totalForce < fxInfo.maxEnemyForce * 2
            ) {
              continue; // 兵力不足，跳过这个格子
            }

            bestFx = fxInfo.fx;
            bestCell = {
              x: i,
              y: j,
              amount: cell.amount,
              fx: fxInfo.fx,
              nextStep: fxInfo.nextStep,
              distance: fxInfo.distance,
              totalForce: fxInfo.totalForce,
            };
          }
        }
      }
    }

    // 如果找到了最佳格子，返回移动指令
    if (bestCell && bestCell.nextStep) {
      if (false) {
        // 设置为true查看调试信息
        const fxInfo = cellFxInfo.get(`${bestCell.x},${bestCell.y}`);
      }

      return {
        fromX: bestCell.x,
        fromY: bestCell.y,
        toX: bestCell.nextStep.x,
        toY: bestCell.nextStep.y,
        half: false,
      };
    }

    return null;
  }

  /**
   * 深拷贝地图状态
   * @param {Array} gameMap 原始地图
   * @param {number} size 地图大小
   * @returns {Array} 深拷贝的地图
   */
  deepCopyMap(gameMap, size) {
    const newMap = Array(size + 1)
      .fill(null)
      .map(() => Array(size + 1).fill(null));
    for (let i = 0; i <= size; i++) {
      for (let j = 0; j <= size; j++) {
        if (gameMap[i] && gameMap[i][j]) {
          newMap[i][j] = {
            color: gameMap[i][j].color,
            amount: gameMap[i][j].amount,
            type: gameMap[i][j].type,
          };
        }
      }
    }
    return newMap;
  }

  /**
   * 模拟一次移动操作
   * @param {Array} gameMap 游戏地图
   * @param {number} fromX 起始X坐标
   * @param {number} fromY 起始Y坐标
   * @param {number} toX 目标X坐标
   * @param {number} toY 目标Y坐标
   * @param {boolean} half 是否半兵移动
   * @param {number} size 地图大小
   * @returns {Array} 移动后的地图状态
   */
  simulateMove(gameMap, fromX, fromY, toX, toY, half, size) {
    const newMap = this.deepCopyMap(gameMap, size);
    const fromCell = newMap[fromX][fromY];
    const toCell = newMap[toX][toY];

    if (!fromCell || !toCell || fromCell.amount <= 1) {
      return newMap; // 无效移动
    }

    const moveAmount = half
      ? Math.floor(fromCell.amount / 2)
      : fromCell.amount - 1;

    if (toCell.color === fromCell.color) {
      // 同色合并
      toCell.amount += moveAmount;
      fromCell.amount -= moveAmount;
    } else {
      // 攻击
      const attackResult = moveAmount - toCell.amount;
      fromCell.amount -= moveAmount;

      if (attackResult > 0) {
        // 攻击成功
        if (toCell.type === 1) {
          // 攻下皇冠，该玩家所有领土变为攻击者的
          const conqueredColor = toCell.color;
          for (let i = 1; i <= size; i++) {
            for (let j = 1; j <= size; j++) {
              if (newMap[i][j] && newMap[i][j].color === conqueredColor) {
                newMap[i][j].color = fromCell.color;
                if (newMap[i][j].type === 1) {
                  newMap[i][j].type = 3; // 皇冠变城市
                }
              }
            }
          }
        }

        toCell.color = fromCell.color;
        toCell.amount = attackResult;

        // 根据原类型设置新类型
        if (toCell.type === 5) {
          toCell.type = 3; // 村庄变城市
        } else if (toCell.type !== 3 && toCell.type !== 1) {
          toCell.type = 2; // 其他变道路
        }
      } else {
        // 攻击失败
        toCell.amount = -attackResult;
      }
    }

    return newMap;
  }

  /**
   * 模拟回合结束时的兵力增长
   * @param {Array} gameMap 游戏地图
   * @param {number} size 地图大小
   * @param {number} currentRound 当前回合数
   * @returns {Array} 增长后的地图状态
   */
  simulateRoundGrowth(gameMap, size, currentRound) {
    const newMap = this.deepCopyMap(gameMap, size);

    // 检查地图类型（从[0][0]位置判断）
    const mapType = newMap[0][0] ? newMap[0][0].type : 1;

    if (mapType === 1 || mapType === 3 || mapType === 4) {
      // 每10回合道路+1
      if (currentRound % 10 === 0) {
        for (let i = 1; i <= size; i++) {
          for (let j = 1; j <= size; j++) {
            if (
              newMap[i][j] &&
              newMap[i][j].type === 2 &&
              newMap[i][j].color !== 0 &&
              newMap[i][j].amount > 0
            ) {
              newMap[i][j].amount++;
            }
          }
        }
      }

      // 每回合城市+1
      for (let i = 1; i <= size; i++) {
        for (let j = 1; j <= size; j++) {
          if (newMap[i][j] && newMap[i][j].type === 3) {
            newMap[i][j].amount++;
          }
        }
      }

      // 每回合皇冠+1
      for (let i = 1; i <= size; i++) {
        for (let j = 1; j <= size; j++) {
          if (newMap[i][j] && newMap[i][j].type === 1) {
            newMap[i][j].amount++;
          }
        }
      }
    }

    return newMap;
  }

  /**
   * 计算地图状态的总价值
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 地图状态价值
   */
  evaluateMapState(gameMap, myColor, size) {
    let totalValue = 0;
    let myTotalForce = 0;
    let myTerritoryCount = 0;
    let myCityCount = 0;
    let myCrownCount = 0;

    for (let i = 1; i <= size; i++) {
      for (let j = 1; j <= size; j++) {
        if (gameMap[i][j] && gameMap[i][j].color === myColor) {
          myTotalForce += gameMap[i][j].amount;
          myTerritoryCount++;

          if (gameMap[i][j].type === 1) {
            myCrownCount++;
            totalValue += 1000; // 皇冠价值极高
          } else if (gameMap[i][j].type === 3) {
            myCityCount++;
            totalValue += 50; // 城市价值高
          } else if (gameMap[i][j].type === 2) {
            totalValue += 10; // 道路基础价值
          } else {
            totalValue += 5; // 空地基础价值
          }
        }
      }
    }

    // 综合评分：兵力 + 领土数量 + 特殊建筑奖励
    totalValue += myTotalForce * 2;
    totalValue += myTerritoryCount * 3;
    totalValue += myCityCount * 20; // 城市额外奖励
    totalValue += myCrownCount * 500; // 皇冠额外奖励

    return totalValue;
  }

  /**
   * 获取所有可能的扩张移动
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {Array} 所有可能的扩张移动
   */
  getAllPossibleExpansionMoves(gameMap, myColor, size) {
    const moves = [];

    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;

        const myCell = gameMap[i][j];
        if (myCell.color !== myColor || myCell.amount <= 1) continue;

        // 只考虑边缘格子的扩张
        if (!this.isEdgeCell(gameMap, i, j, myColor, size)) continue;

        // 检查四个方向
        for (let dir of this.directions) {
          const toX = i + dir.dx;
          const toY = j + dir.dy;

          if (toX <= 0 || toX > size || toY <= 0 || toY > size) continue;
          if (!gameMap[toX] || !gameMap[toX][toY]) continue;

          const targetCell = gameMap[toX][toY];

          // 只考虑扩张到非我方的可通行格子
          if (
            targetCell.color === myColor ||
            !this.isPassable(targetCell, gameMap, toX, toY, size)
          )
            continue;

          // 检查是否有足够兵力攻击
          if (myCell.amount <= targetCell.amount + 2) continue;

          // 检查攻击是否安全
          if (
            !this.isSafeToAttackEnemyEmpty(
              gameMap,
              i,
              j,
              toX,
              toY,
              myColor,
              size
            )
          )
            continue;

          // 添加全兵移动
          moves.push({
            fromX: i,
            fromY: j,
            toX: toX,
            toY: toY,
            half: false,
          });

          // 如果兵力足够，添加半兵移动
          const halfForce = Math.floor(myCell.amount / 2);
          let halfRequiredForce;
          if (targetCell.amount === 0) {
            // 空白城市：半兵需要10兵力攻击 + 1兵力留守新位置 = 11兵力（原位置自动留下另一半）
            halfRequiredForce = 11;
          } else {
            // 有兵力的格子：半兵需要超过目标兵力 + 1兵力留守新位置
            halfRequiredForce = targetCell.amount + 2;
          }
          if (myCell.amount >= 6 && halfForce >= halfRequiredForce) {
            // 至少6兵才考虑半兵
            moves.push({
              fromX: i,
              fromY: j,
              toX: toX,
              toY: toY,
              half: true,
            });
          }
        }
      }
    }

    return moves;
  }

  /**
   * 计算扩张到指定位置的收益值（使用状态模拟）
   * @param {Array} gameMap 游戏地图
   * @param {number} toX 目标X坐标
   * @param {number} toY 目标Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @param {number} searchDepth 搜索深度（回合数）
   * @returns {number} 扩张收益值
   */
  calculateExpansionValue(gameMap, toX, toY, myColor, size, searchDepth = 20) {
    // 检查目标位置是否有效
    if (!gameMap[toX] || !gameMap[toX][toY]) return -Infinity;
    const targetCell = gameMap[toX][toY];

    // 只计算中立或敌方目标的价值
    if (targetCell.color === myColor) return -Infinity;

    // 首先检查是否能直接攻击目标
    let directAttackPossible = false;
    for (let dir of this.directions) {
      const fromX = toX - dir.dx;
      const fromY = toY - dir.dy;

      if (fromX <= 0 || fromX > size || fromY <= 0 || fromY > size) continue;
      if (!gameMap[fromX] || !gameMap[fromX][fromY]) continue;

      const fromCell = gameMap[fromX][fromY];
      if (fromCell.color === myColor) {
        // 计算攻击所需的最低兵力
        let requiredForce;
        if (targetCell.amount === 0) {
          // 空白城市需要10兵力攻击 + 1兵力留守原位置 = 11兵力
          requiredForce = 11;
        } else {
          // 有兵力的格子：需要超过目标兵力 + 1兵力留守原位置
          requiredForce = targetCell.amount + 2;
        }

        if (fromCell.amount >= requiredForce) {
          directAttackPossible = true;
          break;
        }
      }
    }

    // 如果不能直接攻击，使用简化的价值计算
    if (!directAttackPossible) {
      return this.calculateSimpleExpansionValue(
        gameMap,
        toX,
        toY,
        myColor,
        size
      );
    }

    // 计算初始状态价值
    const initialValue = this.evaluateMapState(gameMap, myColor, size);

    // 使用BFS模拟多步扩张
    const queue = [
      {
        mapState: gameMap,
        round: this.roundCount,
        depth: 0,
        totalValue: initialValue,
        path: [],
      },
    ];

    let bestFinalValue = initialValue;
    let maxDepth = searchDepth; // 限制最大搜索深度避免计算量过大
    let processedStates = 0;
    const maxProcessedStates = 10000; // 限制处理的状态数量

    while (queue.length > 0 && processedStates < maxProcessedStates) {
      // 限制队列大小和处理数量
      const current = queue.shift();
      processedStates++;

      if (current.depth >= maxDepth) {
        // 到达搜索深度，评估最终状态
        const finalValue = this.evaluateMapState(
          current.mapState,
          myColor,
          size
        );
        if (finalValue > bestFinalValue) {
          bestFinalValue = finalValue;
        }
        continue;
      }

      // 模拟回合增长
      const grownMap = this.simulateRoundGrowth(
        current.mapState,
        size,
        current.round + 1
      );

      // 获取所有可能的扩张移动
      const possibleMoves = this.getAllPossibleExpansionMoves(
        grownMap,
        myColor,
        size
      );

      if (possibleMoves.length === 0) {
        // 没有可能的移动，评估当前状态
        const finalValue = this.evaluateMapState(grownMap, myColor, size);
        if (finalValue > bestFinalValue) {
          bestFinalValue = finalValue;
        }
        continue;
      }

      // 限制每层探索的移动数量，选择最有希望的几个
      possibleMoves.sort((a, b) => {
        const aTarget = grownMap[a.toX][a.toY];
        const bTarget = grownMap[b.toX][b.toY];

        // 优先考虑攻击城市和价值高的目标
        let aScore = 0,
          bScore = 0;
        if (aTarget.type === 3) aScore += 50;
        if (aTarget.type === 1) aScore += 100;
        if (bTarget.type === 3) bScore += 50;
        if (bTarget.type === 1) bScore += 100;

        aScore -= aTarget.amount;
        bScore -= bTarget.amount;

        return bScore - aScore;
      });

      // 只探索前3个最优移动
      const topMoves = possibleMoves.slice(0, 3);

      for (const move of topMoves) {
        const newMapState = this.simulateMove(
          grownMap,
          move.fromX,
          move.fromY,
          move.toX,
          move.toY,
          move.half,
          size
        );
        const newValue = this.evaluateMapState(newMapState, myColor, size);

        queue.push({
          mapState: newMapState,
          round: current.round + 1,
          depth: current.depth + 1,
          totalValue: newValue,
          path: [...current.path, move],
        });
      }
    }

    // 返回收益值（最终价值 - 初始价值）
    const gainValue = bestFinalValue - initialValue;

    // 添加一些启发式修正
    let bonus = 0;

    if (targetCell.type === 3) bonus += 30; // 城市奖励
    if (targetCell.type === 1) bonus += 200; // 皇冠奖励
    if (targetCell.color !== 0) bonus += 20; // 攻击敌方奖励

    // 距离皇冠越近越好
    const crownDistance = this.getCrownDistance(toX, toY);
    if (crownDistance !== Infinity) {
      bonus += Math.max(0, 20 - crownDistance);
    }

    return gainValue + bonus;
  }

  /**
   * 简化的扩张价值计算（用于无法直接攻击的目标）
   * @param {Array} gameMap 游戏地图
   * @param {number} toX 目标X坐标
   * @param {number} toY 目标Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 扩张收益值
   */
  calculateSimpleExpansionValue(gameMap, toX, toY, myColor, size) {
    const targetCell = gameMap[toX][toY];
    let value = 0;

    // 基础价值：根据目标类型
    if (targetCell.color === 0) {
      // 中立格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        // 早期游戏更重视城市，后期重视空地扩张
        value += this.roundCount <= 200 ? 60 : 40; // 中立城市价值
      } else {
        value += this.roundCount <= 200 ? 8 : 15; // 中立空地价值
      }
      // 扣除攻击成本
      value -= targetCell.amount * 2;
    } else if (targetCell.color !== myColor) {
      // 敌方格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        value += 50; // 敌方城市价值
      } else {
        value += 20; // 敌方空地价值
      }
      value -= targetCell.amount * 1.5; // 攻击敌方成本更高
    }

    // BFS搜索周围可到达的有价值区域
    const visited = new Set();
    const queue = [{ x: toX, y: toY, depth: 0 }];
    visited.add(`${toX},${toY}`);
    const searchDepth = 15;

    while (queue.length > 0) {
      const current = queue.shift();
      if (current.depth >= searchDepth) continue;

      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const cell = gameMap[nextX][nextY];
        if (!this.isPassable(cell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);

        // 计算这个位置的价值
        let cellValue = 0;
        if (cell.color === 0) {
          // 中立格子
          if (cell.type === 2 || cell.type === 3) {
            // 中立城市价值，考虑距离和游戏阶段
            cellValue =
              (this.roundCount <= 200 ? 25 : 15) / (current.depth + 1);
          } else {
            // 中立空地价值
            cellValue = (this.roundCount <= 200 ? 3 : 6) / (current.depth + 1);
          }
          // 扣除攻击成本
          cellValue -= cell.amount / (current.depth + 2);
        } else if (cell.color !== myColor) {
          // 敌方格子
          // 发现敌人有战略价值
          cellValue = 10 / (current.depth + 1);
        }

        value += cellValue;

        // 如果还没达到搜索深度，继续探索
        if (current.depth + 1 < searchDepth) {
          queue.push({ x: nextX, y: nextY, depth: current.depth + 1 });
        }
      }
    }

    // 皇冠距离修正：离皇冠越近价值越高
    const crownDistance = this.getCrownDistance(toX, toY);
    if (crownDistance !== Infinity) {
      // 早期游戏更重视离皇冠近，后期更重视扩张范围
      const distanceBonus =
        this.roundCount <= 200
          ? Math.max(0, 25 - crownDistance * 1.5)
          : Math.max(0, 15 - crownDistance);
      value += distanceBonus;
    }

    // 到达目标的距离惩罚（通过BFS计算到最近我方格子的距离）
    const distanceToMyTerritory = this.calculateDistanceToMyTerritory(
      gameMap,
      toX,
      toY,
      myColor,
      size
    );
    if (distanceToMyTerritory > 1) {
      value -= (distanceToMyTerritory - 1) * 5; // 距离惩罚
    }

    return value;
  }

  /**
   * 计算目标位置到我方领土的最短距离
   * @param {Array} gameMap 游戏地图
   * @param {number} startX 起始X坐标
   * @param {number} startY 起始Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 到我方领土的最短距离
   */
  calculateDistanceToMyTerritory(gameMap, startX, startY, myColor, size) {
    const visited = new Set();
    const queue = [{ x: startX, y: startY, distance: 0 }];
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const current = queue.shift();

      // 如果到达我方领土，返回距离
      if (
        gameMap[current.x] &&
        gameMap[current.x][current.y] &&
        gameMap[current.x][current.y].color === myColor
      ) {
        return current.distance;
      }

      // 限制搜索距离
      if (current.distance >= 20) continue;

      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const cell = gameMap[nextX][nextY];
        if (!this.isPassable(cell, gameMap, nextX, nextY, size)) continue;

        visited.add(key);
        queue.push({ x: nextX, y: nextY, distance: current.distance + 1 });
      }
    }

    return Infinity; // 无法到达
  }

  /**
   * 检查是否为小地图或皇冠距离过近
   * @param {Array} gameMap 游戏地图
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {boolean} 是否应该使用简化攻击策略
   */
  isSmallMapOrCloseCompetition(gameMap, myColor, size) {
    // 小地图判断：地图大小小于等于25
    if (size <= 13) {
      return true;
    }

    // 找到自己的皇冠位置
    const myCrowns = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;
        if (gameMap[i][j].type === 1 && gameMap[i][j].color === myColor) {
          myCrowns.push({ x: i, y: j });
        }
      }
    }

    // 找到其他玩家的皇冠位置
    const otherCrowns = [];
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (!gameMap[i][j]) continue;
        if (
          gameMap[i][j].type === 1 &&
          gameMap[i][j].color !== 0 &&
          gameMap[i][j].color !== myColor
        ) {
          otherCrowns.push({ x: i, y: j });
        }
      }
    }

    // 计算最近的皇冠距离
    let minCrownDistance = Infinity;
    for (const myCrown of myCrowns) {
      for (const otherCrown of otherCrowns) {
        // 使用BFS计算路径距离而不是曼哈顿距离
        const distance = this.calculateDistanceToMyTerritory(
          gameMap,
          myCrown.x,
          myCrown.y,
          otherCrown.x,
          otherCrown.y,
          size
        );
        minCrownDistance = Math.min(minCrownDistance, distance);
      }
    }

    // 如果最近的皇冠距离小于18，使用简化策略
    if (minCrownDistance < 18) {
      return true;
    }

    return false;
  }

  /**
   * 计算目标格子周围的兵力优势（bot3风格）
   * @param {Array} gameMap 游戏地图
   * @param {number} targetX 目标格子X坐标
   * @param {number} targetY 目标格子Y坐标
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 兵力优势值
   */
  calculateForceAdvantageBot3Style(gameMap, targetX, targetY, myColor, size) {
    const visited = new Set();
    const queue = [{ x: targetX, y: targetY, distance: 0 }];
    visited.add(`${targetX},${targetY}`);

    let myForce = 0;
    let enemyForce = 0;

    while (queue.length > 0) {
      const current = queue.shift();

      // 只计算距离小于4的格子
      if (current.distance >= 4) continue;

      // 计算当前格子的兵力贡献
      if (gameMap[current.x] && gameMap[current.x][current.y]) {
        const cell = gameMap[current.x][current.y];
        if (this.isPassable(cell)) {
          if (cell.color === myColor) {
            myForce += cell.amount;
          } else if (cell.color !== 0) {
            enemyForce += cell.amount;
          }
        }
      }

      // 继续BFS搜索
      for (let dir of this.directions) {
        const nextX = current.x + dir.dx;
        const nextY = current.y + dir.dy;
        const key = `${nextX},${nextY}`;

        if (nextX <= 0 || nextX > size || nextY <= 0 || nextY > size) continue;

        if (!gameMap[nextX] || !gameMap[nextX][nextY]) continue;
        if (visited.has(key)) continue;

        const nextCell = gameMap[nextX][nextY];
        if (!this.isPassable(nextCell)) continue;

        visited.add(key);
        queue.push({ x: nextX, y: nextY, distance: current.distance + 1 });
      }
    }

    // 返回兵力优势（我方兵力 - 敌方兵力）
    return myForce - enemyForce;
  }

  /**
   * 获取目标的攻击优先级（bot3风格，基于兵力优势）
   * @param {Array} gameMap 游戏地图
   * @param {number} targetX 目标格子X坐标
   * @param {number} targetY 目标格子Y坐标
   * @param {Object} targetCell 目标格子
   * @param {number} myColor 我方颜色
   * @param {number} size 地图大小
   * @returns {number} 优先级数字，越小优先级越高
   */
  getAttackPriorityBot3Style(
    gameMap,
    targetX,
    targetY,
    targetCell,
    myColor,
    size
  ) {
    // 计算目标格子周围的兵力优势
    const forceAdvantage = this.calculateForceAdvantageBot3Style(
      gameMap,
      targetX,
      targetY,
      myColor,
      size
    );

    // 根据地形类型和兵力优势确定优先级
    let priority;
    if (targetCell.color !== 0 && targetCell.color !== myColor) {
      // 敌方占领的格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        // 敌人城市：兵力优势越大优先级越高
        priority = Math.max(1, 10 - Math.floor(forceAdvantage / 10));
      } else {
        // 敌人空地：兵力优势越大优先级越高
        priority = Math.max(2, 15 - Math.floor(forceAdvantage / 8));
      }
    } else if (targetCell.color === 0) {
      // 中立格子
      if (targetCell.type === 2 || targetCell.type === 3) {
        // 中立城市：兵力优势越大优先级越高
        priority = Math.max(3, 20 - Math.floor(forceAdvantage / 6));
      } else {
        // 中立空地：兵力优势越大优先级越高
        priority = Math.max(4, 25 - Math.floor(forceAdvantage / 5));
      }
    } else {
      priority = 99;
    }

    // 前100回合规则：敌人领地优先级永远高于中立领地
    if (this.roundCount <= 100 && targetCell.color === 0) {
      // 中立格子在前100回合时优先级降低，确保敌人领地优先级更高
      priority += 20; // 将中立格子优先级大幅降低
    }

    // 皇冠距离加成：距离皇冠4格以内的位置获得额外优先级
    const crownDistance = this.getCrownDistance(targetX, targetY);
    let crownBonus = 0;
    if (crownDistance <= 9) {
      // 距离越近，加成越大（优先级数字越小）
      // 距离1: -3, 距离2: -2, 距离3: -1, 距离4: -0.5
      crownBonus = Math.max(0.5, 9 - crownDistance);
    }

    const finalPriority = Math.max(1, priority - crownBonus);

    // 调试输出（可选）
    if (false) {
      // 可以设置为true来查看兵力优势计算
    }

    return finalPriority;
  }

  getEmergencyDefenseMove(gameMap, myColor, size, threatX, threatY) {
    if (this.debugDefense) {
    }
    if (!threatX || !threatY) return null;
    const enemyCell =
      gameMap[threatX] && gameMap[threatX][threatY]
        ? gameMap[threatX][threatY]
        : null;
    const enemyAmount = enemyCell ? enemyCell.amount : 0;
    let bestMove = null;
    let bestForce = 0;
    for (const dir of this.directions) {
      const fromX = threatX + dir.dx;
      const fromY = threatY + dir.dy;
      if (fromX <= 0 || fromX > size || fromY <= 0 || fromY > size) continue;
      if (!gameMap[fromX] || !gameMap[fromX][fromY]) continue;
      const cell = gameMap[fromX][fromY];
      if (cell.color === myColor && cell.amount > enemyAmount) {
        if (cell.amount > bestForce) {
          bestForce = cell.amount;
          bestMove = { fromX, fromY };
        }
      }
    }
    if (bestMove) {
      if (this.debugDefense) {
      }
      return {
        fromX: bestMove.fromX,
        fromY: bestMove.fromY,
        toX: threatX,
        toY: threatY,
        half: false,
      };
    }
    if (this.debugDefense) {
    }
    return null;
  }

  handleEnemyMovementThreat(gameMap, myColor, size) {
    const info = this.trackEnemyMovements(gameMap, myColor, size);
    if (this.debugDefense) {
    }
    const crown = this.findMyCrown(gameMap, myColor, size);
    if (info.lastPos && crown) {
      const attackPath = this.reconstructPathToCrown(
        info.lastPos.x,
        info.lastPos.y,
        crown.x,
        crown.y
      );
      if (this.debugDefense) {
      }
    }
    if (info.threat && info.lastPos) {
      if (this.debugDefense) {
      }

      // 威胁评估：检查敌人是否真的构成威胁
      const isThreatValid = this.evaluateRealThreat(
        gameMap,
        myColor,
        size,
        info.lastPos.x,
        info.lastPos.y
      );
      if (!isThreatValid) {
        if (this.debugDefense) {
        }
        return null; // 不触发防御，继续正常逻辑
      }

      const move = this.getEmergencyDefenseMove(
        gameMap,
        myColor,
        size,
        info.lastPos.x,
        info.lastPos.y
      );
      if (move) {
        if (this.debugDefense) {
          const interceptPath = `(${move.fromX},${move.fromY})->(${move.toX},${move.toY})`;
        }
        return move;
      }

      // 尝试集兵守家
      const gatherMove = this.attemptCollectDefenseMove(
        gameMap,
        myColor,
        size,
        info.lastPos.x,
        info.lastPos.y
      );
      if (gatherMove) {
        if (this.debugDefense)
        return gatherMove;
      }
    }

    // 新增：如果敌人位置未连续逼近，但已进入皇冠距离<=7，也视为威胁
    const immediate = this.findClosestEnemyNearCrown(gameMap, myColor, size, 7);
    if (immediate) {
      if (this.debugDefense) {
        if (crown) {
          const attackPath = this.reconstructPathToCrown(
            immediate.x,
            immediate.y,
            crown.x,
            crown.y
          );
        }
      }

      // 威胁评估：检查敌人是否真的构成威胁
      const isThreatValid = this.evaluateRealThreat(
        gameMap,
        myColor,
        size,
        immediate.x,
        immediate.y
      );
      if (!isThreatValid) {
        if (this.debugDefense) {
        }
        return null; // 不触发防御，继续正常逻辑
      }

      const move = this.getEmergencyDefenseMove(
        gameMap,
        myColor,
        size,
        immediate.x,
        immediate.y
      );
      if (move) {
        if (this.debugDefense) {
          const interceptPath = `(${move.fromX},${move.fromY})->(${move.toX},${move.toY})`;
        }
        return move;
      }

      // 尝试集兵守家
      const gatherMove = this.attemptCollectDefenseMove(
        gameMap,
        myColor,
        size,
        immediate.x,
        immediate.y
      );
      if (gatherMove) {
        if (this.debugDefense)
        return gatherMove;
      }
    }

    return null;
  }

  trackEnemyMovements(gameMap, myColor, size) {
    if (this.debugDefense) {
    }
    const result = { threat: false, lastPos: null, enemyColor: null };
    // 初始化 previousColorMap
    if (!this.previousColorMap) {
      this.previousColorMap = Array(size + 1)
        .fill(null)
        .map(() => Array(size + 1).fill(0));
      for (let i = 1; i <= size; i++) {
        if (!gameMap[i]) continue;
        for (let j = 1; j <= size; j++) {
          this.previousColorMap[i][j] = gameMap[i][j] ? gameMap[i][j].color : 0;
        }
      }
      return result;
    }

    const changedByColor = {};
    // 扫描地图变化
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        const currColor = gameMap[i][j] ? gameMap[i][j].color : 0;
        const prevColor = this.previousColorMap[i][j] || 0;
        if (currColor !== prevColor) {
          // 更新缓存
          this.previousColorMap[i][j] = currColor;
          // 只关注敌人占领的新格子
          if (currColor !== 0 && currColor !== myColor) {
            if (!changedByColor[currColor]) changedByColor[currColor] = [];
            changedByColor[currColor].push({ x: i, y: j });
          }
        }
      }
    }

    // 兼容已有记录的敌人颜色
    const allEnemyColors = new Set([
      ...Object.keys(this.enemyMoveHistory).map((c) => parseInt(c, 10)),
      ...Object.keys(changedByColor).map((c) => parseInt(c, 10)),
    ]);

    for (const color of allEnemyColors) {
      const changes = changedByColor[color] || [];
      let history = this.enemyMoveHistory[color] || [];
      if (changes.length > 0) {
        // 选择离我方皇冠更近的那个变化作为记录
        let chosen = changes[0];
        let bestDist = this.getCrownDistance(chosen.x, chosen.y);
        for (const pos of changes) {
          const d = this.getCrownDistance(pos.x, pos.y);
          if (d < bestDist) {
            bestDist = d;
            chosen = pos;
          }
        }
        if (history.length > 0) {
          const last = history[history.length - 1];
          const contiguous =
            Math.abs(last.x - chosen.x) + Math.abs(last.y - chosen.y) === 1;
          if (!contiguous) {
            history = []; // 轨迹断裂，重置
          }
        }
        history.push(chosen);
      } else if (history.length > 0) {
        // 本回合未检测到移动，沿用上一次位置
        history.push({ ...history[history.length - 1] });
      }
      // 保留最近3次
      if (history.length > 3) {
        history.shift();
      }
      if (history.length > 0) {
        this.enemyMoveHistory[color] = history;
      }

      // 检测三步连续逼近皇冠
      if (history.length === 3) {
        const d0 = this.getCrownDistance(history[0].x, history[0].y);
        const d1 = this.getCrownDistance(history[1].x, history[1].y);
        const d2 = this.getCrownDistance(history[2].x, history[2].y);
        if (d0 > d1 && d1 > d2) {
          result.threat = true;
          result.lastPos = history[2];
          result.enemyColor = color;
          if (this.debugDefense) {
          }
        }
      }
    }

    if (this.debugDefense) {
    }

    return result;
  }

  // 在整个地图中寻找离我方皇冠最近且 <=limitDis 的敌人格子
  findClosestEnemyNearCrown(gameMap, myColor, size, limitDis = 7) {
    let closest = null;
    let bestDis = Infinity;
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        const cell = gameMap[i][j];
        if (!cell) continue;
        if (cell.color === 0 || cell.color === myColor) continue;
        const d = this.getCrownDistance(i, j);
        if (d <= limitDis && d < bestDis) {
          bestDis = d;
          closest = { x: i, y: j, distance: d, amount: cell.amount };
        }
      }
    }
    return closest;
  }

  // 如果无法直接拦截，尝试在敌人抵达前把己方兵力集中到皇冠附近
  attemptCollectDefenseMove(gameMap, myColor, size, threatX, threatY) {
    const crown = this.findMyCrown(gameMap, myColor, size);
    if (!crown) return null;
    const threatDistance = this.getCrownDistance(threatX, threatY);
    if (threatDistance === Infinity) return null;

    // 敌军抵达皇冠时的预计兵力（每步留下1）
    const enemyCell = gameMap[threatX][threatY];
    const enemyEffective = Math.max(1, enemyCell.amount - threatDistance);

    // 获取敌人到皇冠的攻击路径
    const attackPath = this.reconstructPathToCrown(
      threatX,
      threatY,
      crown.x,
      crown.y
    );

    // 分析路径上每个点的集兵能力
    if (this.debugDefense) {
    }

    const pathAnalysis = this.analyzeDefensePathPoints(
      gameMap,
      attackPath,
      threatX,
      threatY,
      myColor,
      size
    );

    // 分析路径，找到能集结最多兵力的拦截点（不要求完全阻止，只要尽可能拦截）
    let bestInterceptPoint = null;
    let bestInterceptIndex = -1;
    let maxGatherForce = 0;

    if (this.debugDefense) {
    }

    for (let i = 0; i < pathAnalysis.length; i++) {
      const point = pathAnalysis[i];
      const enemyForceAtPoint = Math.max(
        1,
        enemyCell.amount - point.stepsFromThreat
      );
      const canWin = point.maxGatherForce >= enemyForceAtPoint;

      if (this.debugDefense) {
      }

      // 选择能集结最多兵力的点，优先选择能完全阻止的点
      if (
        point.maxGatherForce > maxGatherForce ||
        (point.maxGatherForce === maxGatherForce &&
          canWin &&
          !bestInterceptPoint?.canWin)
      ) {
        bestInterceptPoint = point;
        bestInterceptPoint.canWin = canWin;
        bestInterceptIndex = i;
        maxGatherForce = point.maxGatherForce;
      }
    }

    if (this.debugDefense) {
      if (bestInterceptPoint) {
        const enemyForceAtBest = Math.max(
          1,
          enemyCell.amount - bestInterceptPoint.stepsFromThreat
        );
      } else {
      }
    }

    // 拦截有效性评估：如果最佳拦截点的集兵能力太弱，放弃拦截策略
    if (bestInterceptPoint) {
      const enemyForceAtBest = Math.max(
        1,
        enemyCell.amount - bestInterceptPoint.stepsFromThreat
      );
      const interceptEffectiveness =
        bestInterceptPoint.maxGatherForce / enemyForceAtBest;

      // 如果我方能集结的兵力不足敌方的10%，认为拦截无效
      if (interceptEffectiveness < 0.1) {
        if (this.debugDefense) {
        }
        return null; // 放弃拦截，让其他策略处理
      }
    }

    // 执行拦截策略：总是选择最能集结兵力的拦截点
    if (bestInterceptPoint) {
      // 计算敌人在最佳拦截点的兵力，用于判断移动有效性
      const enemyForceAtBest = Math.max(
        1,
        enemyCell.amount - bestInterceptPoint.stepsFromThreat
      );

      // 从拦截点的兵源中选择最优的移动单位
      const optimalSource = this.selectOptimalInterceptSource(
        bestInterceptPoint,
        gameMap,
        myColor,
        size,
        enemyForceAtBest
      );
      if (optimalSource) {
        const dir = this.stepTowards(
          optimalSource.x,
          optimalSource.y,
          bestInterceptPoint.x,
          bestInterceptPoint.y,
          gameMap,
          size
        );
        if (dir) {
          const toX = optimalSource.x + dir.dx;
          const toY = optimalSource.y + dir.dy;
          const enemyForceAtBest = Math.max(
            1,
            enemyCell.amount - bestInterceptPoint.stepsFromThreat
          );
          // 记录防御移动
          this.lastDefenseMove = {
            fromX: optimalSource.x,
            fromY: optimalSource.y,
            toX: toX,
            toY: toY,
          };

          if (this.debugDefense) {
          }
          return {
            fromX: optimalSource.x,
            fromY: optimalSource.y,
            toX,
            toY,
            half: false,
          };
        }
      }

      // 如果拦截点的兵源都无法移动，寻找最有效的防御单位
      if (this.debugDefense) {
      }

      let bestDefenseUnit = null;
      let bestDefenseScore = -1;
      const maxSearchDistance = 10; // 限制搜索范围，避免从太远的地方调兵

      for (let i = 1; i <= size; i++) {
        if (!gameMap[i]) continue;
        for (let j = 1; j <= size; j++) {
          const cell = gameMap[i][j];
          if (!cell || cell.color !== myColor || cell.amount <= 1) continue;

          const distance =
            Math.abs(i - bestInterceptPoint.x) +
            Math.abs(j - bestInterceptPoint.y);
          if (distance > maxSearchDistance) continue; // 太远的不考虑

          // 检查能否移动
          let canMove = false;
          for (const dir of this.directions) {
            const nx = i + dir.dx;
            const ny = j + dir.dy;
            if (nx >= 1 && nx <= size && ny >= 1 && ny <= size) {
              if (
                gameMap[nx] &&
                gameMap[nx][ny] &&
                this.isPassable(gameMap[nx][ny], gameMap, nx, ny, size)
              ) {
                canMove = true;
                break;
              }
            }
          }

          if (canMove) {
            // 计算防御评分：兵力越多越好，距离越近越好
            const availableForce = cell.amount - 1;

            // 只考虑有意义的移动（至少10兵或达到敌方兵力的1%）
            const enemyForceAtBest = Math.max(
              1,
              enemyCell.amount - bestInterceptPoint.stepsFromThreat
            );
            const isSignificantMove =
              availableForce >= 10 || availableForce >= enemyForceAtBest * 0.01;

            if (isSignificantMove) {
              const defenseScore = (availableForce * 100) / (distance + 1); // 兵力权重高，距离权重低

              if (defenseScore > bestDefenseScore) {
                bestDefenseScore = defenseScore;
                bestDefenseUnit = {
                  x: i,
                  y: j,
                  amount: cell.amount,
                  distance: distance,
                  score: defenseScore,
                  availableForce: availableForce,
                };
              }
            }
          }
        }
      }

      if (bestDefenseUnit) {
        const dir = this.stepTowards(
          bestDefenseUnit.x,
          bestDefenseUnit.y,
          bestInterceptPoint.x,
          bestInterceptPoint.y,
          gameMap,
          size
        );
        if (dir) {
          const toX = bestDefenseUnit.x + dir.dx;
          const toY = bestDefenseUnit.y + dir.dy;
          const enemyForceAtBest = Math.max(
            1,
            enemyCell.amount - bestInterceptPoint.stepsFromThreat
          );
          // 记录防御移动
          this.lastDefenseMove = {
            fromX: bestDefenseUnit.x,
            fromY: bestDefenseUnit.y,
            toX: toX,
            toY: toY,
          };

          if (this.debugDefense) {
          }
          return {
            fromX: bestDefenseUnit.x,
            fromY: bestDefenseUnit.y,
            toX,
            toY,
            half: false,
          };
        }
      } else {
        if (this.debugDefense) {
        }
        return null; // 放弃拦截，让其他策略处理
      }
    }

    // 如果没有找到任何拦截点，也没有可移动的单位，输出警告但仍尝试找到任何可能的防御移动
    if (this.debugDefense) {
    }

    // 最后的防御措施：找到任意一个我方最大兵力的格子朝皇冠移动，避免反复跳动
    let lastResortCell = null;
    let maxAmount = 0;

    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        const cell = gameMap[i][j];
        if (!cell || cell.color !== myColor || cell.amount <= 1) continue;
        if (cell.amount > maxAmount) {
          maxAmount = cell.amount;
          lastResortCell = { x: i, y: j, amount: cell.amount };
        }
      }
    }

    if (lastResortCell) {
      // 检查是否会产生反复跳动：如果上次防御移动是从A到B，这次不要从B回到A
      let avoidPosition = null;
      if (
        this.lastDefenseMove &&
        this.lastDefenseMove.toX === lastResortCell.x &&
        this.lastDefenseMove.toY === lastResortCell.y
      ) {
        // 当前位置是上次移动的目标，避免返回到起点
        avoidPosition = {
          x: this.lastDefenseMove.fromX,
          y: this.lastDefenseMove.fromY,
        };
        if (this.debugDefense) {
        }
      }

      const dir = this.stepTowards(
        lastResortCell.x,
        lastResortCell.y,
        crown.x,
        crown.y,
        gameMap,
        size,
        avoidPosition
      );
      if (dir) {
        const toX = lastResortCell.x + dir.dx;
        const toY = lastResortCell.y + dir.dy;

        // 记录这次防御移动，用于下次防反跳检查
        this.lastDefenseMove = {
          fromX: lastResortCell.x,
          fromY: lastResortCell.y,
          toX: toX,
          toY: toY,
        };

        if (this.debugDefense) {
        }
        return {
          fromX: lastResortCell.x,
          fromY: lastResortCell.y,
          toX,
          toY,
          half: false,
        };
      } else if (avoidPosition) {
        // 如果避免反跳后找不到方向，允许回跳一次，但添加警告
        const dir2 = this.stepTowards(
          lastResortCell.x,
          lastResortCell.y,
          crown.x,
          crown.y,
          gameMap,
          size
        );
        if (dir2) {
          const toX = lastResortCell.x + dir2.dx;
          const toY = lastResortCell.y + dir2.dy;

          this.lastDefenseMove = {
            fromX: lastResortCell.x,
            fromY: lastResortCell.y,
            toX: toX,
            toY: toY,
          };

          if (this.debugDefense) {
          }
          return {
            fromX: lastResortCell.x,
            fromY: lastResortCell.y,
            toX,
            toY,
            half: false,
          };
        }
      }
    }

    if (this.debugDefense) {
    }
    return null;
  }

  // 从 (sx,sy) 选择一个方向朝 (tx,ty) 前进，保证目的格可通行，避免反复跳动
  stepTowards(sx, sy, tx, ty, gameMap, size, avoidPosition = null) {
    let bestDir = null;
    let bestDist = Infinity;
    let candidateDirs = []; // 存储所有最优方向

    for (const dir of this.directions) {
      const nx = sx + dir.dx;
      const ny = sy + dir.dy;
      if (nx <= 0 || nx > size || ny <= 0 || ny > size) continue;
      if (!gameMap[nx] || !gameMap[nx][ny]) continue;
      if (!this.isPassable(gameMap[nx][ny], gameMap, nx, ny, size)) continue;

      // 如果有要避免的位置，跳过这个方向
      if (avoidPosition && nx === avoidPosition.x && ny === avoidPosition.y) {
        continue;
      }

      const d = Math.abs(nx - tx) + Math.abs(ny - ty);
      if (d < bestDist) {
        bestDist = d;
        bestDir = dir;
        candidateDirs = [dir]; // 重置候选方向
      } else if (d === bestDist) {
        candidateDirs.push(dir); // 添加到候选方向
      }
    }

    // 如果有多个等距离的方向，优先选择更稳定的方向（优先上下，再左右）
    if (candidateDirs.length > 1) {
      const priority = [
        { dx: 0, dy: -1 }, // 上
        { dx: 0, dy: 1 }, // 下
        { dx: -1, dy: 0 }, // 左
        { dx: 1, dy: 0 }, // 右
      ];

      for (const prio of priority) {
        for (const candidate of candidateDirs) {
          if (candidate.dx === prio.dx && candidate.dy === prio.dy) {
            return candidate;
          }
        }
      }
    }

    return bestDir;
  }

  findMyCrown(gameMap, myColor, size) {
    for (let i = 1; i <= size; i++) {
      if (!gameMap[i]) continue;
      for (let j = 1; j <= size; j++) {
        if (
          gameMap[i][j] &&
          gameMap[i][j].type === 1 &&
          gameMap[i][j].color === myColor
        ) {
          return { x: i, y: j };
        }
      }
    }
    return null;
  }

  // 根据 crownDistanceMap 重建从 (sx,sy) 到 crown 的最短路径列表
  reconstructPathToCrown(sx, sy, crownX, crownY) {
    const path = [{ x: sx, y: sy }];
    if (!this.crownDistanceMap || this.crownDistanceMap[sx][sy] === Infinity)
      return path;
    let curX = sx,
      curY = sy;
    let dist = this.crownDistanceMap[curX][curY];
    const maxIter = dist + 2;
    let iter = 0;
    while ((curX !== crownX || curY !== crownY) && iter < maxIter) {
      iter++;
      for (const dir of this.directions) {
        const nx = curX + dir.dx;
        const ny = curY + dir.dy;
        if (
          nx <= 0 ||
          ny <= 0 ||
          nx >= this.crownDistanceMap.length ||
          ny >= this.crownDistanceMap.length
        )
          continue;
        const nd = this.crownDistanceMap[nx][ny];
        if (nd === dist - 1) {
          path.push({ x: nx, y: ny });
          curX = nx;
          curY = ny;
          dist = nd;
          break;
        }
      }
    }
    return path;
  }

  // 分析防御路径上每个点的集兵能力
  analyzeDefensePathPoints(
    gameMap,
    attackPath,
    threatX,
    threatY,
    myColor,
    size
  ) {
    const analysis = [];

    for (let i = 0; i < attackPath.length; i++) {
      const point = attackPath[i];
      // 敌人到达这个点需要的步数
      const stepsToPoint = i;

      // BFS搜索：在敌人到达前，我方能够集合到这个点的兵力（排除攻击路径上的点）
      const gatherResult = this.calculateGatherForceToPoint(
        gameMap,
        point.x,
        point.y,
        stepsToPoint,
        myColor,
        size,
        attackPath
      );

      analysis.push({
        x: point.x,
        y: point.y,
        stepIndex: i,
        stepsFromThreat: stepsToPoint,
        maxGatherForce: gatherResult.totalForce,
        gatherSources: gatherResult.sources,
      });

      if (this.debugDefense) {
        if (gatherResult.sources.length > 0) {
          const sourceDetails = gatherResult.sources
            .map((s) => `(${s.x},${s.y}):${s.force}兵${s.steps}步`)
            .join(", ");
        } else {
        }

        // 显示被排除的兵源
        if (
          gatherResult.excludedSources &&
          gatherResult.excludedSources.length > 0
        ) {
          const excludedDetails = gatherResult.excludedSources
            .map((s) => `(${s.x},${s.y}):${s.force}兵${s.steps}步`)
            .join(", ");
        }
      }
    }

    return analysis;
  }

  // 计算在指定步数内能够集合到目标点的我方兵力
  calculateGatherForceToPoint(
    gameMap,
    targetX,
    targetY,
    maxSteps,
    myColor,
    size,
    attackPath = []
  ) {
    const result = {
      totalForce: 0,
      sources: [],
      excludedSources: [], // 新增：记录被排除的兵源
    };

    // 创建攻击路径上的点的集合，用于快速查找
    const pathPoints = new Set();
    if (attackPath) {
      for (const point of attackPath) {
        pathPoints.add(`${point.x},${point.y}`);
      }
    }

    // BFS搜索所有能在maxSteps步内到达目标点的我方格子
    const queue = [{ x: targetX, y: targetY, steps: 0 }];
    const visited = new Set();
    visited.add(`${targetX},${targetY}`);

    // 反向BFS：从目标点出发，找到所有能在maxSteps内到达的我方格子
    while (queue.length > 0) {
      const { x, y, steps } = queue.shift();
      const posKey = `${x},${y}`;

      // 检查当前位置是否有我方兵力，但排除攻击路径上的点
      if (
        gameMap[x] &&
        gameMap[x][y] &&
        gameMap[x][y].color === myColor &&
        gameMap[x][y].amount > 1
      ) {
        const availableForce = gameMap[x][y].amount - 1; // 留下1兵

        if (!pathPoints.has(posKey)) {
          // 不在攻击路径上，可以作为兵源
          result.totalForce += availableForce;
          result.sources.push({
            x: x,
            y: y,
            force: availableForce,
            steps: steps,
            realTimeCheck: true, // 标记需要实时检查
          });
        } else {
          // 在攻击路径上，记录但不使用
          result.excludedSources.push({
            x: x,
            y: y,
            force: availableForce,
            steps: steps,
            reason: "在攻击路径上",
          });
        }
      }

      // 如果还有剩余步数，继续扩展搜索
      if (steps < maxSteps) {
        for (const dir of this.directions) {
          const nx = x + dir.dx;
          const ny = y + dir.dy;
          const key = `${nx},${ny}`;

          if (
            nx >= 1 &&
            nx <= size &&
            ny >= 1 &&
            ny <= size &&
            !visited.has(key)
          ) {
            if (
              gameMap[nx] &&
              gameMap[nx][ny] &&
              this.isPassable(gameMap[nx][ny], gameMap, nx, ny, size)
            ) {
              visited.add(key);
              queue.push({ x: nx, y: ny, steps: steps + 1 });
            }
          }
        }
      }
    }

    return result;
  }

  // 从拦截点的兵源中选择最优的移动单位
  selectOptimalInterceptSource(
    interceptPoint,
    gameMap,
    myColor,
    size,
    enemyForce
  ) {
    if (
      !interceptPoint ||
      !interceptPoint.gatherSources ||
      interceptPoint.gatherSources.length === 0
    ) {
      return null;
    }

    // 按优先级排序：1. 距离最近 2. 兵力最大
    const sortedSources = interceptPoint.gatherSources.slice().sort((a, b) => {
      if (a.steps !== b.steps) {
        return a.steps - b.steps; // 距离越近越好
      }
      return b.force - a.force; // 兵力越大越好
    });

    // 选择第一个能够实际移动的兵源
    for (const source of sortedSources) {
      // 检查当前兵力是否足够移动（>1兵才能移动）
      const currentCell = gameMap[source.x] && gameMap[source.x][source.y];
      if (
        !currentCell ||
        currentCell.color !== myColor ||
        currentCell.amount <= 1
      ) {
        if (this.debugDefense) {
        }
        continue;
      }

      // 检查这个兵源是否能够移动（至少有一个可通行的相邻格子）
      let canMove = false;
      for (const dir of this.directions) {
        const nx = source.x + dir.dx;
        const ny = source.y + dir.dy;
        if (nx >= 1 && nx <= size && ny >= 1 && ny <= size) {
          if (
            gameMap[nx] &&
            gameMap[nx][ny] &&
            this.isPassable(gameMap[nx][ny], gameMap, nx, ny, size)
          ) {
            canMove = true;
            break;
          }
        }
      }

      if (canMove) {
        // 检查移动的有效性：移动兵力至少要达到敌方的1%或者10兵以上
        const availableForce = currentCell.amount - 1;
        const isSignificantMove =
          availableForce >= 10 || availableForce >= enemyForce * 0.01;

        if (isSignificantMove) {
          if (this.debugDefense) {
          }
          return source;
        } else {
          if (this.debugDefense) {
          }
        }
      }
    }

    if (this.debugDefense) {
    }
    return null;
  }

  // 评估敌人是否构成真正威胁
  evaluateRealThreat(gameMap, myColor, size, threatX, threatY) {
    const crown = this.findMyCrown(gameMap, myColor, size);
    if (!crown) return false;

    // 获取敌人当前兵力
    const enemyCell = gameMap[threatX] && gameMap[threatX][threatY];
    if (!enemyCell) return false;

    const enemyAmount = enemyCell.amount;
    const threatDistance = this.getCrownDistance(threatX, threatY);

    if (threatDistance === Infinity) return false;

    // 计算敌人到达皇冠时的剩余兵力（每步留下1兵）
    const enemyRemainingForce = Math.max(1, enemyAmount - threatDistance);

    // 检查攻击路径上我方现有兵力
    const attackPath = this.reconstructPathToCrown(
      threatX,
      threatY,
      crown.x,
      crown.y
    );
    let pathDefenseForce = 0;
    const pathDefenseDetails = [];

    for (const point of attackPath) {
      if (
        gameMap[point.x] &&
        gameMap[point.x][point.y] &&
        gameMap[point.x][point.y].color === myColor &&
        gameMap[point.x][point.y].amount > 1
      ) {
        const availableForce = gameMap[point.x][point.y].amount - 1;
        pathDefenseForce += availableForce;
        pathDefenseDetails.push(`(${point.x},${point.y}):${availableForce}兵`);
      }
    }

    // 如果路径上现有兵力已经足够抵挡敌人，不构成威胁
    if (pathDefenseForce >= enemyRemainingForce) {
      this.lastDefenseMove = null; // 清空防御移动记录，避免过期记录影响判断
      if (this.debugDefense) {
      }
      return false;
    }

    // 如果路径上兵力不足以阻挡敌人，检查是否构成真正威胁

    // 对于距离很近的敌人（≤5步），如果路径兵力不足，直接判定为威胁
    if (threatDistance <= 5) {
      if (this.debugDefense) {
      }
      return true;
    }

    // 对于较远的敌人，检查基础威胁阈值
    const minBasicThreat = 15; // 基础威胁阈值
    if (enemyRemainingForce < minBasicThreat) {
      this.lastDefenseMove = null; // 清空防御移动记录
      if (this.debugDefense) {
      }
      return false;
    }

    // 计算我方皇冠周围的防御兵力（距离皇冠3格内的我方兵力）
    let crownAreaDefense = 0;
    const defenseRadius = 3;

    for (
      let i = Math.max(1, crown.x - defenseRadius);
      i <= Math.min(size, crown.x + defenseRadius);
      i++
    ) {
      for (
        let j = Math.max(1, crown.y - defenseRadius);
        j <= Math.min(size, crown.y + defenseRadius);
        j++
      ) {
        if (gameMap[i] && gameMap[i][j] && gameMap[i][j].color === myColor) {
          const distance = Math.abs(i - crown.x) + Math.abs(j - crown.y);
          if (distance <= defenseRadius) {
            crownAreaDefense += Math.max(0, gameMap[i][j].amount - 1);
          }
        }
      }
    }

    // 对于中远距离敌人，使用动态威胁阈值
    const dynamicThreatForce = Math.max(
      minBasicThreat,
      Math.floor(crownAreaDefense * 0.2)
    ); // 降低系数到0.2
    const isThreat = enemyRemainingForce >= dynamicThreatForce;

    if (this.debugDefense) {
    }

    // 如果不构成威胁，清空防御移动记录
    if (!isThreat) {
      this.lastDefenseMove = null;
    }

    return isThreat;
  }
}

module.exports = GameStrategy;
