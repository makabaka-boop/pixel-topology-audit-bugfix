import {
  analyze,
  cloneGrid,
  createGrid,
  exportGrid,
  findHoleRemovals,
  parseGrid,
  MAX_SIZE,
  MIN_SIZE,
  type Analysis,
  type FlipCandidate,
  type Grid,
} from './topology';

/* ---------- 状态 ---------- */

let grid: Grid = createGrid(16);
let analysis: Analysis = analyze(grid);
let brushValue: 0 | 1 = 1;
const overlays = { black: false, holes: true, exterior: false };
let candidates: FlipCandidate[] | null = null;
let selected = -1;
let previewGrid: Grid | null = null;
let previewAnalysis: Analysis | null = null;

/* ---------- DOM ---------- */

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`缺少元素 #${id}`);
  return e as T;
}

const canvas = el<HTMLCanvasElement>('board');
const ctxMaybe = canvas.getContext('2d');
if (!ctxMaybe) throw new Error('无法创建 2D 上下文');
const ctx: CanvasRenderingContext2D = ctxMaybe;

const BOARD_CSS_PX = 560;
const dpr = Math.max(1, window.devicePixelRatio || 1);
canvas.width = BOARD_CSS_PX * dpr;
canvas.height = BOARD_CSS_PX * dpr;
canvas.style.width = `${BOARD_CSS_PX}px`;
canvas.style.height = `${BOARD_CSS_PX}px`;

/* ---------- 画布绘制 ---------- */

function hueFor(id: number, salt: number): string {
  return `hsla(${(id * 67 + salt) % 360}, 75%, 45%, 0.38)`;
}

function fillCellAt(i: number, n: number, cell: number): void {
  const r = Math.floor(i / n);
  const c = i % n;
  ctx.fillRect(c * cell, r * cell, cell, cell);
}

function labelCellAt(i: number, id: number, n: number, cell: number): void {
  const r = Math.floor(i / n);
  const c = i % n;
  ctx.fillText(String(id), (c + 0.5) * cell, (r + 0.55) * cell);
}

function draw(): void {
  const g = previewGrid ?? grid;
  const a = previewAnalysis ?? analysis;
  const n = g.size;
  const cell = canvas.width / n;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 底图：黑格 / 白格
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      ctx.fillStyle = g.cells[r * n + c] === 1 ? '#232323' : '#ffffff';
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  // 可切换蒙层：精确到格点的集合
  if (overlays.exterior) {
    ctx.fillStyle = 'rgba(66, 133, 244, 0.30)';
    for (const w of a.whiteRegions) {
      if (!w.touchesBorder) continue;
      for (const i of w.cells) fillCellAt(i, n, cell);
    }
  }
  if (overlays.holes) {
    for (const h of a.holes) {
      ctx.fillStyle = hueFor(h.id, 200);
      for (const i of h.cells) fillCellAt(i, n, cell);
    }
  }
  if (overlays.black) {
    for (const reg of a.blackRegions) {
      ctx.fillStyle = hueFor(reg.id, 20);
      for (const i of reg.cells) fillCellAt(i, n, cell);
    }
  }

  // 网格线
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = Math.max(1, dpr * 0.5);
  ctx.beginPath();
  for (let k = 0; k <= n; k++) {
    ctx.moveTo(0, k * cell);
    ctx.lineTo(canvas.width, k * cell);
    ctx.moveTo(k * cell, 0);
    ctx.lineTo(k * cell, canvas.height);
  }
  ctx.stroke();

  // 连通域编号（格子足够大时逐格标注）
  if (cell >= 15 * dpr) {
    ctx.font = `${Math.floor(cell * 0.42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (overlays.black) {
      ctx.fillStyle = '#ffffff';
      for (const reg of a.blackRegions) for (const i of reg.cells) labelCellAt(i, reg.id, n, cell);
    }
    if (overlays.holes) {
      ctx.fillStyle = '#7a1800';
      for (const h of a.holes) for (const i of h.cells) labelCellAt(i, h.id, n, cell);
    }
    if (overlays.exterior) {
      ctx.fillStyle = '#0b3d91';
      for (const w of a.whiteRegions) {
        if (!w.touchesBorder) continue;
        for (const i of w.cells) labelCellAt(i, w.id, n, cell);
      }
    }
  }

  // 翻转候选标记
  if (candidates) {
    for (let k = 0; k < candidates.length; k++) {
      const cand = candidates[k];
      ctx.beginPath();
      ctx.arc((cand.col + 0.5) * cell, (cand.row + 0.5) * cell, Math.max(2 * dpr, cell * 0.14), 0, Math.PI * 2);
      ctx.fillStyle = k === selected ? '#d00000' : '#ff8c00';
      ctx.fill();
    }
  }
  if (candidates && selected >= 0) {
    const cand = candidates[selected];
    ctx.strokeStyle = '#d00000';
    ctx.lineWidth = 2 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(cand.col * cell + dpr, cand.row * cell + dpr, cell - 2 * dpr, cell - 2 * dpr);
    ctx.setLineDash([]);
  }
}

/* ---------- 统计面板 ---------- */

function tableHtml(head: string[], rows: string[][]): string {
  if (rows.length === 0) return '<div class="empty">（无）</div>';
  const th = head.map((h) => `<th>${h}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><tr>${th}</tr>${trs}</table>`;
}

function renderStats(): void {
  const a = analysis;
  const metrics = el('metrics');
  metrics.innerHTML = '';
  const items: Array<[string, number]> = [
    ['黑域数', a.blackCount],
    ['孔洞数', a.holeCount],
    ['欧拉数', a.euler],
    ['黑格总数', a.blackArea],
  ];
  for (const [k, v] of items) {
    const div = document.createElement('div');
    div.className = 'metric';
    const ks = document.createElement('span');
    ks.className = 'k';
    ks.textContent = k;
    const vs = document.createElement('span');
    vs.className = 'v';
    vs.textContent = String(v);
    div.append(ks, vs);
    metrics.appendChild(div);
  }
  el('regions').innerHTML = tableHtml(
    ['#', '面积', '周长'],
    a.blackRegions.map((r) => [String(r.id), String(r.area), String(r.perimeter)]),
  );
  el('holes').innerHTML = tableHtml(
    ['#', '面积'],
    a.holes.map((h) => [String(h.id), String(h.area)]),
  );
}

/* ---------- 候选列表与差异预览 ---------- */

function renderCandidates(): void {
  const box = el('candidate-list');
  box.innerHTML = '';
  if (!candidates) {
    box.textContent = '（尚未扫描；任何涂画都会使旧结果失效）';
    return;
  }
  if (candidates.length === 0) {
    box.textContent = '没有能恰好消去一个孔且保持黑域数不变的单格翻转。';
    return;
  }
  candidates.forEach((cand, k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cand' + (k === selected ? ' sel' : '');
    btn.textContent = `(${cand.row}, ${cand.col}) ${cand.toBlack ? '白→黑' : '黑→白'}  孔 ${cand.holesBefore}→${cand.holesAfter}  黑域 ${cand.blackBefore}→${cand.blackAfter}`;
    btn.addEventListener('click', () => selectCandidate(k));
    box.appendChild(btn);
  });
}

function fmtDelta(d: number): string {
  return d > 0 ? `+${d}` : String(d);
}

function holeAreas(a: Analysis): string {
  return a.holes.map((h) => h.area).join(', ') || '—';
}

function regionAreas(a: Analysis): string {
  return a.blackRegions.map((r) => r.area).join(', ') || '—';
}

function renderDiff(): void {
  const p = previewAnalysis;
  if (!p) return;
  const b = analysis;
  const numRow = (name: string, x: number, y: number): string[] =>
    [name, String(x), String(y), fmtDelta(y - x)];
  const rows: string[][] = [
    numRow('黑域数', b.blackCount, p.blackCount),
    numRow('孔洞数', b.holeCount, p.holeCount),
    numRow('欧拉数', b.euler, p.euler),
    numRow('黑格总数', b.blackArea, p.blackArea),
    ['孔洞面积', holeAreas(b), holeAreas(p), ''],
    ['黑域面积', regionAreas(b), regionAreas(p), ''],
  ];
  el('diff-table').innerHTML = tableHtml(['指标', '当前', '翻转后', 'Δ'], rows);
  const cand = candidates?.[selected];
  el('preview-pos').textContent = cand
    ? `(${cand.row}, ${cand.col}) ${cand.toBlack ? '白→黑' : '黑→白'}`
    : '';
}

function selectCandidate(k: number): void {
  if (!candidates) return;
  selected = k;
  const cand = candidates[k];
  previewGrid = cloneGrid(grid);
  const i = cand.row * grid.size + cand.col;
  previewGrid.cells[i] = previewGrid.cells[i] === 1 ? 0 : 1;
  previewAnalysis = analyze(previewGrid);
  el('preview-panel').classList.remove('hidden');
  renderDiff();
  renderCandidates();
  draw();
}

function clearPreview(): void {
  previewGrid = null;
  previewAnalysis = null;
  selected = -1;
  el('preview-panel').classList.add('hidden');
}

function scan(): void {
  candidates = findHoleRemovals(grid, analysis);
  clearPreview();
  renderCandidates();
  draw();
}

function confirmPreview(): void {
  if (!previewGrid) return;
  grid = previewGrid;
  analysis = analyze(grid);
  scan(); // 改写后拓扑已变，自动重扫
}

function onGridChanged(): void {
  analysis = analyze(grid);
  renderStats();
  renderCandidates();
  draw();
}

/* ---------- 笔刷交互 ---------- */

let painting = false;
let strokeValue: 0 | 1 = 1;

function eventCell(e: PointerEvent): { r: number; c: number } | null {
  const rect = canvas.getBoundingClientRect();
  const n = grid.size;
  const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
  const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
  if (r < 0 || c < 0 || r >= n || c >= n) return null;
  return { r, c };
}

function setCell(r: number, c: number, v: 0 | 1): void {
  const i = r * grid.size + c;
  if (grid.cells[i] === v) return;
  grid.cells[i] = v;
  onGridChanged();
}

canvas.addEventListener('pointerdown', (e) => {
  if (previewGrid) return; // 预览期间禁止涂画，先确认或取消
  const pos = eventCell(e);
  if (!pos) return;
  painting = true;
  strokeValue = e.button === 2 ? 0 : brushValue;
  canvas.setPointerCapture(e.pointerId);
  setCell(pos.r, pos.c, strokeValue);
});

canvas.addEventListener('pointermove', (e) => {
  updateHover(e);
  if (!painting || previewGrid) return;
  const pos = eventCell(e);
  if (!pos) return;
  setCell(pos.r, pos.c, strokeValue);
});

window.addEventListener('pointerup', () => {
  painting = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => {
  el('hover-info').textContent = '—';
});

function updateHover(e: PointerEvent): void {
  const pos = eventCell(e);
  const box = el('hover-info');
  if (!pos) {
    box.textContent = '—';
    return;
  }
  const g = previewGrid ?? grid;
  const a = previewAnalysis ?? analysis;
  const i = pos.r * g.size + pos.c;
  if (g.cells[i] === 1) {
    const id = a.blackLabels[i];
    const reg = a.blackRegions[id];
    box.textContent = `(${pos.r}, ${pos.c}) 黑 · 黑域 #${id} · 面积 ${reg.area} · 周长 ${reg.perimeter}`;
  } else {
    const id = a.whiteLabels[i];
    const w = a.whiteRegions[id];
    box.textContent = `(${pos.r}, ${pos.c}) 白 · ${w.touchesBorder ? `外部白域 #${id}` : `孔洞 #${id}`} · 面积 ${w.area}`;
  }
}

/* ---------- 导入 / 导出 ---------- */

function ioMsg(text: string, isErr: boolean): void {
  const m = el('io-msg');
  m.textContent = text;
  m.className = isErr ? 'err' : 'ok';
}

/* ---------- 控件绑定 ---------- */

const sizeSelect = el<HTMLSelectElement>('size-select');
for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
  const opt = document.createElement('option');
  opt.value = String(n);
  opt.textContent = String(n);
  if (n === 16) opt.selected = true;
  sizeSelect.appendChild(opt);
}
sizeSelect.addEventListener('change', () => {
  grid = createGrid(Number(sizeSelect.value));
  onGridChanged();
});

el<HTMLSelectElement>('brush-select').addEventListener('change', (e) => {
  brushValue = Number((e.target as HTMLSelectElement).value) as 0 | 1;
});

el('clear-btn').addEventListener('click', () => {
  grid = createGrid(grid.size);
  onGridChanged();
});

function bindOverlay(id: string, key: keyof typeof overlays): void {
  el<HTMLInputElement>(id).addEventListener('change', (e) => {
    overlays[key] = (e.target as HTMLInputElement).checked;
    draw();
  });
}
bindOverlay('ov-black', 'black');
bindOverlay('ov-holes', 'holes');
bindOverlay('ov-exterior', 'exterior');

el('scan-btn').addEventListener('click', scan);
el('confirm-btn').addEventListener('click', confirmPreview);
el('cancel-btn').addEventListener('click', () => {
  clearPreview();
  renderCandidates();
  draw();
});

el('export-btn').addEventListener('click', () => {
  el<HTMLTextAreaElement>('io-text').value = exportGrid(grid);
  ioMsg('已导出 JSON 到文本框。', false);
});

el('import-btn').addEventListener('click', () => {
  try {
    grid = parseGrid(el<HTMLTextAreaElement>('io-text').value);
    sizeSelect.value = String(grid.size);
    onGridChanged();
    ioMsg(`导入成功：${grid.size}×${grid.size}`, false);
  } catch (err) {
    ioMsg(`导入失败：${(err as Error).message}`, true);
  }
});

/* ---------- 初始化 ---------- */

onGridChanged();
