# 開發筆記

## 流程守則

- **每次 push 前**必須更新 README.md 與 AGENT.md

## 本機預覽

```bash
python3 -m http.server 8081
```

或直接於瀏覽器開啟 `index.html`（無需 server）。

## 專案資訊

- **名稱**: 四色定理教學地圖產生器
- **技術**: 純 HTML + CSS + JS（無框架、無依賴）
- **核心**: Voronoi 分割（半平面裁剪法）+ Canvas 繪圖
- **檔案**: `index.html` / `style.css` / `script.js`

## 實作細節

- 種子最小間距: `√(面積 × 0.35 / N)`
- 曲線偏移量: `min(邊長 × 0.22, 30px)`
- 最小區塊面積: `面積 × 0.3 / N`，低於 300px² 時提示
- 使用 `devicePixelRatio` 處理 Retina 顯示
- 邊界去重使用浮點數四捨五入 key + Set
- 著色使用 `seededRandom(edgeKey)` 確保曲線跨重繪一致
- 鄰接圖透過邊緣去重階段的 `edgeToCells` Map 建立
- 點擊偵測使用 `ctx.isPointInPath()`
- hover 預覽使用 `globalAlpha = 0.3` 半透明疊加
- 滑鼠滾輪切換顏色：上滾前一色、下滾後一色
- 衝突檢測遍歷 `adjList[i]`，若相鄰同色則拒絕著色並顯示 `not-allowed` 游標
- 上一步功能：每次著色成功前 `push(cellColors.slice())`，undo 時 `pop()` 還原，保留選色
- 完成慶祝：`checkCompletion()` 檢查 `cellColors` 全部非 null，觸發撒花 + Web Audio 上行音階
  - 撒花粒子：從各區塊中心隨機噴發，重力加速 + 旋轉 + 淡出，`requestAnimationFrame` 驅動
  - 音效：`OscillatorNode(triangle)` 依序播放 C5→D5→E5→G5，每音 120ms
