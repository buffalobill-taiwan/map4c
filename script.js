const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const blocksInput = document.getElementById('blocksInput');
const generateBtn = document.getElementById('generateBtn');
const resetBtn = document.getElementById('resetBtn');
const undoBtn = document.getElementById('undoBtn');
const info = document.getElementById('info');
const autoColorBtn = document.getElementById('autoColorBtn');
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
let celebrated = false;
let autoWasUsed = false;
let particles = [];
let confettiAnimId = null;
let mapW = 0, mapH = 0;
let autoColoring = false;
let autoColorTimer = null;
let autoColorPhase = 'pick';
let autoColorTarget = -1;
let autoColorC1 = null;
let autoColorC2 = null;
let autoColorChain = [];
let autoColorChainIdx = 0;
let autoColorSwapPlan = [];
let chainHighlight = null;

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

  if (hoveredCell !== null && selectedColor !== null && selectedColor < 4 && cellColors[hoveredCell] !== COLORS[selectedColor]) {
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

  if (hoveredCell !== null && selectedColor === 4 && cellColors[hoveredCell] !== null) {
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    traceCellPath(hoveredCell);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (chainHighlight) {
    ctx.save();
    ctx.strokeStyle = '#ff6600';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    for (const i of chainHighlight) {
      ctx.beginPath();
      traceCellPath(i);
      ctx.stroke();
    }
    ctx.restore();
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

  if (particles.length > 0) {
    for (const p of particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x + PAD, p.y + PAD);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
}

function handleCanvasClick(e) {
  if (autoColoring || selectedColor === null || currentCells.length === 0) return;

  const mx = e.offsetX;
  const my = e.offsetY;

  const hit = cellAtPoint(mx, my);
  if (hit === null) return;

  if (selectedColor === 4) {
    if (cellColors[hit] === null) return;
    undoStack.push(cellColors.slice());
    if (undoStack.length > 50) undoStack.shift();
    undoBtn.disabled = false;
    cellColors[hit] = null;
    info.textContent = '';
    drawFull();
    updateCursor(hit);
    return;
  }

  const colorName = COLORS[selectedColor];

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
  checkCompletion();
}

function cellAtPoint(mx, my) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < currentCells.length; i++) {
    ctx.beginPath();
    traceCellPath(i);
    if (ctx.isPointInPath(mx, my)) { ctx.restore(); return i; }
  }
  ctx.restore();
  return null;
}

function handleMouseMove(e) {
  if (autoColoring || currentCells.length === 0) return;

  const mx = e.offsetX;
  const my = e.offsetY;

  const hit = cellAtPoint(mx, my);

  if (hit !== hoveredCell) {
    hoveredCell = hit;
    drawFull();
  }

  updateCursor(hit);
}

function updateCursor(hit) {
  if (selectedColor !== null && hit !== null) {
    if (selectedColor === 4) {
      canvas.style.cursor = cellColors[hit] !== null ? 'pointer' : 'not-allowed';
      return;
    }
    const cn = COLORS[selectedColor];
    if (cellColors[hit] === cn) { canvas.style.cursor = ''; return; }
    for (const n of adjList[hit]) {
      if (cellColors[n] === cn) { canvas.style.cursor = 'not-allowed'; return; }
    }
    canvas.style.cursor = 'pointer';
  } else {
    canvas.style.cursor = '';
  }
}

function undo() {
  if (autoColoring || undoStack.length === 0) return;
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
    updateCursor(hoveredCell);
    drawFull();
  }
}

function resetColors() {
  stopAutoColor();
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

function findKempeChain(starts, c1, c2) {
  const visited = new Set(starts);
  const stack = [...starts];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of adjList[cur]) {
      if (!visited.has(n) && cellColors[n] !== null && (cellColors[n] === c1 || cellColors[n] === c2)) {
        visited.add(n);
        stack.push(n);
      }
    }
  }
  return visited;
}

function stopAutoColor() {
  if (autoColorTimer !== null) {
    clearTimeout(autoColorTimer);
    autoColorTimer = null;
  }
  chainHighlight = null;
  if (autoColoring) {
    autoColorBtn.textContent = '自動著色';
    drawFull();
  }
  autoColoring = false;
  autoColorPhase = 'pick';
  setButtonsDisabled(false);
}

function setButtonsDisabled(disabled) {
  generateBtn.disabled = disabled;
  resetBtn.disabled = disabled;
  undoBtn.disabled = disabled || undoStack.length === 0;
}

function autoColorNext() {
  if (!autoColoring) return;

  switch (autoColorPhase) {
    case 'pick': {
      let target = -1;
      let bestSat = -1;
      let bestDeg = -1;
      for (let i = 0; i < cellColors.length; i++) {
        if (cellColors[i] !== null) continue;
        const colors = new Set();
        for (const n of adjList[i]) {
          if (cellColors[n] !== null) colors.add(cellColors[n]);
        }
        const sat = colors.size;
        const deg = adjList[i].size;
        if (sat > bestSat || (sat === bestSat && deg > bestDeg)) {
          bestSat = sat;
          bestDeg = deg;
          target = i;
        }
      }
      if (target === -1) {
        stopAutoColor();
        info.textContent = '自動著色完成';
        return;
      }

      autoColorTarget = target;

      const used = new Set();
      for (const n of adjList[target]) {
        if (cellColors[n] !== null) used.add(cellColors[n]);
      }

      if (used.size < 4) {
        for (const c of COLORS) {
          if (!used.has(c)) {
            cellColors[target] = c;
            break;
          }
        }
        drawFull();
        autoColorTimer = setTimeout(autoColorNext, 200);
        return;
      }

      let found = false;
      for (const c1 of COLORS) {
        for (const c2 of COLORS) {
          if (c1 === c2) continue;
          const starts = [...adjList[target]].filter(n => cellColors[n] === c1);
          if (starts.length === 0) continue;

          const chain = findKempeChain(starts, c1, c2);

          const conflicted = [...adjList[target]].some(n => {
            if (cellColors[n] === null) return false;
            const after = chain.has(n) ? (cellColors[n] === c1 ? c2 : c1) : cellColors[n];
            return after === c1;
          });

          if (!conflicted) {
            autoColorC1 = c1;
            autoColorC2 = c2;
            autoColorChain = [...chain];
            autoColorSwapPlan = autoColorChain.map(idx => ({
              idx,
              newColor: cellColors[idx] === c1 ? c2 : c1
            }));
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        let bestColor = COLORS[0];
        let bestConflicts = Infinity;
        for (const c of COLORS) {
          let conflicts = 0;
          for (const n of adjList[target]) {
            if (cellColors[n] === c) conflicts++;
          }
          if (conflicts < bestConflicts) {
            bestConflicts = conflicts;
            bestColor = c;
            if (bestConflicts === 0) break;
          }
        }
        cellColors[target] = bestColor;
        drawFull();
        autoColorTimer = setTimeout(autoColorNext, 200);
        return;
      }

      autoColorPhase = 'show_chain';
      chainHighlight = new Set(autoColorChain);
      info.textContent = '發現 Kempe Chain（' + autoColorChain.length + ' 個區塊）';
      drawFull();
      autoColorTimer = setTimeout(autoColorNext, 400);
      return;
    }

    case 'show_chain': {
      autoColorPhase = 'swap_chain';
      autoColorChainIdx = 0;
      chainHighlight = null;
      info.textContent = 'Kempe Chain 顏色交換中…';
      drawFull();
      autoColorTimer = setTimeout(autoColorNext, 200);
      return;
    }

    case 'swap_chain': {
      if (autoColorChainIdx < autoColorSwapPlan.length) {
        const { idx, newColor } = autoColorSwapPlan[autoColorChainIdx];
        cellColors[idx] = newColor;
        drawFull();
        autoColorChainIdx++;
        if (autoColorChainIdx < autoColorSwapPlan.length) {
          autoColorTimer = setTimeout(autoColorNext, 200);
        } else {
          autoColorPhase = 'color_target';
          autoColorTimer = setTimeout(autoColorNext, 200);
        }
      }
      return;
    }

    case 'color_target': {
      cellColors[autoColorTarget] = autoColorC1;
      info.textContent = '自動著色中…';
      drawFull();
      autoColorPhase = 'pick';
      autoColorTimer = setTimeout(autoColorNext, 200);
      return;
    }
  }
}

function autoColor() {
  if (autoColoring) {
    stopAutoColor();
    info.textContent = '自動著色已中止';
    return;
  }

  resetColors();

  if (currentCells.length === 0) {
    info.textContent = '請先產生地圖';
    return;
  }

  autoColoring = true;
  autoWasUsed = true;
  autoColorPhase = 'pick';
  chainHighlight = null;
  autoColorBtn.textContent = '中止';
  setButtonsDisabled(true);
  selectedColor = null;
  hoveredCell = null;
  canvas.style.cursor = '';
  colorBtns.forEach(b => b.classList.remove('active'));
  info.textContent = '自動著色中…';
  drawFull();
  autoColorTimer = setTimeout(autoColorNext, 200);
}

function generate() {
  stopAutoColor();
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
    celebrated = false;
    autoWasUsed = false;
    selectedColor = null;
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
  celebrated = false;
  autoWasUsed = false;
  selectedColor = null;
  hoveredCell = null;
  canvas.style.cursor = '';
  colorBtns.forEach(b => b.classList.remove('active'));
  drawFull();
  selectColor(0);

  const count = cells.length;
  info.textContent = count < N
    ? `已產生 ${count} 個區塊（可再按一次重新產生，或減少區塊數）`
    : `${count} 個區塊 — 選擇顏色後點擊區塊著色`;
}

function checkCompletion() {
  if (celebrated || autoWasUsed) return;
  for (const c of cellColors) {
    if (!c) return;
  }
  celebrated = true;
  playFanfare();
  startConfetti();
}

function playFanfare() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 587.33, 659.25, 783.99];
    const times = [0, 0.12, 0.24, 0.44];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ac.currentTime + times[i]);
      gain.gain.linearRampToValueAtTime(0.25, ac.currentTime + times[i] + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + times[i] + 0.2);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(ac.currentTime + times[i]);
      osc.stop(ac.currentTime + times[i] + 0.2);
    });
    setTimeout(() => ac.close(), 1000);
  } catch (_) {}
}

function cellCenter(i) {
  const poly = currentCells[i];
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

function startConfetti() {
  particles = [];
  const confettiColors = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f'];
  for (let i = 0; i < currentCells.length; i++) {
    if (!cellColors[i]) continue;
    const c = cellCenter(i);
    const count = 5 + Math.floor(Math.random() * 6);
    for (let j = 0; j < count; j++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x: c.x, y: c.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: 4 + Math.random() * 5,
        color: confettiColors[Math.floor(Math.random() * 4)],
        alpha: 1,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3
      });
    }
  }
  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  updateConfetti();
}

function updateConfetti() {
  let alive = false;
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1;
    p.rot += p.rotV;
    p.alpha -= 0.008;
    if (p.alpha > 0) alive = true;
  }
  if (alive) {
    drawFull();
    confettiAnimId = requestAnimationFrame(updateConfetti);
  } else {
    particles = [];
    drawFull();
    confettiAnimId = null;
  }
}

canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', () => {
  if (autoColoring) return;
  if (hoveredCell !== null) {
    hoveredCell = null;
    canvas.style.cursor = '';
    drawFull();
  }
});
document.addEventListener('wheel', (e) => {
  if (autoColoring || currentCells.length === 0) return;
  e.preventDefault();
  if (selectedColor === null) {
    selectColor(e.deltaY < 0 ? 4 : 0);
  } else {
    const dir = e.deltaY < 0 ? -1 : 1;
    selectColor((selectedColor + dir + 5) % 5);
  }
}, { passive: false });
colorBtns.forEach((btn, i) => btn.addEventListener('click', () => selectColor(i)));
resetBtn.addEventListener('click', resetColors);
undoBtn.addEventListener('click', undo);
generateBtn.addEventListener('click', generate);
autoColorBtn.addEventListener('click', autoColor);

generate();
