// Real units for the page size. Illustrator counts pixels at 72 per inch, so px here means 1/72 in.
export type Unit = 'mm' | 'in' | 'pt' | 'px'

export const UNITS: Unit[] = ['mm', 'in', 'pt', 'px']

const MM_PER: Record<Unit, number> = { mm: 1, in: 25.4, pt: 25.4 / 72, px: 25.4 / 72 }

export const toMm = (value: number, unit: Unit): number => value * MM_PER[unit]
export const fromMm = (mm: number, unit: Unit): number => mm / MM_PER[unit]

export function formatUnit(mm: number, unit: Unit): string {
  const v = fromMm(mm, unit)
  const digits = unit === 'in' ? 2 : unit === 'mm' ? 1 : 0
  return String(Number(v.toFixed(digits)))
}

export interface SizePreset {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

const inch = (w: number, h: number): Pick<SizePreset, 'widthMm' | 'heightMm'> => ({ widthMm: w * 25.4, heightMm: h * 25.4 })

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'back-12x14', label: 'T-shirt back, 12 × 14 in', ...inch(12, 14) },
  { id: 'back-14x16', label: 'T-shirt back, 14 × 16 in', ...inch(14, 16) },
  { id: 'front-10x12', label: 'T-shirt front, 10 × 12 in', ...inch(10, 12) },
  { id: 'pocket-4x4', label: 'Pocket, 4 × 4 in', ...inch(4, 4) },
  { id: 'letter', label: 'Letter, 8.5 × 11 in', ...inch(8.5, 11) },
  { id: 'a4', label: 'A4, 210 × 297 mm', widthMm: 210, heightMm: 297 },
  { id: 'square-300', label: 'Square, 300 × 300 mm', widthMm: 300, heightMm: 300 },
]
