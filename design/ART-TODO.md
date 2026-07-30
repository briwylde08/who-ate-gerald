# Art to-do

Drop finished files in `packages/app/public/characters/` (any name — they
get cropped to a 96px round icon / 512px portrait and the original moves
here to `design/`). Wiring per icon is a one-line `icon:` field in
`packages/app/src/lib/profile.ts`.

## Wanted
Nothing outstanding — all eight characters have icons and portraits.

## Done — icons
Baker (loaf) · Midwife (candle) · Grave Digger (grey headstone, v2;
design/grave-icon.png is the retired gold one) · Drunk (tankard) ·
Poacher (bow + arrow) · Rat Catcher (rat) · Beekeeper (bee) ·
Lamplighter (torch)

## Done — other art
- Site background: design/werebear-background.png → public/bg.jpg
  (scrim in styles.css controls how visible it is)
- Favicon + apple-touch-icon: design/favicon-source.png → public/favicon.png
  (snarling bear with crescent moon, 256px)

## Notes
- Portraits: square sources crop best (the Lamplighter portrait is
  portrait-ratio and gets center-cropped). Poacher uses the
  moonlit-with-deer variant — full-body, so he reads smaller than the
  close-up portraits; Patrick to weigh in.
- Icons: keep the subject large and centered in frame. Thin diagonal
  subjects (the bow) need a tight crop or they turn to mush at 20px.
