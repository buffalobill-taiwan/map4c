const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const blocksInput = document.getElementById('blocksInput');
const generateBtn = document.getElementById('generateBtn');
const info = document.getElementById('info');

const PAD = 20;
const LINE_W = 1.8;
const CURVE_FACTOR = 0.22;

function pt(x, y) { return { x, y }; }
function sub(a, b) { return pt(a.x - b.x, a.y - b.y); }
function add(a, b) { return pt(a.x + b.x, a.y + b.y); }
function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

function drawMap(cells, W, H) {
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawn = new Set();

  for (const cell of cells) {
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i];
      const b = cell[(i + 1) % cell.length];
      const key = edgeKey(a, b);
      if (drawn.has(key)) continue;
      drawn.add(key);

      const bound = isOnBoundary(a, b, W, H);
      const ta = pt(a.x + PAD, a.y + PAD);
      const tb = pt(b.x + PAD, b.y + PAD);

      ctx.beginPath();
      ctx.moveTo(ta.x, ta.y);

      if (bound) {
        ctx.lineTo(tb.x, tb.y);
      } else {
        const dx = b.x - a.x, dy = b.y - a.y;
        const edgeLen = len(sub(b, a));
        const maxOff = Math.min(edgeLen * CURVE_FACTOR, 30);
        if (maxOff > 2) {
          const nx = -dy / edgeLen, ny = dx / edgeLen;
          const off = (Math.random() * 2 - 1) * maxOff;
          const cx = clamp((a.x + b.x) / 2 + nx * off, 0, W) + PAD;
          const cy = clamp((a.y + b.y) / 2 + ny * off, 0, H) + PAD;
          ctx.quadraticCurveTo(cx, cy, tb.x, tb.y);
        } else {
          ctx.lineTo(tb.x, tb.y);
        }
      }
      ctx.stroke();
    }
  }
}

function generate() {
  let W = clamp(parseInt(widthInput.value) || 600, 50, 3000);
  let H = clamp(parseInt(heightInput.value) || 400, 50, 3000);
  let N = clamp(parseInt(blocksInput.value) || 1, 1, 500);

  widthInput.value = W;
  heightInput.value = H;
  blocksInput.value = N;

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
  drawMap(cells, W, H);

  const count = cells.length;
  if (count < N) {
    info.textContent = `已產生 ${count} 個區塊（可再按一次重新產生，或減少區塊數）`;
  } else {
    info.textContent = `${count} 個區塊 — 列印後即可手動著色`;
  }
}

generateBtn.addEventListener('click', generate);
generate();
