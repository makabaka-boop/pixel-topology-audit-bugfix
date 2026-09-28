/**
 * 拓扑核心规则（画布显示与统计必须共用这一套定义，结论才一致）：
 *
 * - 黑格按【八邻接】分连通域（对角相接算同一块）；
 * - 白格按【四邻接】分连通域（对角相接不算连通）；
 * - 触及画布边界的白域是“外部”，其余白域才是“孔洞”；
 * - 欧拉数 = 黑域数 − 孔洞数（8/4 互补邻接下成立的数字拓扑关系）；
 * - 黑域周长按四边中“朝向白格或画布外”的边数计（暴露周长）。
 */

export const MIN_SIZE = 4;
export const MAX_SIZE = 64;

export interface Grid {
  size: number;
  /** 行优先展开，1 = 黑，0 = 白 */
  cells: Uint8Array;
}

export function createGrid(size: number, fill: 0 | 1 = 0): Grid {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`边长须为正整数，当前：${size}`);
  }
  return { size, cells: new Uint8Array(size * size).fill(fill) };
}

export function cloneGrid(g: Grid): Grid {
  return { size: g.size, cells: new Uint8Array(g.cells) };
}

const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];
const DIRS8: ReadonlyArray<readonly [number, number]> = [
  ...DIRS4, [-1, -1], [-1, 1], [1, -1], [1, 1],
];

/** 对取值为 value 的格点按给定邻接做连通域标号（迭代泛洪，避免递归爆栈）。 */
export function labelComponents(
  size: number,
  cells: Uint8Array,
  value: 0 | 1,
  dirs: ReadonlyArray<readonly [number, number]>,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(size * size).fill(-1);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < cells.length; s++) {
    if (cells[s] !== value || labels[s] !== -1) continue;
    labels[s] = count;
    stack.push(s);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const r = Math.floor(cur / size);
      const c = cur % size;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const ni = nr * size + nc;
        if (cells[ni] === value && labels[ni] === -1) {
          labels[ni] = count;
          stack.push(ni);
        }
      }
    }
    count++;
  }
  return { labels, count };
}

export interface BlackRegion {
  id: number;
  area: number;
  perimeter: number;
  cells: number[];
}

export interface WhiteRegion {
  id: number;
  area: number;
  cells: number[];
  touchesBorder: boolean;
}

export interface Analysis {
  size: number;
  blackLabels: Int32Array;
  whiteLabels: Int32Array;
  blackRegions: BlackRegion[];
  whiteRegions: WhiteRegion[];
  holes: WhiteRegion[];
  blackCount: number;
  holeCount: number;
  euler: number;
  blackArea: number;
}

export function analyze(grid: Grid): Analysis {
  const { size, cells } = grid;
  const b = labelComponents(size, cells, 1, DIRS8);
  const w = labelComponents(size, cells, 0, DIRS4);

  const blackRegions: BlackRegion[] = [];
  const whiteRegions: WhiteRegion[] = [];
  for (let i = 0; i < b.count; i++) blackRegions.push({ id: i, area: 0, perimeter: 0, cells: [] });
  for (let i = 0; i < w.count; i++) whiteRegions.push({ id: i, area: 0, cells: [], touchesBorder: false });

  let blackArea = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (cells[i] === 1) {
        blackArea++;
        const reg = blackRegions[b.labels[i]];
        reg.area++;
        reg.cells.push(i);
        for (const [dr, dc] of DIRS4) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size || cells[nr * size + nc] === 0) {
            reg.perimeter++;
          }
        }
      } else {
        const reg = whiteRegions[w.labels[i]];
        reg.area++;
        reg.cells.push(i);
        if (r === 0 || c === 0 || r === size - 1 || c === size - 1) reg.touchesBorder = true;
      }
    }
  }

  const holes = whiteRegions.filter((x) => !x.touchesBorder);
  return {
    size,
    blackLabels: b.labels,
    whiteLabels: w.labels,
    blackRegions,
    whiteRegions,
    holes,
    blackCount: b.count,
    holeCount: holes.length,
    euler: b.count - holes.length,
    blackArea,
  };
}

export interface FlipCandidate {
  row: number;
  col: number;
  /** true = 白翻黑（封口），false = 黑翻白（开口） */
  toBlack: boolean;
  holesBefore: number;
  holesAfter: number;
  blackBefore: number;
  blackAfter: number;
  eulerBefore: number;
  eulerAfter: number;
}

/**
 * 扫描所有单格翻转，返回“恰好消去一个孔（孔洞数 −1）且黑域数不变”的位置。
 * 每格都基于原始网格独立试翻，结果按 (行, 列) 升序排列。
 */
export function findHoleRemovals(grid: Grid, base?: Analysis): FlipCandidate[] {
  const before = base ?? analyze(grid);
  const work = cloneGrid(grid);
  const out: FlipCandidate[] = [];
  for (let i = 0; i < work.cells.length; i++) {
    // 独立试翻：翻一次、分析、再翻回来，避免前面的翻转污染后续候选
    work.cells[i] = work.cells[i] === 1 ? 0 : 1;
    const after = analyze(work);
    work.cells[i] = work.cells[i] === 1 ? 0 : 1;
    if (after.holeCount === before.holeCount - 1 && after.blackCount === before.blackCount) {
      out.push({
        row: Math.floor(i / grid.size),
        col: i % grid.size,
        toBlack: grid.cells[i] === 0,
        holesBefore: before.holeCount,
        holesAfter: after.holeCount,
        blackBefore: before.blackCount,
        blackAfter: after.blackCount,
        eulerBefore: before.euler,
        eulerAfter: after.euler,
      });
    }
  }
  out.sort((a, b) => a.row - b.row || a.col - b.col);
  return out;
}

/* ---------- 导入 / 导出 ---------- */

export function gridToRows(grid: Grid): string[] {
  const rows: string[] = [];
  for (let r = 0; r < grid.size; r++) {
    let s = '';
    for (let c = 0; c < grid.size; c++) {
      s += grid.cells[r * grid.size + c] === 1 ? '1' : '0';
    }
    rows.push(s);
  }
  return rows;
}

/** 导出为 JSON：{"size": n, "rows": ["0101", ...]} */
export function exportGrid(grid: Grid): string {
  return JSON.stringify({ size: grid.size, rows: gridToRows(grid) }, null, 2);
}

/**
 * 解析导入文本，接受三种形式：
 * 1. 导出格式 JSON：{"size": n, "rows": [...]}
 * 2. 行数组 JSON：["0101", ...]
 * 3. 纯文本：每行一串 0/1（允许空白字符分隔）
 * 边长须在 [MIN_SIZE, MAX_SIZE] 且为方阵。
 */
export function parseGrid(text: string): Grid {
  const t = text.trim();
  if (!t) throw new Error('内容为空');

  let rows: unknown;
  if (t.startsWith('{') || t.startsWith('[')) {
    let data: unknown;
    try {
      data = JSON.parse(t);
    } catch {
      throw new Error('JSON 解析失败');
    }
    if (Array.isArray(data)) {
      rows = data;
    } else if (typeof data === 'object' && data !== null && Array.isArray((data as { rows?: unknown }).rows)) {
      const d = data as { rows: unknown[]; size?: unknown };
      if (d.size !== undefined) {
        if (typeof d.size !== 'number' || !Number.isInteger(d.size) || d.size !== d.rows.length) {
          throw new Error(`size 声明（${String(d.size)}）必须是与行数（${d.rows.length}）一致的整数`);
        }
      }
      rows = d.rows;
    } else {
      throw new Error('JSON 需为行数组或 {"size": n, "rows": [...]}');
    }
  } else {
    rows = t.split(/\r?\n/).map((l) => l.replace(/\s+/g, '')).filter((l) => l.length > 0);
  }

  const list = rows as unknown[];
  if (!Array.isArray(list) || list.length === 0) throw new Error('没有有效行');
  for (const row of list) {
    if (typeof row !== 'string') throw new Error('每行须为 0/1 字符串');
  }
  const strs = list as string[];
  const n = strs.length;
  if (n < MIN_SIZE || n > MAX_SIZE) {
    throw new Error(`边长须在 ${MIN_SIZE}~${MAX_SIZE} 之间，当前 ${n}`);
  }
  for (const row of strs) {
    if (row.length !== n) throw new Error(`每行长度须等于边长 ${n}`);
    if (!/^[01]+$/.test(row)) throw new Error(`只能包含 0/1 字符，发现非法行：${row}`);
  }

  const g = createGrid(n);
  strs.forEach((row, r) => {
    for (let c = 0; c < n; c++) g.cells[r * n + c] = row[c] === '1' ? 1 : 0;
  });
  return g;
}
