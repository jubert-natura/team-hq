# Reusable Team Bot assets — Claude handoff

All PNG artwork in this folder was generated through Higgsfield on 21 October 2026 (Asia/Manila). These are separate layers and sprite sheets, not a replacement screenshot of the dashboard. Originals are unchanged. Open `asset-preview.html` to inspect reuse and animation without changing saved bot records.

## Scene structure

Keep the navigation, header, detail panel and decorative office perimeter fixed. Put a scrollable/pannable **world** inside the center viewport. Give that world its own width and height, which grow from the active bot roster. Adding a bot must allocate another desk slot and extend the world; it must not stretch the sidebar or scale every existing desk down.

Use `office-empty.png` as a fixed decorative room reference/backdrop. It includes an opaque floor: do **not** repeat the entire office image. Use `floor-texture.png` as the repeating center floor material and project/clip it to mathematically generated floor geometry. This keeps tile size and joins under code control. `floor-tile.png` is an optional isolated diamond sprite/reference, not the preferred repeat texture: its generated diamond is approximate, so do not assume exact 2:1 geometry or pixel-perfect joins.

For an isometric grid: x = originX + (column - row) × tileWidth / 2; y = originY + (column + row) × tileHeight / 2. Increase row/column capacity as bots are added. Sort station/character depth by projected foot y. Keep stable slot IDs so existing bots do not jump around when a new one is created.

## Asset inventory

| File | Purpose |
| --- | --- |
| office-empty.png | Empty room/backdrop; no bots or workstations |
| floor-texture.png | Opaque ivory material for repeating center floor |
| floor-tile.png | Transparent diamond floor reference/optional tile |
| desk-base.png | Single transparent desk, retained as source reference |
| desk-views.png | One 2 × 2 transparent desk atlas: four views |
| robot-idle.png | Single transparent full-body robot, retained as source reference |
| robot-actions.png | One 4 × 6 transparent robot atlas: 24 cells |
| chair-views.png | One 2 × 2 transparent chair atlas: front and rear views |
| robot-seated.png | One 4 × 4 seated robot atlas: idle, blink and two typing frames per view |
| scene-support.png | One 4 × 4 prop atlas: shared table, owner, partitions, shelves, plants and rugs |

Read `REFERENCE-ASSET-AUDIT.md` for the full comparison against all six reference screens. The current isolated world preview demonstrates standing sprites; seated composition and scene props are supplied for Claude to integrate. `atlas-inspector.html` displays the three newest sheets and an animated seated sample on light/dark backgrounds.

The seated sheet is 2048 × 2048 with 512-pixel cells. Columns are front-left, front-right, rear-right and rear-left. Rows are idle, blink, typing A and typing B. CSS background-size is 400% 400%. Chair cells are 1024 pixels, ordered front-left/front-right on top and rear-right/rear-left below. Use a pelvis-to-seat anchor as well as a foot anchor. Chair backs/armrests and desk fronts need per-direction occlusion masks; their pieces are not separate source layers.

The support sheet has 512-pixel cells. Row 0 contains table variants; row 1 owner views; row 2 partition front/back and bookshelf front/back; row 3 small plant, tall plant, lavender rug and coral rug. Front table cells omit the laptop, while rear cells include it; the two front owner views are very similar. These are useful variants rather than exact quarter-turn reconstructions. Partition fronts are nearly straight-on and need perspective fitting before scene placement. Preserve the actual mappings in `atlas.json` rather than assuming the prompt was followed perfectly.

The desk sheet is 2048 × 2048; each cell is 1024 × 1024. Top row contains the two front views; bottom row contains the two rear views. CSS background-size is 200% 200%.

The robot sheet is 1360 × 2048, four columns and six rows. Cell width is 340. Row boundaries are 0, 341, 683, 1024, 1365, 1707, 2048 (rounded). CSS background-size is 400% 600%; use the exact rectangles in `atlas.json` for canvas rendering.

Robot rows (zero based): 0 idle/open eyes; 1 blink; 2 work A; 3 work B; 4 walk A; 5 walk B. The generated sheet repeats very similar front views in columns 0/1 and rear views in columns 2/3. For four clearly distinct logical directions, use column 0 and column 2 plus a horizontal mirror of each. `atlas.json` specifies this mapping. This is a discrete sprite system, not a continuously rotatable 3D model.

Start with idle/breathing at a subtle amplitude, blink briefly every few seconds, and switch work/walk rows at about 5–7 frames per second. Preserve a consistent foot anchor; generated frames have small variations, so use per-cell bounds/anchors and visually tune offsets before treating the atlas as a polished animation. Support reduced motion. Work animation must be labeled demo/manual until a verified runtime connection exists.

Reuse the same sprite sheet and desk sheet for many bot instances. Each instance has its own ID, name, role, avatar/badge color, slot, direction and action. Do not generate another sprite sheet just because the roster grows. Make another sheet only when a genuinely different character style is wanted. Preserve existing task history on bot archive.

## Validation and generation record

Transparent PNGs have a real alpha channel; they were composited against ivory and near-black for visual inspection. Some image viewers display hidden RGB data outside the alpha mask as colored glow; do not flatten that RGB into the scene. Render the original PNG with normal source-over alpha blending.

`atlas.json` contains dimensions, cell rectangles, initial anchors and confirmed generation IDs. `generation-record.json` retains the exact prompts. Ten successful modular asset jobs were quoted at 1 credit each (10 credits total); the early single assets are retained as references. This total excludes the earlier full office scene and portrait sheet. All 64 atlas cells contain visible content. PNGs retain their original generated bytes.

The assets are ready for integration. They have not replaced the dashboard's existing Headquarters renderer. This handoff makes no claim that the app already supports dynamic bot creation, pathfinding or live bot execution.
