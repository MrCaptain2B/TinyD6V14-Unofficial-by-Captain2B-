# Tiny D6 (Foundry v14) — unofficial fork

Unofficial fork of the [Tiny D6](https://gitlab.com/architech99/foundry-tinyd6) system for **Foundry VVT v14**, maintained by Captain2B.

Built on top of the original system (Tiny Dungeon, Tiny Frontiers & co.) with an expanded token HUD, extra homebrew (TinyD6+) and cosmetic themes.

## Features over the original

- **Token HUD** with HP/condition steppers, weapon palette, armor editor and death chips.
- **Death & defeat mechanics** (rounds left, death save threshold, tinted tokens, optional variable death die).
- **TinyD6+ homerule**: weapon reload/charges, ammo, one-shot weapons, crit modes, armor HP & stacking, mastered weapon slots.
- **Player damage proxy** via socketlib (players can apply damage themselves if enabled by the GM).
- **World settings reload**: changing a world rule reloads the client so the rule is guaranteed to apply.
- **5 sheet styles** (default, minimal, parchment/пергамент, noir, cyberpunk) + dark theme by default.
- **Russian translation**; all other original translations kept intact.
- **Formula support** in death-rounds fields (e.g. `1d6+2`), skill thresholds configurable.
- Chat buttons (apply damage / undo resource / confirm heal & stabilization) work in the chat log **and** in floating `#chat-notifications`.

## Dev

```bash
npm ci          # install build deps (only needed to compile scss)
npm run build:css   # compiles scss/tinyd6.scss -> css/tinyd6.css (minified)
```

CSS is a build artifact — edit `scss/` and rebuild. See `.github/workflows/release.yml` for packaging.

## License

MIT (inherited from the original system).