const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const blocksInput = document.getElementById('blocksInput');
const generateBtn = document.getElementById('generateBtn');
const resetBtn = document.getElementById('resetBtn');
const undoBtn = document.getElementById('undoBtn');
const info = document.getElementById('info');
const colorBtns = document.querySelectorAll('.color-btn');

const PAD = 20;
const LINE_W = 1.8;
const CURVE_FACTOR = 0.22;
const COLORS = ['red', 'blue', 'green', 'yellow'];
const COLOR_MAP = { red: '#e74c3c', blue: '#3498db', green: '#27ae60', yellow: '#f1c40f' };

let currentCells = [];
let cellColors = [];
let adjList = [];
let selectedColor = null;
let hoveredCell = null;
let undoStack = [];
let mapW = 0, mapH = 0;

function pt(x, y) { return { x, y }; }
function sub(a, b) { return pt(a.x - b.x, a.y - b.y); }
function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function seededRandom(key) {
  return (hash(key + 'curve') % 10000) / 10000;
}

function generateSeeds(W, H, N) {
  const minDist = Math.sqrt(W * H * 0.35 / N);
  const margin = minDist * 0.3;
  const seeds = [];
  let attempts = 0;
  const maxAttempts = Math.max(N * 150, 2000);
  while (seeds.length < N && attempts < maxAttempts) {
    const x = margin + Math.random() * (W - 2 * margin);
    const y = margin + Math.random() * (H - 2 * margin);
    let ok = true;
    for (const s of seeds) {
      if (len(sub(pt(x, y), s)) < minDist) { ok = false; break; }
    }
    if (ok) seeds.push(pt(x, y));
    attempts++;
  }
  return seeds;
}

function clipPolygon(poly, si, sj) {
  const dx = sj.x - si.x;
  const dy = sj.y - si.y;
  const c = (sj.x * sj.x + sj.y * sj.y - si.x * si.x - si.y * si.y) / 2;
  const f = (p) => p.x * dx + p.y * dy - c;

  if (poly.length === 0) return [];

  const out = [];
  let prev = poly[poly.length - 1];
  let prevF = f(prev);

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const currF = f(curr);

    if (prevF * currF < 0) {
      const t = -prevF / (currF - prevF);
      out.push(pt(prev.x + t * (curr.x - prev.x), prev.y + t * (curr.y - prev.y)));
    }

    if (currF <= 0) {
      out.push(curr);
    }

    prev = curr;
    prevF = currF;
  }

  return out;
}

function computeCells(sites, W, H) {
  const cells = [];
  for (let i = 0; i < sites.length; i++) {
    let poly = [pt(0, 0), pt(W, 0), pt(W, H), pt(0, H)];
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      poly = clipPolygon(poly, sites[i], sites[j]);
      if (poly.length < 3) break;
    }
    if (poly.length >= 3) cells.push(poly);
  }
  return cells;
}

function edgeKey(a, b) {
  const x1 = Math.round(a.x * 1000), y1 = Math.round(a.y * 1000);
  const x2 = Math.round(b.x * 1000), y2 = Math.round(b.y * 1000);
  const ka = x1 + ',' + y1, kb = x2 + ',' + y2;
  return ka < kb ? ka + '-' + kb : kb + '-' + ka;
}

function isOnBoundary(a, b, W, H) {
  const onTop = Math.abs(a.y) < 0.5 && Math.abs(b.y) < 0.5;
  const onBottom = Math.abs(a.y - H) < 0.5 && Math.abs(b.y - H) < 0.5;
  const onLeft = Math.abs(a.x) < 0.5 && Math.abs(b.x) < 0.5;
  const onRight = Math.abs(a.x - W) < 0.5 && Math.abs(b.x - W) < 0.5;
  return onTop || onBottom || onLeft || onRight;
}

function getEdgeControl(a, b) {
  const key = edgeKey(a, b);
  const ka = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`;
  const kb = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`;
  const from = ka < kb ? a : b;
  const to = ka < kb ? b : a;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const edgeLen = Math.sqrt(dx * dx + dy * dy);
  const maxOff = Math.min(edgeLen * CURVE_FACTOR, 30);
  if (maxOff <= 2) return null;

  const nx = -dy / edgeLen;
  const ny = dx / edgeLen;
  const r = seededRandom(key);
  const off = (r * 2 - 1) * maxOff;

  return {
    cx: clamp((from.x + to.x) / 2 + nx * off, 0, mapW),
    cy: clamp((from.y + to.y) / 2 + ny * off, 0, mapH)
  };
}

function traceCellPath(i) {
  const poly = currentCells[i];
  ctx.moveTo(poly[0].x + PAD, poly[0].y + PAD);

  for (let j = 0; j < poly.length; j++) {
    const a = poly[j];
    const b = poly[(j + 1) % poly.length];
    const bound = isOnBoundary(a, b, mapW, mapH);

    if (bound) {
      ctx.lineTo(b.x + PAD, b.y + PAD);
    } else {
      const cp = getEdgeControl(a, b);
      if (cp) {
        ctx.quadraticCurveTo(cp.cx + PAD, cp.cy + PAD, b.x + PAD, b.y + PAD);
      } else {
        ctx.lineTo(b.x + PAD, b.y + PAD);
      }
    }
  }
  ctx.closePath();
}

function drawEdge(a, b, bound) {
  ctx.beginPath();
  ctx.moveTo(a.x + PAD, a.y + PAD);

  if (bound) {
    ctx.lineTo(b.x + PAD, b.y + PAD);
  } else {
    const cp = getEdgeControl(a, b);
    if (cp) {
      ctx.quadraticCurveTo(cp.cx + PAD, cp.cy + PAD, b.x + PAD, b.y + PAD);
    } else {
      ctx.lineTo(b.x + PAD, b.y + PAD);
    }
  }
  ctx.stroke();
}

function drawFull() {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = (mapW + PAD * 2) + 'px';
  canvas.style.height = (mapH + PAD * 2) + 'px';
  canvas.width = (mapW + PAD * 2) * dpr;
  canvas.height = (mapH + PAD * 2) * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, mapW + PAD * 2, mapH + PAD * 2);

  for (let i = 0; i < currentCells.length; i++) {
    if (cellColors[i]) {
      ctx.fillStyle = COLOR_MAP[cellColors[i]];
      ctx.beginPath();
      traceCellPath(i);
      ctx.fill();
    }
  }

  if (hoveredCell !== null && selectedColor !== null && cellColors[hoveredCell] !== COLORS[selectedColor]) {
    const cn = COLORS[selectedColor];
    let conflict = false;
    for (const n of adjList[hoveredCell]) {
      if (cellColors[n] === cn) { conflict = true; break; }
    }
    if (!conflict) {
      ctx.fillStyle = COLOR_MAP[cn];
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      traceCellPath(hoveredCell);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.strokeStyle = '#000';
  ctx.lineWidth = LINE_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawn = new Set();
  for (const cell of currentCells) {
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i];
      const b = cell[(i + 1) % cell.length];
      const key = edgeKey(a, b);
      if (drawn.has(key)) continue;
      drawn.add(key);
      drawEdge(a, b, isOnBoundary(a, b, mapW, mapH));
    }
  }
}

function handleCanvasClick(e) {
  if (selectedColor === null || currentCells.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const sx = (mapW + PAD * 2) / rect.width;
  const sy = (mapH + PAD * 2) / rect.height;
  const mx = (e.clientX - rect.left) * sx;
  const my = (e.clientY - rect.top) * sy;

  const colorName = COLORS[selectedColor];

  const hit = cellAtPoint(mx, my);
  if (hit === null) return;

  if (cellColors[hit] === colorName) return;

  let conflict = false;
  for (const n of adjList[hit]) {
    if (cellColors[n] === colorName) { conflict = true; break; }
  }

  if (conflict) {
    info.textContent = '⚠ 相鄰區塊已有相同顏色，無法著色';
    return;
  }

  undoStack.push(cellColors.slice());
  if (undoStack.length > 50) undoStack.shift();
  undoBtn.disabled = false;

  cellColors[hit] = colorName;
  info.textContent = '';
  drawFull();
}

function cellAtPoint(mx, my) {
  for (let i = 0; i < currentCells.length; i++) {
    ctx.beginPath();
    traceCellPath(i);
    if (ctx.isPointInPath(mx, my)) return i;
  }
  return null;
}

function handleMouseMove(e) {
  if (currentCells.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const sx = (mapW + PAD * 2) / rect.width;
  const sy = (mapH + PAD * 2) / rect.height;
  const mx = (e.clientX - rect.left) * sx;
  const my = (e.clientY - rect.top) * sy;

  const hit = cellAtPoint(mx, my);

  if (hit !== hoveredCell) {
    hoveredCell = hit;
    drawFull();
  }

  if (selectedColor !== null && hit !== null) {
    const colorName = COLORS[selectedColor];
    if (cellColors[hit] === colorName) {
      canvas.style.cursor = '';
    } else {
      let conflict = false;
      for (const n of adjList[hit]) {
        if (cellColors[n] === colorName) { conflict = true; break; }
      }
      canvas.style.cursor = conflict ? 'not-allowed' : 'pointer';
    }
  } else {
    canvas.style.cursor = '';
  }
}

function undo() {
  if (undoStack.length === 0) return;
  cellColors = undoStack.pop();
  undoBtn.disabled = undoStack.length === 0;
  hoveredCell = null;
  canvas.style.cursor = '';
  info.textContent = '';
  drawFull();
}

function selectColor(idx) {
  selectedColor = selectedColor === idx ? null : idx;
  colorBtns.forEach((btn, i) => btn.classList.toggle('active', i === selectedColor));
  if (hoveredCell !== null) {
    drawFull();
  }
}

function resetColors() {
  cellColors.fill(null);
  undoStack = [];
  undoBtn.disabled = true;
  selectedColor = null;
  hoveredCell = null;
  canvas.style.cursor = '';
  colorBtns.forEach(b => b.classList.remove('active'));
  info.textContent = '';
  drawFull();
}

function generate() {
  let W = clamp(parseInt(widthInput.value) || 600, 50, 3000);
  let H = clamp(parseInt(heightInput.value) || 400, 50, 3000);
  let N = clamp(parseInt(blocksInput.value) || 1, 1, 500);

  widthInput.value = W;
  heightInput.value = H;
  blocksInput.value = N;

  mapW = W;
  mapH = H;

  if (N === 1) {
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = (W + PAD * 2) + 'px';
    canvas.style.height = (H + PAD * 2) + 'px';
    canvas.width = (W + PAD * 2) * dpr;
    canvas.height = (H + PAD * 2) * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W + PAD * 2, H + PAD * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = LINE_W;
    ctx.strokeRect(PAD, PAD, W, H);
    currentCells = [];
    cellColors = [];
    adjList = [];
    undoStack = [];
    undoBtn.disabled = true;
  hoveredCell = null;
  canvas.style.cursor = '';
    info.textContent = '1 個區塊 — 列印後即可手動著色';
    return;
  }

  const minCellArea = W * H * 0.3 / N;
  if (minCellArea < 300) {
    info.textContent = '區塊數量過大，每個區塊會太小，請減少數量或加大尺寸';
    return;
  }

  const seeds = generateSeeds(W, H, N);
  if (seeds.length < 2) {
    info.textContent = '無法放置種子點，請加大尺寸';
    return;
  }

  const cells = computeCells(seeds, W, H);

  const edgeToCells = new Map();
  for (let i = 0; i < cells.length; i++) {
    for (let j = 0; j < cells[i].length; j++) {
      const a = cells[i][j], b = cells[i][(j + 1) % cells[i].length];
      const key = edgeKey(a, b);
      if (!edgeToCells.has(key)) edgeToCells.set(key, []);
      edgeToCells.get(key).push(i);
    }
  }

  adjList = Array.from({ length: cells.length }, () => new Set());
  for (const indices of edgeToCells.values()) {
    if (indices.length === 2) {
      adjList[indices[0]].add(indices[1]);
      adjList[indices[1]].add(indices[0]);
    }
  }

  currentCells = cells;
  cellColors = new Array(cells.length).fill(null);
  undoStack = [];
  undoBtn.disabled = true;
  selectedColor = null;
  hoveredCell = null;
  canvas.style.cursor = '';
  colorBtns.forEach(b => b.classList.remove('active'));
  drawFull();

  const count = cells.length;
  info.textContent = count < N
    ? `已產生 ${count} 個區塊（可再按一次重新產生，或減少區塊數）`
    : `${count} 個區塊 — 選擇顏色後點擊區塊著色`;
}

canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', () => {
  if (hoveredCell !== null) {
    hoveredCell = null;
    canvas.style.cursor = '';
    drawFull();
  }
});
canvas.addEventListener('wheel', (e) => {
  if (currentCells.length === 0) return;
  e.preventDefault();
  if (selectedColor === null) {
    selectColor(e.deltaY < 0 ? 3 : 0);
  } else {
    const dir = e.deltaY < 0 ? -1 : 1;
    selectColor((selectedColor + dir + 4) % 4);
  }
}, { passive: false });
colorBtns.forEach((btn, i) => btn.addEventListener('click', () => selectColor(i)));
resetBtn.addEventListener('click', resetColors);
undoBtn.addEventListener('click', undo);
generateBtn.addEventListener('click', generate);

generate();
