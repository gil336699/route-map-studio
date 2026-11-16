// Place: find the area, set the map's centre and width, and download the map data.
import { useState } from 'react'
import type { Doc } from '../../lib/doc'
import { MAX_KM, MIN_KM } from '../../lib/doc'
import { searchPlace, type PlaceResult } from '../../lib/nominatim'
import { LAYER_NAMES, LAYER_ORDER, type LayerId } from '../../map/types'
import { Btn, Group, NumberBox, Row, Switch, TextField } from '../Controls'

interface Props {
  doc: Doc
  edit: (fn: (d: Doc) => Doc) => void
  loaded: { counts: Record<LayerId, number>; places: number; ms: number } | null
  loading: boolean
  covered: boolean
  onDownload: () => void
  onPickPlace: (p: PlaceResult) => void
  /** Buildings on or off: downloads them when the map in view has none. */
  onBuildings: (on: boolean) => void
}

export function PlacePanel({ doc, edit, loaded, loading, covered, onDownload, onPickPlace, onBuildings }: Props) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const f = doc.frame
  const setFrame = (patch: Partial<Doc['frame']>) => edit((d) => ({ ...d, frame: { ...d.frame, ...patch } }))

  const search = async () => {
    if (!q.trim()) return
    setSearching(true)
    setMessage('')
    try {
      const r = await searchPlace(q)
      setResults(r)
      if (!r.length) setMessage('No places found. Try a street, a park or a city.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not search.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      <Group title="Find a place" hint="Search for a park, a street or a city. Then the map downloads by itself.">
        <div className="field-row">
          <TextField value={q} onChange={setQ} onEnter={search} label="Place to search for" placeholder="Philadelphia Museum of Art" tip="Type a place, then press Enter." />
          <Btn tip="Search OpenStreetMap for this place." onClick={search} disabledReason={!q.trim() ? 'Type a place to search for first.' : searching ? 'Searching…' : undefined}>
            {searching ? 'Searching…' : 'Search'}
          </Btn>
        </div>
        {message ? <p className="hint">{message}</p> : null}
        {results && results.length ? (
          <ul className="results">
            {results.map((r) => (
              <li key={`${r.lon},${r.lat}`}>
                <button type="button" className="result" onClick={() => { onPickPlace(r); setResults(null) }} data-tip={`Centre the map here, ${r.widthKm} km across, and download it.`}>
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Group>

      <Group title="Map area" hint="Drag the map to move it. Scroll or pinch to zoom.">
        <Row label="Centre, latitude" tip="North to south position of the middle of the map, in degrees.">
          <NumberBox value={f.centerLat} onCommit={(v) => setFrame({ centerLat: v })} min={-85} max={85} decimals={5} label="Centre latitude" tip="Degrees north. Press Enter to apply." suffix="°" />
        </Row>
        <Row label="Centre, longitude" tip="East to west position of the middle of the map, in degrees.">
          <NumberBox value={f.centerLon} onCommit={(v) => setFrame({ centerLon: v })} min={-180} max={180} decimals={5} label="Centre longitude" tip="Degrees east; west is negative. Press Enter to apply." suffix="°" />
        </Row>
        <Row label="Width on the ground" tip="How much of the real world the print shows from side to side.">
          <NumberBox value={f.widthKm} onCommit={(v) => setFrame({ widthKm: v })} min={MIN_KM} max={MAX_KM} decimals={2} label="Map width in km" tip={`${MIN_KM} to ${MAX_KM} km. Smaller is closer in.`} suffix="km" />
        </Row>
      </Group>

      <Group title="Map data" hint="Streets, paths, water, parks and landmarks come from OpenStreetMap, free to use with credit.">
        <Switch
          label="Buildings"
          checked={doc.buildings}
          onChange={onBuildings}
          tip="Adds building outlines, downloading them if the map has none yet. Busy at shirt size, and a much larger download."
        />
        <div className="field-row">
          <Btn variant={covered && loaded ? undefined : 'primary'} tip={loaded ? 'Download the newest map for the area the page shows, plus a margin.' : 'Download the map for the area the page shows, plus a margin. A copy saved in this browser is used when there is one.'}
            onClick={onDownload} disabledReason={loading ? 'Downloading now. Wait for it to finish, or stop it in the bar below.' : undefined}>
            {loaded ? 'Download again' : 'Download map'}
          </Btn>
        </div>
        {loaded ? (
          <p className="hint">
            {LAYER_ORDER.filter((id) => loaded.counts[id] > 0).map((id) => `${loaded.counts[id].toLocaleString()} ${LAYER_NAMES[id].toLowerCase()}`).join(', ')}
            {`, ${loaded.places} landmarks. Took ${(loaded.ms / 1000).toFixed(1)} s.`}
            {!covered ? ' The page now shows more than was downloaded: download again to fill it.' : ''}
          </p>
        ) : null}
      </Group>
    </>
  )
}
