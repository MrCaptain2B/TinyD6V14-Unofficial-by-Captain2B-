# Tiny D6 for Foundry VTT (Unofficial v14 fork by Captain2B)

**VERSION:** 14.0.1

Unofficial fork of the [Tiny D6](https://gitlab.com/architech99/foundry-tinyd6) system for **Foundry VTT v14**, maintained by Captain2B.

## What's different from the original

- **Improved token HUD** (`TinyD6TokenHUD`):
  - HP steppers (−/+ buttons around the HP value), fixed for Foundry v14 (`Math.clamp`, pointer-events)
  - Weapon palette with Attack / Reload buttons
  - Armor editor box (DR + Armor HP inputs) with proper sizing and positioning
  - Death chip (down / dying / dead states)
  - Widgets are positioned above and below the token so they don't cover it
- Fixed lowercase localization keys (`tinyd6.*`)
- Cleaned up CSS (single `tinyd6.css`, no leftover dead styles)

## Installation

In Foundry VTT: **Game Systems → Install System → Manifest URL**:

```
https://raw.githubusercontent.com/MrCaptain2B/TinyD6V14-Unofficial-by-Captain2B-/main/system.json
```

Alternatively, download the release ZIP from GitHub and place it in your `Data/systems/tinyd6v14/` folder.

## Compatibility

- Foundry VTT: **v14** (minimum 14, verified 14)
- World system id: `tinyd6v14`

## Development

CSS is built from SCSS:

```
npm install
npm run build:css
```

`node_modules` is gitignored — it is only needed for building.

## Credits

Original system authors: architech99, Chris Seieroe, ParvusDomus, pixelmonsta, Polski.
