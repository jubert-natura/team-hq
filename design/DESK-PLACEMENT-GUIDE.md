# Place and rotate desks

Open **Headquarters → Edit layout**, or **Layout editor** in the sidebar.

1. Choose the desk assigned to a bot.
2. Drag the desk or its ✥ handle. X/Y, nudge buttons and arrow keys provide precise positioning; Shift + arrow moves ten units.
3. Use **Rotate left** or **Rotate right**, or select one of the four **Desk direction** views.
4. Adjust **Desk size (%)** when needed.
5. Choose **Save layout**. The assigned bot and chair automatically align with the new desk and facing direction.

Only the desk changes in the editor. Bots and chairs stay at their saved positions until Save. The green Seat marker previews the target. Actor positioning is automatic; there is no separate drag-bot control.

**Undo** reverses a draft change. **Reset selected** previews that desk's default placement; save to apply it. **Cancel edits** discards the draft. **Fit room** and zoom help with placement. Drag snapping uses an eight-unit grid when enabled.

Automatic seating currently snaps to the target after Save. Animated walking, pathfinding and sit/stand transitions remain in the Claude handoff. This visual seating does not establish an AI connection or run a task.

Positions and perspective persist in the existing owner-only bot store. New edits use `layout.auto_seat: true`; the seat derives from the desk transform. Existing manual layouts remain readable. Legacy bot/chair XY calibration is ignored when automatic seating is enabled.
