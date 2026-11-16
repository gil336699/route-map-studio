// Saving and opening files in the browser. Saving uses the system save dialog where the browser offers
// one, and a download otherwise.

interface SavePicker {
  showSaveFilePicker?: (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
    createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>
  }>
}

export type SaveResult = 'saved' | 'downloaded' | 'cancelled'

export async function saveFile(blob: Blob, name: string, description: string, accept: Record<string, string[]>): Promise<SaveResult> {
  const picker = (window as unknown as SavePicker).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description, accept }] })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
      return 'saved'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Not allowed here (for example inside a frame), so fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 20000)
  return 'downloaded'
}

/** Ask for a file. Resolves null if the user cancels. */
export function openFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Most pixels a PNG export makes, so a huge page cannot run the browser out of memory. */
export const MAX_PNG_PIXELS = 60_000_000

export function pngSize(widthMm: number, heightMm: number, dpi: number): { w: number; h: number; dpi: number } {
  let d = dpi
  const px = (mm: number) => Math.round((mm / 25.4) * d)
  while (px(widthMm) * px(heightMm) > MAX_PNG_PIXELS && d > 72) d = Math.floor(d * 0.85)
  return { w: px(widthMm), h: px(heightMm), dpi: d }
}

/** Draw the SVG into a PNG at a given resolution. */
export async function svgToPng(svg: string, widthMm: number, heightMm: number, dpi: number): Promise<{ blob: Blob; dpi: number }> {
  const size = pngSize(widthMm, heightMm, dpi)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot draw a PNG.')
    ctx.drawImage(img, 0, 0, size.w, size.h)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('The PNG could not be made. Try a lower resolution.')
    return { blob, dpi: size.dpi }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const readText = (file: File) => file.text()
