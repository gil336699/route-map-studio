// The print on a plain tee, at its real size on an adult large (about 21 in across the chest).
import { useMemo } from 'react'

export function ShirtPreview({ svg, color, widthMm, heightMm }: { svg: string; color: string; widthMm: number; heightMm: number }) {
  const href = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg])
  const u = 574 / 21
  const w = (widthMm / 25.4) * u
  const h = (heightMm / 25.4) * u
  const body = 'M390 62 Q500 92 610 62 L770 105 Q862 150 938 258 L846 398 L782 350 L787 1032 Q500 1050 213 1032 L218 350 L154 398 L62 258 Q138 150 230 105 Z'
  const light = isLight(color)
  return (
    <svg className="shirt-preview" viewBox="0 0 1000 1080" role="img" aria-label="The print on the back of a T-shirt">
      <defs>
        <linearGradient id="tee-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <path d={body} fill={color} stroke={light ? '#cfcfcb' : 'none'} strokeWidth={3} />
      <path d="M390 62 Q500 92 610 62" fill="none" stroke={light ? '#c6c6c1' : '#000'} strokeOpacity={light ? 1 : 0.35} strokeWidth={10} strokeLinecap="round" />
      <image href={href} x={500 - w / 2} y={150} width={w} height={h} />
      <path d={body} fill="url(#tee-shade)" />
    </svg>
  )
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16)
  if (!Number.isFinite(n)) return true
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.6
}
