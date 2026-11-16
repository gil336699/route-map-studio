import { describe, expect, it } from 'vitest'
import { waitingCard, type Waiting } from './waiting'
import { LAYER_ORDER, type LayerId } from '../map/types'

const layers = (n: number) => Object.fromEntries(LAYER_ORDER.map((id) => [id, id === 'minor' ? n : 0])) as Record<LayerId, number>
const base: Waiting = { downloading: false, preparing: null, loadedMapId: null, shown: { mapId: 0, byLayer: layers(0) } }

describe('the card over the print', () => {
  it('says the first map is downloading', () => {
    expect(waitingCard({ ...base, downloading: true })).toBe('Downloading the map…')
    expect(waitingCard({ ...base, downloading: true, shown: null })).toBe('Downloading the map…')
  })
  it('stays up after the download until a picture with the map arrives', () => {
    // The download is done, but the picture on screen was drawn before it: the print is still blank.
    expect(waitingCard({ ...base, loadedMapId: 1 })).toBe('Drawing the map…')
    expect(waitingCard({ ...base, loadedMapId: 1, shown: null })).toBe('Drawing the map…')
    expect(waitingCard({ ...base, loadedMapId: 1, shown: { mapId: 1, byLayer: layers(40) } })).toBeNull()
  })
  it('does not wait forever where the new map has nothing to draw', () => {
    // Every layer turned off, or open sea: the picture from the newest map is blank, and that is the answer.
    expect(waitingCard({ ...base, loadedMapId: 1, shown: { mapId: 1, byLayer: layers(0) } })).toBeNull()
  })
  it('shows what the app is getting ready, even over a map', () => {
    const preparing = 'Drawing the example route…'
    expect(waitingCard({ ...base, loadedMapId: 1, preparing })).toBe(preparing)
    expect(waitingCard({ ...base, loadedMapId: 1, preparing, shown: { mapId: 1, byLayer: layers(40) } })).toBe(preparing)
  })
  it('leaves an older map in view while a newer one downloads or is drawn', () => {
    const old = { mapId: 1, byLayer: layers(40) }
    expect(waitingCard({ ...base, downloading: true, loadedMapId: 1, shown: old })).toBeNull()
    expect(waitingCard({ ...base, loadedMapId: 2, shown: old })).toBeNull()
  })
  it('says a download is running when the page has moved off the older map', () => {
    expect(waitingCard({ ...base, downloading: true, loadedMapId: 1, shown: { mapId: 1, byLayer: layers(0) } })).toBe('Downloading the map…')
  })
  it('shows no card when nothing is happening', () => {
    expect(waitingCard(base)).toBeNull()
    expect(waitingCard({ ...base, shown: null })).toBeNull()
  })
})
