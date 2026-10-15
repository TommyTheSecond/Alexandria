import levels from './shaded-library.json';
// Original ray-rendered exterior, represented by shaded ASCII cells.
// Both themes use the original image polarity: no filler or inverted shadows.
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';
export function asciiRows(source: string[]) {
const pixels = source.map(row => [...row].map(value => alphabet.indexOf(value)));
return pixels.map(row => {
  const runs: { tone: number; text: string }[] = [];
  row.forEach(tone => {
    // Quiet, consistent glyphs let sampled color carry the scene's volume.
    const glyph = tone < 0 ? ' ' : tone < 12 ? '@' : tone < 26 ? '#' : tone < 42 ? '+' : ':';
    const last = runs[runs.length - 1];
    if (last?.tone === tone) last.text += glyph;
    else runs.push({ tone, text: glyph });
  });
  return runs;
});
}
export const libraryShading = asciiRows(levels);
export const libraryPalette = Array.from({ length: 64 }, (_, n) => {
  const gray = Math.round(24 + (n / 63) * 210);
  return `rgb(${gray}, ${gray}, ${gray})`;
});
