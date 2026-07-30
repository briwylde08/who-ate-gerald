# Art to-do

Drop finished files in `packages/app/public/characters/` (any name — they
get cropped to a 96px round icon / 512px portrait and the original moves
here to `design/`). Wiring per icon is a one-line `icon:` field in
`packages/app/src/lib/profile.ts`.

## Wanted
Nothing outstanding.

## Still on emoji (icon welcome any time)
Poacher 🏹 · Beekeeper 🐝 · Rat Catcher 🐀 · Lamplighter 🔦

## Done
Baker (loaf) · Midwife (candle) · Grave Digger (grey headstone, v2 —
design/grave-icon.png is the retired gold one) · Drunk (tankard)

## Notes
- Portraits: square sources crop best (the Lamplighter is portrait-ratio
  and gets center-cropped). Poacher currently uses the moonlit-with-deer
  variant — full-body, so he reads smaller than the close-up portraits;
  Patrick to weigh in.
- Icons: subjects centered in frame crop cleanly; the grey vignette in
  the AI-generated icons gets cropped away, so keep the subject large.
