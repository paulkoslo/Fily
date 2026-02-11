# Desktop app assets

Put icons and other graphics for the desktop app here.

## Icons (`icons/`)

- **macOS**: Put **`icon.icns`** in `icons/`. Used as the app icon and in the Dock.
  - You can generate `.icns` from a 1024×1024 PNG using macOS:
    - Create an `icon.iconset` folder with the required sizes, or
    - Use: `iconutil -c icns icon.iconset` (see Apple’s docs), or an online converter.
- **Windows** (optional): Add **`icon.ico`** for the Windows build.
- **Linux** (optional): A 512×512 **`icon.png`** is enough; electron-builder can generate other sizes.

To use your icon in the built app, add `"icon": "assets/icons/icon.icns"` under `build.mac` and `"buildResources": "assets"` under `build.directories` in `apps/desktop/package.json`. If no icon is configured, the build uses the default Electron icon.

## Other graphics

Use `assets/` for any other images or resources used by the desktop app (e.g. installer backgrounds, splash art). Keep icons in `icons/` for clarity.
