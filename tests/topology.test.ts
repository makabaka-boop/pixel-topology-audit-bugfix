import { describe, expect, it } from 'vitest';
import {
  analyze,
  createGrid,
  exportGrid,
  findHoleRemovals,
  parseGrid,
  type Grid,
} from '../src/topology';

/* ======================================================================
 * 独立参考实现：与 src/topology.ts 分头编写（队列式 BFS），用于对拍。
 * 规则相同：黑八邻接、白四邻接、触边白域为外部、欧拉数 = 黑域数 − 孔洞数。
 * ==================================================================== */

const D4: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];
const D8: ReadonlyArray<readonly [number, number]> = [
  ...D4, [-1, -1], [-1, 1], [1, -1], [1, 1],
];

interface IndResult {
  blackCount: number;
  holeCount: number;
  euler: number;
  blackParts: Array<[number, number]>; // 每块黑域的 [面积, 周长]
  holeAreas: number[];
  whiteCount: number;
}

function indAnalyze(size: number, cells: number[]): IndResult {
  const label = (target: number, dirs: ReadonlyArray<readonly [number, number]>) => {
    const lab = new Array<number>(size * size).fill(-1);
    let count = 0;
    for (let s = 0; s < size * size; s++) {
      if (cells[s] !== target || lab[s] !== -1) continue;
      const queue = [s];
      lab[s] = count;
      for (let h = 0; h < queue.length; h++) {
        const cur = queue[h];
        const r = Math.floor(cur / size);
        const c = cur % size;
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
          const j = nr * size + nc;
          if (cells[j] === target && lab[j] === -1) {
            lab[j] = count;
            queue.push(j);
          }
        }
      }
      count++;
    }
    return { lab, count };
  };

  const B = label(1, D8);
  const W = label(0, D4);

  const borderWhite = new Set<number>();
  for (let i = 0; i < size * size; i++) {
    if (cells[i] !== 0) continue;
    const r = Math.floor(i / size);
    const c = i % size;
    if (r === 0 || c === 0 || r === size - 1 || c === size - 1) borderWhite.add(W.lab[i]);
  }

  const holeArea = new Map<number, number>();
  for (let i = 0; i < size * size; i++) {
    if (cells[i] === 0 && !borderWhite.has(W.lab[i])) {
      holeArea.set(W.lab[i], (holeArea.get(W.lab[i]) ?? 0) + 1);
    }
  }

  const parts = new Map<number, [number, number]>();
  for (let k = 0; k < B.count; k++) parts.set(k, [0, 0]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (cells[i] !== 1) continue;
      const p = parts.get(B.lab[i])!;
      p[0]++;
      for (const [dr, dc] of D4) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= size || nc >= size || cells[nr * size + nc] === 0) p[1]++;
      }
    }
  }

  return {
    blackCount: B.count,
    holeCount: holeArea.size,
    euler: B.count - holeArea.size,
    blackParts: [...parts.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    holeAreas: [...holeArea.values()].sort((a, b) => a - b),
    whiteCount: W.count,
  };
}

/* ---------- 对拍辅助 ---------- */

function srcStats(g: Grid): IndResult {
  const a = analyze(g);
  return {
    blackCount: a.blackCount,
    holeCount: a.holeCount,
    euler: a.euler,
    blackParts: a.blackRegions
      .map((r): [number, number] => [r.area, r.perimeter])
      .sort((x, y) => x[0] - y[0] || x[1] - y[1]),
    holeAreas: a.holes.map((h) => h.area).sort((x, y) => x - y),
    whiteCount: a.whiteRegions.length,
  };
}

function gridFromMask(size: number, mask: number): Grid {
  const g = createGrid(size);
  for (let i = 0; i < size * size; i++) g.cells[i] = (mask >> i) & 1;
  return g;
}

function cellsOf(g: Grid): number[] {
  return [...g.cells];
}

function expectStatsMatch(g: Grid): void {
  expect(srcStats(g)).toEqual(indAnalyze(g.size, cellsOf(g)));
}

/** 独立实现的候选扫描：逐格翻转后重算，筛“孔 −1 且黑域数不变”。 */
function indCandidates(g: Grid): Array<{ row: number; col: number; toBlack: boolean }> {
  const base = indAnalyze(g.size, cellsOf(g));
  const out: Array<{ row: number; col: number; toBlack: boolean }> = [];
  for (let i = 0; i < g.size * g.size; i++) {
    const cells = cellsOf(g);
    cells[i] = cells[i] === 1 ? 0 : 1;
    const t = indAnalyze(g.size, cells);
    if (t.holeCount === base.holeCount - 1 && t.blackCount === base.blackCount) {
      out.push({ row: Math.floor(i / g.size), col: i % g.size, toBlack: g.cells[i] === 0 });
    }
  }
  return out;
}

function expectCandidatesMatch(g: Grid): void {
  const got = findHoleRemovals(g).map(({ row, col, toBlack }) => ({ row, col, toBlack }));
  expect(got).toEqual(indCandidates(g));
}

function gridFromRows(rows: string[]): Grid {
  const g = createGrid(rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) g.cells[r * g.size + c] = row[c] === '1' ? 1 : 0;
  });
  return g;
}

/* ---------- 小网格穷举对拍 ---------- */

describe('小网格穷举对拍', () => {
  it.each([2, 3, 4])('%i 阶全枚举：黑域/孔洞/欧拉数/面积/周长与独立实现一致', (n) => {
    const total = 1 << (n * n);
    for (let m = 0; m < total; m++) expectStatsMatch(gridFromMask(n, m));
  });

  it('3 阶全枚举：翻转候选与独立扫描一致', () => {
    for (let m = 0; m < 1 << 9; m++) expectCandidatesMatch(gridFromMask(3, m));
  });

  it('随机网格：统计与翻转候选双双一致', () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const n of [5, 6, 7, 8, 16]) {
      for (let k = 0; k < 40; k++) {
        const g = createGrid(n);
        const p = 0.25 + 0.5 * rand();
        for (let i = 0; i < n * n; i++) g.cells[i] = rand() < p ? 1 : 0;
        expectStatsMatch(g);
        expectCandidatesMatch(g);
      }
    }
  });
});

/* ---------- 对角接触 ---------- */

describe('对角接触', () => {
  it('2×2 对角黑格算同一黑域；两格白互不连通但都是外部', () => {
    const a = analyze(gridFromRows(['10', '01']));
    expect(a.blackCount).toBe(1);
    expect(a.whiteRegions.length).toBe(2);
    expect(a.holeCount).toBe(0);
    expect(a.euler).toBe(1);
  });

  it('3×3 主对角黑链：白格四邻接无法穿过对角接缝，被分成两个外部域', () => {
    const a = analyze(gridFromRows(['100', '010', '001']));
    expect(a.blackCount).toBe(1);
    expect(a.whiteRegions.length).toBe(2);
    expect(a.holeCount).toBe(0);
    expect(a.euler).toBe(1);
  });

  it('4×4 菱形黑环仅靠对角相接仍是一块，且围住中心一格孔', () => {
    const a = analyze(gridFromRows(['0000', '0010', '0101', '0010']));
    expect(a.blackCount).toBe(1); // 八邻接：四格对角相连 = 一块
    expect(a.holeCount).toBe(1); // 四邻接：中心白格无法从对角缝漏出
    expect(a.euler).toBe(0);
    expect(a.holes[0].area).toBe(1);
    expect(a.holes[0].cells).toEqual([2 * 4 + 2]);
  });
});

/* ---------- 边缘缺口 ---------- */

describe('边缘缺口', () => {
  const ringRows = ['1110', '1010', '1110', '0000'];

  it('封闭环：中心白格是孔', () => {
    const a = analyze(gridFromRows(ringRows));
    expect(a.blackCount).toBe(1);
    expect(a.holeCount).toBe(1);
    expect(a.euler).toBe(0);
  });

  it('环在画布边缘开一格缺口：孔漏成外部', () => {
    const a = analyze(gridFromRows(['1010', '1010', '1110', '0000']));
    expect(a.blackCount).toBe(1);
    expect(a.holeCount).toBe(0);
    expect(a.euler).toBe(1);
  });

  it('封闭环的候选：四处边缘开口（黑翻白）+ 中心封口（白翻黑），按行列排序', () => {
    const cands = findHoleRemovals(gridFromRows(ringRows));
    expect(cands.map(({ row, col, toBlack }) => ({ row, col, toBlack }))).toEqual([
      { row: 0, col: 1, toBlack: false },
      { row: 1, col: 0, toBlack: false },
      { row: 1, col: 1, toBlack: true },
      { row: 1, col: 2, toBlack: false },
      { row: 2, col: 1, toBlack: false },
    ]);
    for (const c of cands) {
      expect([c.holesBefore, c.holesAfter]).toEqual([1, 0]);
      expect([c.blackBefore, c.blackAfter]).toEqual([1, 1]);
      expect([c.eulerBefore, c.eulerAfter]).toEqual([0, 1]);
    }
  });
});

/* ---------- 一格封口 ---------- */

describe('一格封口', () => {
  it('4×4 全黑仅 (1,1) 一格白：填上它是候选；只有触边的两格环壁拆开才算开口', () => {
    const g = createGrid(4, 1);
    g.cells[1 * 4 + 1] = 0;
    expect(analyze(g).holeCount).toBe(1);
    // (2,1)、(1,2) 翻白后，白域 {孔, 新格} 仍不触边，孔洞数不变，故不是候选
    const cands = findHoleRemovals(g);
    expect(cands.map((c) => [c.row, c.col, c.toBlack])).toEqual([
      [0, 1, false],
      [1, 0, false],
      [1, 1, true],
    ]);
  });

  it('两格孔：任何“白翻黑”都填不干净，只能靠黑翻白把孔接上外部', () => {
    // 6×6：厚壁黑环围住两格孔 {(2,2),(2,3)}，外部白域在四周
    const g = gridFromRows([
      '000000',
      '011110',
      '010010',
      '011110',
      '011110',
      '000000',
    ]);
    expect(analyze(g).holeCount).toBe(1);
    const cands = findHoleRemovals(g);
    // 填 (2,2) 或 (2,3) 都仍剩一格孔；下壁 (3,2)/(3,3) 内侧还有一排黑，翻白也漏不出去
    expect(cands.every((c) => !c.toBlack)).toBe(true);
    expect(cands.map((c) => [c.row, c.col])).toEqual([
      [1, 2], [1, 3], [2, 1], [2, 4],
    ]);
  });

  it('菱形环：中心一格封口与四环格开口都是候选', () => {
    const g = gridFromRows(['0000', '0010', '0101', '0010']);
    const cands = findHoleRemovals(g);
    expect(cands.map((c) => [c.row, c.col, c.toBlack])).toEqual([
      [1, 2, false],
      [2, 1, false],
      [2, 2, true],
      [2, 3, false],
      [3, 2, false],
    ]);
  });

  it('无孔画布（含孤立黑格）不产生任何候选', () => {
    const g = gridFromRows(['1000', '0000', '0010', '0000']);
    expect(analyze(g).holeCount).toBe(0);
    expect(findHoleRemovals(g)).toEqual([]);
  });
});

/* ---------- ---------- 面积 / 周长 / 欧拉数 ---------- */

describe('面积、周长与欧拉数', () => {
  it('单格黑：面积 1、周长 4（朝向画布外的边也计入）', () => {
    const g = createGrid(4);
    g.cells[1 * 4 + 1] = 1;
    const r = analyze(g).blackRegions[0];
    expect([r.area, r.perimeter]).toEqual([1, 4]);
  });

  it('角落单格黑：周长仍为 4', () => {
    const g = createGrid(4);
    g.cells[0] = 1;
    expect(analyze(g).blackRegions[0].perimeter).toBe(4);
  });

  it('2×2 黑块：面积 4、周长 8', () => {
    const g = createGrid(4);
    g.cells[1 * 4 + 1] = 1;
    g.cells[1 * 4 + 2] = 1;
    g.cells[2 * 4 + 1] = 1;
    g.cells[2 * 4 + 2] = 1;
    const r = analyze(g).blackRegions[0];
    expect([r.area, r.perimeter]).toEqual([4, 8]);
  });

  it('空画布：黑域 0、孔 0、欧拉数 0', () => {
    const a = analyze(createGrid(4));
    expect([a.blackCount, a.holeCount, a.euler, a.blackArea]).toEqual([0, 0, 0, 0]);
  });

  it('全黑画布：黑域 1、周长等于画布边界、欧拉数 1', () => {
    const a = analyze(createGrid(4, 1));
    expect(a.blackCount).toBe(1);
    expect(a.blackRegions[0].perimeter).toBe(16);
    expect(a.euler).toBe(1);
  });
});

/* ---------- 导入 / 导出 ---------- */

describe('导入导出', () => {
  it('导出 → 导入往返一致', () => {
    const g = gridFromRows(['0110', '1001', '0110', '1001']);
    const back = parseGrid(exportGrid(g));
    expect(back.size).toBe(g.size);
    expect([...back.cells]).toEqual([...g.cells]);
  });

  it('支持行数组 JSON 与纯文本两种导入', () => {
    const a = parseGrid('["0110","1001","0110","1001"]');
    const b = parseGrid('0110\n1001\n0110\n1001');
    expect([...a.cells]).toEqual([...b.cells]);
    expect(a.size).toBe(4);
  });

  it('拒绝非法输入', () => {
    expect(() => parseGrid('')).toThrow();
    expect(() => parseGrid('010\n101\n010')).toThrow(); // 边长 < 4
    expect(() => parseGrid('0120\n1001\n0110\n1001')).toThrow(); // 非法字符
    expect(() => parseGrid('0110\n101\n0110\n1001')).toThrow(); // 行长不一
    expect(() => parseGrid('{"size":5,"rows":["0110","1001","0110","1001"]}')).toThrow(); // size 不符
  });
});
