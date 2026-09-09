# Release Notes

## 14.0.5

- Death-rounds fields (world + hero sheet) accept formulas like `1d6+2` instead of a fixed number.
- Chat-card buttons now work in the floating notifications (`#chat-notifications`), not only in the chat log.
- Fixed `game.actors.update is not a function` crash on setup.
- Fixed "Вернуть ресурс" (revert ammunition) button being repeatedly clickable.
- Fixed damage bonus (`damageBonus` on hero sheet) not being applied to attack cards.
- Changing a world rule now auto-reloads the client (debounced).
- Packaged with GitHub Actions; release archive is minified and excludes build cruft.

## 14.0.x (earlier)

- Foundry v14 compatibility (system id `tinyd6v14`).
- Token HUD: HP/condition steppers, weapon palette, armor editor, death chips.
- Death & defeat state machine, optional variable death die, token tint on death.
- TinyD6+ homerule: reload/charges, ammo types, master weapons, armor HP/stacking, crit modes.
- 5 sheet styles (default, minimal, parchment, noir, cyberpunk).
- Russian translation.

---

## 12.6.x (original, upstream)

- 12.6.2 — French translation
- 12.6.1 — German translation
- 12.6.0 — Foundry 12 compatibility
- v0.1.0 — initial public beta