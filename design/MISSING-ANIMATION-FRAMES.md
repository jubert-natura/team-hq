# Missing animation frames for walk-to-seat

The walk-to-seat animation (`web/bots/js/walk.js`, paths from `shared/bots-nav.js`) works with the current pack:
- **Walking:** the bot walks on `robot-actions.png` rows 4 and 5, using columns 0 and 2 plus horizontal mirrors.
- **Arriving:** it then cross-fades into `robot-seated.png`.

This file lists exactly what is missing for a smooth result, so ChatGPT can request it through Higgsfield in one batch. Nothing here is required for the current build to work. It is all visual polish and says nothing about AI execution.

## Requirements shared by every sheet

- **Character:** the same robot as `robot-actions.png` / `robot-seated.png`. Keep the teal accents (the app recolours with CSS hue-rotate), white shell, navy visor, cyan eyes and headphones.
- **Background:** a transparent PNG with a real alpha channel, with no chair, desk, floor, shadow or glow baked in.
- **Lighting and camera:** the same as the existing sheets (isometric, about 30° from above), at the same character scale as `robot-seated.png`.
- **Feet:** they must sit on one baseline row in every frame of a sequence.
- **Last seated frame:** it must match `robot-seated.png` row 0 for that direction, with the pelvis at the same pixel.
- **Columns:** use the seated sheet's direction order: front_left, front_right, rear_right, rear_left (`atlas.json` → `seated_robot_directions`).

## 1. Sit down (highest value), new file `robot-sit.png`

- **Size:** 2048 × 2048, a 4 × 4 grid of 512 px cells.
- **Columns:** the four directions above.
- **Rows:** the frames in order:
  0. Standing at the seat, facing the desk. This should read as the same pose as `robot-actions` row 0 for that heading.
  1. Knees starting to bend, hands reaching slightly forward.
  2. Half-seated: pelvis about halfway down, knees forward.
  3. Fully seated. This must be identical in pose and pelvis position to `robot-seated` row 0 for the same column.
- **Use:**
  - Played forwards at about 8 fps on arrival, replacing the current cross-fade.
  - Played backwards for standing up, so no separate stand-up sheet is needed.

## 2. Profile views for turning, new file `robot-turn.png`

- **Size:** 1360 × 1024, a 4 × 3 grid of 340 × 341 px cells, the same cell size as `robot-actions`.
- **Columns:**
  0. Facing screen-right (side profile, front shoulder toward the viewer).
  1. Facing screen-right, walk contact frame.
  2. Facing screen-right, walk passing frame.
  3. Facing screen-down, straight toward the viewer.
- **Rows:**
  0. Idle with open eyes.
  1. Blink.
  2. A second walk variant matching row 0's pose for blending.
- **Mirroring:** mirroring covers screen-left.
- **Use:** in-between frames when a path turns sharply. Walk headings currently jump between the down-right and up-left diagonals and their mirrors.

## 3. Four-frame walk cycle (optional), new file `robot-walk4.png`

- **Size:** 1360 × 682, a 4 × 2 grid of 340 × 341 px cells.
- **Rows:** 0 is the front diagonal (as `robot-actions` column 0); 1 is the rear diagonal (as column 2).
- **Columns:** contact (left foot forward), passing, contact (right foot forward), passing.
- **Mirroring:** mirrors cover the other two diagonals.
- **Use:** replaces the current two-frame walk (rows 4/5), which reads as a shuffle at walking speed.

## Not needed

- **Chairs, desks and rugs:** they already exist as separate layers (`chair-views.png`, `desk-views.png`, `scene-support.png`).
- **Stand-up:** play the sit-down sheet in reverse.
- **New colours:** use CSS hue-rotate from the character styles.
- **Owner walking, waving or celebrating:** out of scope until requested.
