# AGENTS.md

## Tech stack

Vanilla HTML + CSS + JS. No framework, no bundler, no package.json, no dependencies.

## Entrypoints

- `index.html` — loads `style.css` and `<script src="script.js">`
- `script.js` — all logic: Voronoi map generation, Canvas rendering, coloring interaction
- `style.css` — layout and UI styling

## Dev preview

```bash
python3 -m http.server 8081
```

Or open `index.html` directly via `file://` (no server needed).

## Deploy

Push to `master` on `origin` → auto-deploys to GitHub Pages at `https://buffalobill-taiwan.github.io/map4c/`.

## Key implementation details

- **Voronoi via half-plane clipping** — `generateSeeds` / `computeCells` / `clipPolygon`
- **Bezier curved edges** — internal edges use quadratic Bezier curves (`CURVE_FACTOR = 0.22`, max offset 30px); boundary edges stay straight
- **Retina** — `devicePixelRatio` scaling in `drawFull`
- **Edge dedup** — floating-point rounded to 3 decimals → string key → Set (`edgeKey`)
- **Adjacency** — `edgeToCells` Map built during dedup, populates `adjList`
- **Hit detection** — `ctx.isPointInPath()` on click/mousemove
- **Undo** — `push(cellColors.slice())` before each color change, `pop()` on undo (capped at 50)
- **Scroll wheel** — `document.addEventListener('wheel', ...)` cycles colors globally (up=previous, down=next)
- **Completion celebration** — all cells colored → `playFanfare()` (Web Audio triangle wave C5→D5→E5→G5, 120ms each) + confetti particles via `requestAnimationFrame`
- **Eraser** — `selectedColor === 4`, click skips conflict check, sets cell to `null`; only affects colored cells (uncolored cells show `not-allowed` cursor)
- **Hover overlay** — normal colors show 30% translucent fill on colorable cells; eraser shows 35% white overlay on colored cells only
- **SeededRandom** — `hash(edgeKey + 'curve') % 10000 / 10000` for deterministic curve offsets across redraws

## Commit conventions

Commit messages are in Traditional Chinese (zh-TW). No convention beyond that.

## Git

Remote: `https://github.com/buffalobill-taiwan/map4c.git`
