// Units and text measures shared by everything that draws on the page.

export const MM_PER_PT = 25.4 / 72
export const KM_PER_MI = 1.609344
/** The smallest text a printer will hold: 8 pt, in mm. */
export const MIN_TEXT_MM = 8 * MM_PER_PT

/** Rough width of a line of bold capitals, for layout. Digits and full stops are narrower, CJK wider. */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code >= 0x2e80 ? 1 : ch === '.' || ch === ' ' || ch === '·' ? 0.3 : /[0-9]/.test(ch) ? 0.58 : ch === 'M' || ch === 'W' ? 0.86 : 0.66
  }
  return w * size
}
