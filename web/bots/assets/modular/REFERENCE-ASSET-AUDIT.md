# Reference asset audit — 21 October 2026

The six supplied reference screens were checked: Isometric AI Headquarters, Team overview, Learning history, Task history, Performance and Reports. The core missing reusable scene items now have Higgsfield artwork. Some perspective consistency and layered animation work still require implementation; this pack does not make the existing dashboard animated by itself.

## Headquarters scene

| Reference element | Coverage | Integration instruction |
| --- | --- | --- |
| Fixed sofa, coffee table, windows, wall art, rear meeting table/chairs, shelving and perimeter plants | Existing `office-empty.png` | Keep in decorative perimeter. Do not repeat the whole background when adding bots. |
| Expandable center floor | `floor-texture.png`; optional `floor-tile.png` | Repeat opaque material on a mathematically projected floor; clip around fixed scenery. |
| Desk, screens, keyboard, tabletop books/plant and attached panel | `desk-views.png`, four cells | Reuse by station. Preserve size and stable slot IDs as the world grows. |
| Chair perspective — previously missing | NEW `chair-views.png`, four cells | Match chair direction to seated bot and desk. Tune scale/pelvis anchor. |
| Sitting and typing — previously missing | NEW `robot-seated.png`, sixteen cells | Four views × idle, blink, typing A and typing B. Legs are bent; chair is separate. |
| Standing, blinking, work gestures and walking | `robot-actions.png`, twenty-four cells | Use documented front/rear plus mirror mapping. Foot placement varies slightly between frames. |
| Central shared work table — previously missing | NEW `scene-support.png`, row 0 | Four generated variants. Laptop is present only in rear cells; use an overlay or correction if exact continuity is required. |
| “You” owner avatar with coffee — previously missing | NEW `scene-support.png`, row 1 | Generic stylized adult, static poses. Two front cells are near duplicates; mirror the usable front pose if needed. |
| Movable low cubicle divider/bookshelf — previously missing | NEW `scene-support.png`, row 2 | Front/back variants. Partition cells are nearly straight-on; fit perspective before placement. |
| Reusable small/tall plants and lavender/coral rugs — previously missing | NEW `scene-support.png`, row 3 | Reuse as separate props, with floor rugs sorted underneath furniture. |
| Extra desk seating/meeting chairs | Reuse `chair-views.png`; rear meeting chairs remain in backdrop | No per-bot regeneration needed. |
| Distinct role faces/portraits | Existing `../bot-portraits.png`; reusable robot family | Use labels/badges for role identity. Additional skins are optional. |

## Other five screens and overlay controls

These reference details should be rendered as UI, using the existing icon system or SVG/CSS: navigation icons, Team Bot branding, status dots/chips, owner initials, notifications, task/review icons, selected-station outlines, labels, zoom controls, timelines, cards, tables, metrics, checkboxes and charts. They do not require more generated raster art. Provider marks should use appropriate existing brand assets when needed.

The selected bot's monitor/task preview should show its real task output or an explicitly labeled demo preview. A generated picture must not be used as proof of completed work.

Light/dark mode should use the supplied theme tokens for UI. The daylight artwork can be shared between themes with a restrained scene tint. A separately illustrated night office is optional.

## Work still needed in Claude

1. Compose floor → rug → station/furniture → character → foreground occluders, using projected depth and per-view masks. Chair backs and desk fronts are not separately segmented source assets; create controlled masks/clip paths. Verify the pelvis meets the chair seat and hands meet the keyboard in every view.
2. Tune per-frame anchors and scale before production animation. The generated sheets are discrete views, not rigged 3D models. Exact table/prop quarter-turn consistency is not guaranteed; mappings describe actual output.
3. Drive blinking/typing/walking from an animation state machine with reduced-motion support. Only show real “working” states when runtime events verify them; keep sample motion labeled demo.
4. Keep the outer UI and decorative perimeter fixed while the central world expands. Allocate stable slots from bot IDs, and reuse the same desk/chair/character atlases when bots are added.
5. If smooth sit-down/stand-up, turning between directions, waving, celebration or owner walking is later required, those transition/action frames are **not in this pack**. They are optional additional artwork rather than blockers for idle/typing/walk cycles.

## Validation and handoff

Ten original PNGs are included, with 64 nonempty cells across five atlases. The three new sheets have real alpha channels and were checked against ivory and near-black backgrounds. `atlas.json` records source rectangles, initial bounds/anchors and known limitations; `generation-record.json` records all prompts and confirmed Higgsfield jobs. Ten modular jobs were quoted at one credit each.

Only the isolated asset pack and inspection pages were updated. The main dashboard renderer has not been changed, committed, pushed or deployed as part of this asset audit.
