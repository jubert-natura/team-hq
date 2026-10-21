# Headquarters layout editor

> Superseded by [Desk placement guide](DESK-PLACEMENT-GUIDE.md). The current editor moves and rotates desks only; bots align automatically after Save. The text below records the earlier manual-part editor.

Open **Headquarters → Edit layout**, or choose **Layout editor** in the sidebar.

1. Choose the bot under **Workstation**, or click its name/handle in the room.
2. Choose **Whole workstation** to reposition its complete desk setup. Drag the artwork or its ✥ handle. For precise placement, use X/Y, nudge buttons, or arrow keys while the canvas/handle is focused. Shift + arrow moves 10 office units.
3. Choose **Bot only**, **Chair only**, **Desk only**, **Rug only**, or **Name label** for independent offsets. Sprite parts also have a size control from 50% to 175%. Position values for these parts are offsets from the station's default placement.
4. Choose one of four **Perspective** views to change the station's desk, chair and bot direction together. These are discrete sprite views.
5. Choose **Save layout** to keep the result. It appears in Headquarters and survives a restart.

**Undo** reverses the last draft edit. **Reset selected** previews the bot's default desk position, view, component sizes and offsets; save to keep the reset. **Cancel edits** discards the draft and returns to Headquarters. Navigation within the workspace retains an unfinished draft for that dataset. Reloading with unsaved edits prompts the browser before leaving; drafts themselves are not written until Save.

**Fit room** shows the available canvas; higher zoom levels provide detailed alignment. Scroll the canvas to reach its edges. Animations are paused while aligning. Drag snapping uses an 8-unit grid when enabled; the nudge step is independent.

Positions stay attached to each bot ID and desk slot. Adding another bot preserves existing manual positions. Off/archived bot configuration and task history are unaffected. Archived bots must be restored before editing their layout. Overlaps are allowed so the owner can fine-tune the scene; the editor does not automatically arrange or resolve collisions.

Real saves use the existing owner-only bot store and one atomic `/api/bots/layout` request. Demo edits stay in memory. Invalid batches never partially save. No AI/tool connection or new artwork is required.

Also fixed: the owner's sprite scale and position offset had the same configuration key, causing an invalid sprite size. They now use separate settings so the “You” avatar appears.

Validation: all 32 bot tests passed. Browser checks verified whole-station drag, nudge and undo, cancel without saving, independent bot offset/size, save and reload, and reset to defaults. Browser checks used an isolated preview store. No production vault or team records were edited during verification.
