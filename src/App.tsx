// Route Map Studio: the workspace. The print fills the window and the controls float in glass around it,
// in the order a designer works: place, route, look, text, export. The map engine runs in a worker.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog, HelpDialog, QuickStart, type ConfirmState } from './components/Dialogs'
import { Dock, type Status } from './components/Dock'
import { ExportPanel } from './components/panels/ExportPanel'
import { LookPanel } from './components/panels/LookPanel'
import { PlacePanel } from './components/panels/PlacePanel'
import { RoutePanel, type RouteOps } from './components/panels/RoutePanel'
import { TextPanel } from './components/panels/TextPanel'
import { PrintCheckCard } from './components/PrintCheckCard'
import { Tabs } from './components/Tabs'
import { TooltipLayer } from './components/Tooltip'
import { TopBar } from './components/TopBar'
import { Viewport, type Tool } from './components/Viewport'
import { applyLook, downloadBox, fitFrame, isCovered, lookIdOf, newDoc, nextRoute, uid, type Doc } from './lib/doc'
import { openFile, saveFile, svgToPng } from './lib/files'
import type { PlaceResult } from './lib/nominatim'
import { LOOKS, type Look } from './lib/presets'
import { parseProject, serializeProject } from './lib/project'
import { useEngine } from './lib/useEngine'
import { waitingCard } from './lib/waiting'
import { PLACE_ICON } from './map/places'
import { emptyRoute, routeFromTrack, undoPoint } from './map/route'
import { parseRouteFile } from './map/routefile'
import { mapFrame } from './map/scene'
import type { LonLat, Pin, Place, Route, RouteItem } from './map/types'
import type { EngineResponse } from './worker/messages'

type Tab = 'place' | 'route' | 'look' | 'text' | 'export'
type SceneRes = Extract<EngineResponse, { type: 'scene' }>
type LoadedRes = Extract<EngineResponse, { type: 'loaded' }>

const TABS: { id: Tab; label: string; tip: string }[] = [
  { id: 'place', label: 'Place', tip: 'Find the area and download its map.' },
  { id: 'route', label: 'Route', tip: 'Draw or import routes, and pick landmarks along them.' },
  { id: 'look', label: 'Look', tip: 'Colours, inks, shirt, layers and line weights.' },
  { id: 'text', label: 'Text', tip: 'Club name, distance and the key.' },
  { id: 'export', label: 'Export', tip: 'Print size and files for Illustrator.' },
]

const QUICKSTART_KEY = 'route-map-studio.quickstart.v1'

// The example: down the Parkway, across to the Schuylkill Banks and back up the river trail.
const EXAMPLE: LonLat[] = [
  [-75.1785, 39.9645], [-75.17423, 39.96099], [-75.16986, 39.95807], [-75.18349, 39.94897],
  [-75.18211, 39.95], [-75.17938, 39.95501], [-75.17924, 39.96013], [-75.18285, 39.96503],
]

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'route-map'

function seenQuickStart(): boolean {
  try {
    return localStorage.getItem(QUICKSTART_KEY) === '1'
  } catch {
    return true
  }
}

export default function App() {
  const call = useEngine()
  const [doc, setDoc] = useState<Doc>(newDoc)
  const [version, setVersion] = useState(0)
  const [savedVersion, setSavedVersion] = useState(0)
  const dirty = version !== savedVersion
  const edit = useCallback((fn: (d: Doc) => Doc) => {
    setDoc(fn)
    setVersion((v) => v + 1)
  }, [])
  const docRef = useRef(doc)
  useEffect(() => {
    docRef.current = doc
  })

  const [tab, setTab] = useState<Tab>('place')
  const [tool, setToolState] = useState<Tool>('move')
  const [follow, setFollow] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [scene, setScene] = useState<SceneRes | null>(null)
  const [loaded, setLoaded] = useState<LoadedRes | null>(null)
  const loadedRef = useRef(loaded)
  useEffect(() => {
    loadedRef.current = loaded
  })
  const [loadingSince, setLoadingSince] = useState<number | null>(null)
  const [loadingText, setLoadingText] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState<Status | null>(null)
  const [view, setView] = useState<'print' | 'shirt'>('print')
  const [dialog, setDialog] = useState<null | 'help' | 'quickstart'>(() => (seenQuickStart() ? null : 'quickstart'))
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [exporting, setExportingState] = useState<string | undefined>(undefined)
  const exportingRef = useRef<string | undefined>(undefined)
  const setExporting = (v: string | undefined) => {
    exportingRef.current = v
    setExportingState(v)
  }

  const statusId = useRef(0)
  const say = useCallback((text: string, kind: Status['kind'] = 'info') => {
    statusId.current += 1
    setStatus({ text, kind, id: statusId.current })
  }, [])
  // Routine messages fade; warnings stay until something else happens.
  useEffect(() => {
    if (!status || status.kind !== 'info') return
    const id = status.id
    const t = window.setTimeout(() => setStatus((s) => (s && s.id === id ? null : s)), 6000)
    return () => window.clearTimeout(t)
  }, [status])

  useEffect(() => {
    if (loadingSince === null) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [loadingSince])
  const loadingSeconds = loadingSince === null ? null : Math.max(0, Math.round((now - loadingSince) / 1000))

  const selected = doc.routes.find((r) => r.id === selectedId) ?? doc.routes[0]
  const setTool = useCallback((t: Tool) => {
    setToolState(t)
    setView('print')
  }, [])

  // While the example works out its route, the print's card stays up until the picture with the route
  // arrives, so the print never shows blank or half done in between. `holdFor` is that route's id.
  const [preparing, setPreparing] = useState<string | null>(null)
  const holdFor = useRef<string | null>(null)
  const release = useCallback(() => {
    holdFor.current = null
    setPreparing(null)
  }, [])

  // Drawing: the newest request wins, and only one is with the worker at a time.
  const sceneReq = useMemo(
    () => ({ frame: doc.frame, style: doc.style, detail: doc.detail, routes: doc.routes, pins: doc.pins }),
    [doc.frame, doc.style, doc.detail, doc.routes, doc.pins],
  )
  const pendingScene = useRef<typeof sceneReq | null>(null)
  const sceneBusy = useRef(false)
  useEffect(() => {
    pendingScene.current = sceneReq
    if (sceneBusy.current) return
    sceneBusy.current = true
    void (async () => {
      while (pendingScene.current) {
        const req = pendingScene.current
        pendingScene.current = null
        const res = await call({ type: 'scene', ...req })
        if (res.type === 'scene') {
          setScene(res)
          if (req.routes.some((r) => r.id === holdFor.current && r.route.points.length > 0)) release()
        } else if (res.type === 'error') {
          release()
          say(`The print could not be drawn: ${res.message}`, 'warn')
        }
      }
      sceneBusy.current = false
    })()
  }, [sceneReq, loaded, call, say, release])

  // Downloading. A newer download replaces an older one.
  const loadSeq = useRef(0)
  const download = useCallback(async (d: Doc, fresh = false): Promise<boolean> => {
    const seq = ++loadSeq.current
    setLoadingSince(Date.now())
    setNow(Date.now())
    setLoadingText('Downloading the map from OpenStreetMap…')
    const res = await call({ type: 'load', bbox: downloadBox(d.frame, d.style), buildings: d.buildings, fresh }, (text) => {
      if (seq === loadSeq.current) setLoadingText(text)
    })
    if (seq !== loadSeq.current) return false
    setLoadingSince(null)
    if (res.type === 'loaded') {
      setLoaded(res)
      const lines = res.counts.minor + res.counts.major + res.counts.paths
      if (res.cachedAt) {
        const days = Math.floor((Date.now() - res.cachedAt) / 86_400_000)
        say(`Map opened from this browser’s copy, saved ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}. For the newest data, press Download again in the Place tab.`)
      } else {
        say(`Map downloaded in ${(res.ms / 1000).toFixed(1)} s: ${lines.toLocaleString()} streets and paths, ${res.places.length} landmarks.`)
      }
      return true
    }
    if (res.type === 'error') say(res.message, 'warn')
    if (res.type === 'cancelled') say('Download stopped. The map you had is still here.')
    return false
  }, [call, say])
  const cancelDownload = useCallback(() => {
    void call({ type: 'cancel' })
  }, [call])

  // Route edits run one after another, each on the result of the one before, so fast clicks never
  // lose a point.
  const chain = useRef<Promise<void>>(Promise.resolve())
  const latestRoute = useRef(new Map<string, Route>())
  const queue = useCallback((op: () => Promise<void>) => {
    chain.current = chain.current.then(op).catch(() => undefined)
  }, [])
  const routeOf = (id: string): Route => latestRoute.current.get(id) ?? docRef.current.routes.find((r) => r.id === id)?.route ?? emptyRoute()
  const setRoute = useCallback((id: string, route: Route) => {
    latestRoute.current.set(id, route)
    edit((d) => ({ ...d, routes: d.routes.map((r) => (r.id === id ? { ...r, route } : r)) }))
  }, [edit])

  const onPick = (p: LonLat) => {
    if (tool === 'pin') {
      const pin: Pin = { id: uid('p'), at: p, label: '', icon: 'star' }
      edit((d) => ({ ...d, pins: [...d.pins, pin] }))
      setTab('route')
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`pin-label-${pin.id}`)?.focus()))
      say('Pin dropped. Type its label and pick its icon in the Route tab.')
      return
    }
    const id = selected?.id
    if (!id) return
    const roads = follow && !!loaded
    if (follow && !loaded && !routeOf(id).points.length) say('No map yet, so points join with straight lines. Download a map to follow roads.')
    queue(async () => {
      const res = await call({ type: 'add-point', route: routeOf(id), p, follow: roads })
      if (res.type === 'route') {
        setRoute(id, res.route)
        if (res.note) say(res.note, 'warn')
      } else if (res.type === 'error') say(res.message, 'warn')
    })
  }

  const onView = (next: { centerLon: number; centerLat: number; widthKm: number }) => {
    edit((d) => ({ ...d, frame: { ...d.frame, ...next } }))
  }

  const fit = () => {
    const f = fitFrame(docRef.current.frame, docRef.current.style, docRef.current.routes)
    if (!f) return say('Draw or import a route first, then fit the map to it.')
    edit((d) => ({ ...d, frame: { ...d.frame, centerLon: f.centerLon, centerLat: f.centerLat, widthKm: f.widthKm } }))
  }

  const undo = () => {
    const id = selected?.id
    if (!id) return
    queue(async () => {
      const r = routeOf(id)
      if (r.points.length) setRoute(id, undoPoint(r))
    })
  }

  const importRoute = async () => {
    const file = await openFile('.gpx,.geojson,.json,application/gpx+xml,application/geo+json')
    if (!file) return
    let track: LonLat[]
    try {
      track = parseRouteFile(file.name, await file.text())
    } catch (e) {
      return say(e instanceof Error ? e.message : 'That file could not be read.', 'warn')
    }
    const route = routeFromTrack(track)
    const into = selected?.id
    queue(async () => {
      const d = docRef.current
      const target = into && !routeOf(into).points.length ? into : null
      let routes: RouteItem[]
      let id: string
      if (target) {
        id = target
        routes = d.routes.map((r) => (r.id === id ? { ...r, route } : r))
      } else {
        const r = nextRoute(d, lookIdOf(d.style, LOOKS) || 'vintage')
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40)
        id = r.id
        routes = [...d.routes, { ...r, name: name || r.name, route }]
      }
      latestRoute.current.set(id, route)
      // Fit the page to every route, the new one included.
      const f = fitFrame(d.frame, d.style, routes)
      const frame = f ? { ...d.frame, centerLon: f.centerLon, centerLat: f.centerLat, widthKm: f.widthKm } : d.frame
      const added = routes.find((r) => r.id === id) as RouteItem
      edit((x) => ({
        ...x,
        frame,
        routes: x.routes.some((r) => r.id === id) ? x.routes.map((r) => (r.id === id ? { ...r, route } : r)) : [...x.routes, added],
      }))
      setSelectedId(id)
      say(`Imported ${track.length.toLocaleString()} points from ${file.name}${target ? '' : ' into a new route'}.`)
      if (!isCovered(loadedRef.current?.bbox ?? null, frame, d.style)) void download({ ...d, routes, frame })
    })
  }

  const ops: RouteOps = {
    addRoute: () => {
      const d = docRef.current
      const r = nextRoute(d, lookIdOf(d.style, LOOKS) || 'vintage')
      edit((x) => ({ ...x, routes: [...x.routes, r] }))
      setSelectedId(r.id)
      setTool('draw')
      say(`${r.name} added. Click the map to draw it.`)
    },
    deleteRoute: (id) => {
      const r = docRef.current.routes.find((x) => x.id === id)
      if (!r || docRef.current.routes.length < 2) return
      const go = () => {
        latestRoute.current.delete(id)
        edit((d) => ({ ...d, routes: d.routes.filter((x) => x.id !== id) }))
      }
      if (!routeOf(id).points.length) return go()
      setConfirm({ title: `Delete ${r.name}?`, body: `Its ${routeOf(id).points.length} points will be lost.`, confirm: 'Delete', danger: true, onConfirm: go })
    },
    renameRoute: (id, name) => edit((d) => ({ ...d, routes: d.routes.map((r) => (r.id === id ? { ...r, name } : r)) })),
    recolorRoute: (id, color) => edit((d) => ({ ...d, routes: d.routes.map((r) => (r.id === id ? { ...r, color } : r)) })),
    setDashed: (id, dashed) => edit((d) => ({ ...d, routes: d.routes.map((r) => (r.id === id ? { ...r, dashed } : r)) })),
    undo,
    closeLoop: () => {
      const id = selected?.id
      if (!id) return
      queue(async () => {
        const res = await call({ type: 'close-loop', route: routeOf(id), follow: follow && !!loaded })
        if (res.type === 'route') {
          setRoute(id, res.route)
          if (res.note) say(res.note, 'warn')
        }
      })
    },
    clear: () => {
      const id = selected?.id
      if (!id) return
      setConfirm({
        title: `Clear ${selected.name}?`, body: `All ${routeOf(id).points.length} points of this route will be removed.`, confirm: 'Clear', danger: true,
        onConfirm: () => queue(async () => setRoute(id, emptyRoute())),
      })
    },
    importRoute: () => void importRoute(),
    fit,
    togglePlace: (p: Place) => {
      edit((d) => d.pins.some((x) => x.id === p.id)
        ? { ...d, pins: d.pins.filter((x) => x.id !== p.id) }
        : { ...d, pins: [...d.pins, { id: p.id, at: p.at, label: p.name, icon: PLACE_ICON[p.kind] }] })
    },
    updatePin: (id, patch) => edit((d) => ({ ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    deletePin: (id) => edit((d) => ({ ...d, pins: d.pins.filter((p) => p.id !== id) })),
  }

  const onApplyLook = (look: Look) => {
    edit((d) => applyLook(d, look))
    say(`${look.label} look applied. Your words, routes and pins stay as they were.`)
  }

  const onPickPlace = (r: PlaceResult) => {
    const next = { ...docRef.current, frame: { ...docRef.current.frame, centerLon: r.lon, centerLat: r.lat, widthKm: r.widthKm } }
    edit((d) => ({ ...d, frame: next.frame }))
    void download(next)
  }

  // Exports draw a fresh picture of exactly what is set now.
  const fresh = async (): Promise<SceneRes | null> => {
    const d = docRef.current
    const res = await call({ type: 'scene', frame: d.frame, style: d.style, detail: d.detail, routes: d.routes, pins: d.pins })
    return res.type === 'scene' ? res : null
  }
  const baseName = () => slug(docRef.current.style.text.title || 'route map')
  const exportSvg = async () => {
    if (exportingRef.current) return
    setExporting('Exporting…')
    try {
      const s = await fresh()
      if (!s) return say('The print could not be drawn for export.', 'warn')
      const name = `${baseName()}.svg`
      const r = await saveFile(new Blob([s.svg], { type: 'image/svg+xml' }), name, 'SVG image', { 'image/svg+xml': ['.svg'] })
      if (r !== 'cancelled') say(`${r === 'saved' ? 'Saved' : 'Downloaded'} ${name}: ${(s.stats.bytes / 1024).toFixed(0)} KB, ${s.check.inks.length} ink${s.check.inks.length === 1 ? '' : 's'}.`)
    } finally {
      setExporting(undefined)
    }
  }
  const exportPng = async (dpi: number) => {
    if (exportingRef.current) return
    setExporting('Making the PNG…')
    say('Making the PNG…', 'busy')
    try {
      const s = await fresh()
      if (!s) return say('The print could not be drawn for export.', 'warn')
      const png = await svgToPng(s.svg, s.frame.widthMm, s.frame.heightMm, dpi)
      const name = `${baseName()}-${png.dpi}dpi.png`
      const r = await saveFile(png.blob, name, 'PNG image', { 'image/png': ['.png'] })
      if (r !== 'cancelled') say(`${r === 'saved' ? 'Saved' : 'Downloaded'} ${name}${png.dpi < dpi ? ` (lowered to ${png.dpi} dpi to fit in memory)` : ''}.`)
      else setStatus(null)
    } catch (e) {
      say(e instanceof Error ? e.message : 'The PNG could not be made.', 'warn')
    } finally {
      setExporting(undefined)
    }
  }
  const saveProject = async () => {
    const v = version
    const d = docRef.current
    const name = `${baseName()}.route-map.json`
    const r = await saveFile(new Blob([serializeProject(d)], { type: 'application/json' }), name, 'Route Map Studio project', { 'application/json': ['.json'] })
    if (r === 'cancelled') return
    setSavedVersion(v)
    say(`${r === 'saved' ? 'Saved' : 'Downloaded'} ${name}.`)
  }
  const openProjectNow = async () => {
    const file = await openFile('.json,application/json')
    if (!file) return
    try {
      const state = parseProject(await file.text())
      if (!state.routes.length) state.routes = [nextRoute(state, lookIdOf(state.style, LOOKS) || 'vintage')]
      release()
      latestRoute.current.clear()
      setDoc(state)
      setVersion((v) => {
        setSavedVersion(v + 1)
        return v + 1
      })
      setSelectedId(state.routes[0]?.id ?? '')
      say(`Opened ${file.name}. Downloading its map…`)
      void download(state)
    } catch (e) {
      say(e instanceof Error ? e.message : 'That file could not be opened.', 'warn')
    }
  }
  const openProject = () => {
    if (!dirty) return void openProjectNow()
    setConfirm({ title: 'Open another project?', body: 'This one has unsaved changes. They will be lost.', confirm: 'Open', onConfirm: () => void openProjectNow() })
  }

  const runExample = async () => {
    release()
    const fresh = newDoc()
    latestRoute.current.clear()
    setDoc(fresh)
    setVersion((v) => {
      setSavedVersion(v + 1)
      return v + 1
    })
    setSelectedId(fresh.routes[0]?.id ?? '')
    const ok = await download(fresh)
    if (!ok) return
    const id = fresh.routes[0]?.id
    if (!id) return
    holdFor.current = id
    setPreparing('Drawing the example route…')
    const res = await call({ type: 'route-from-points', points: EXAMPLE, follow: true, loop: true })
    if (res.type !== 'route' || !res.route.points.length) {
      release()
      if (res.type === 'error') say(`The example route could not be drawn: ${res.message}`, 'warn')
      return
    }
    setRoute(id, res.route)
    edit((x) => {
      const routes = x.routes.map((r) => (r.id === id ? { ...r, name: 'Banks loop', route: res.route } : r))
      const f = fitFrame(x.frame, x.style, routes)
      return {
        ...x, routes,
        frame: f ? { ...x.frame, centerLon: f.centerLon, centerLat: f.centerLat, widthKm: f.widthKm } : x.frame,
        style: { ...x.style, text: { ...x.style.text, title: 'SCHUYLKILL BANKS LOOP', subtitle: 'Philadelphia' } },
      }
    })
    setTab('route')
    say('Here is a loop along the Schuylkill. Try another look, tick a café, then export.')
  }
  const showExample = () => {
    try {
      localStorage.setItem(QUICKSTART_KEY, '1')
    } catch {
      // Private browsing: the quick start shows again next time, which is fine.
    }
    setDialog(null)
    const d = docRef.current
    const hasWork = dirty || d.pins.length > 0 || d.routes.some((r) => r.route.points.length > 0)
    if (!hasWork) return void runExample()
    setConfirm({
      title: 'Replace this project with the example?',
      body: 'The example starts a new project in Philadelphia. Your routes, pins and words here will be lost unless you save first.',
      confirm: 'Show the example',
      danger: true,
      onConfirm: () => void runExample(),
    })
  }
  const closeQuickStart = () => {
    try {
      localStorage.setItem(QUICKSTART_KEY, '1')
    } catch {
      // See above.
    }
    setDialog(null)
  }

  // Keyboard shortcuts. The handlers change every render, so the listener reads them from a ref.
  const keys = useRef({ undo, fit, saveProject, openProject, exportSvg, setTool })
  useEffect(() => {
    keys.current = { undo, fit, saveProject, openProject, exportSvg, setTool }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const h = keys.current
      if (mod && k === 's') { e.preventDefault(); void h.saveProject(); return }
      if (mod && k === 'o') { e.preventDefault(); h.openProject(); return }
      if (mod && k === 'e') { e.preventDefault(); void h.exportSvg(); return }
      if (typing) return
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); h.undo(); return }
      if (mod || e.altKey) return
      if (k === 'd') h.setTool('draw')
      else if (k === 'p') h.setTool('pin')
      else if (k === 'm' || e.key === 'Escape') h.setTool('move')
      else if (k === 'f') h.fit()
      else if (e.key === '?') setDialog('help')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Ask before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty])

  const covered = isCovered(loaded?.bbox ?? null, doc.frame, doc.style)
  const limited = doc.style.inkLimit > 0
  const paper = doc.style.transparent || limited ? doc.style.shirt : doc.style.background
  const shownFrame = scene?.frame ?? doc.frame
  const viewMap = mapFrame(doc.frame, doc.style)
  const shownMap = scene?.mapFrame ?? viewMap
  const hasPoints = doc.routes.some((r) => r.route.points.length > 0)
  const exportReason = !scene ? 'The print is still being drawn.' : exporting
  const waiting = waitingCard({
    downloading: loadingSince !== null, preparing, loadedMapId: loaded?.mapId ?? null,
    shown: scene ? { mapId: scene.mapId, byLayer: scene.stats.byLayer } : null,
  })

  return (
    <div className="app">
      <Viewport
        svg={scene?.svg ?? ''}
        picFrame={shownFrame}
        picMap={shownMap}
        viewMap={viewMap}
        tool={tool}
        points={selected?.route.points ?? []}
        paper={paper}
        busy={waiting}
        empty={!loaded && !hasPoints}
        view={view}
        onPick={onPick}
        onView={onView}
      />

      <aside className="glass panel" aria-label="Settings">
        <header className="brand">
          <strong>Route Map Studio</strong>
          <span className="version">v{__APP_VERSION__}</span>
        </header>
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Steps" />
        {/* Keyed by tab, so each tab opens at its top instead of as far down as the last tab was scrolled. */}
        <div key={tab} className="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'place' ? (
            <PlacePanel doc={doc} edit={edit} covered={covered} loading={loadingSince !== null} onDownload={() => void download(docRef.current, !!loaded)} onPickPlace={onPickPlace}
              loaded={loaded ? { counts: loaded.counts, places: loaded.places.length, ms: loaded.ms } : null} />
          ) : tab === 'route' ? (
            <RoutePanel doc={doc} selectedId={selected?.id ?? ''} onSelect={setSelectedId} follow={follow} setFollow={setFollow} hasMap={!!loaded}
              routeKm={scene?.stats.routeKm ?? []} places={loaded?.places ?? []} ops={ops} />
          ) : tab === 'look' ? (
            <LookPanel doc={doc} edit={edit} onApplyLook={onApplyLook} />
          ) : tab === 'text' ? (
            <TextPanel doc={doc} edit={edit} firstKm={(scene?.stats.routeKm ?? []).find((k) => k > 0) ?? 0} />
          ) : (
            <ExportPanel doc={doc} edit={edit} ready={!scene ? 'The print is still being drawn.' : undefined} busy={exporting}
              onExportSvg={() => void exportSvg()} onExportPng={(dpi) => void exportPng(dpi)} onSave={() => void saveProject()} onOpen={openProject} />
          )}
        </div>
      </aside>

      <TopBar dirty={dirty} exportReason={exportReason} onOpen={openProject} onSave={() => void saveProject()} onExport={() => void exportSvg()} onHelp={() => setDialog('help')} />
      <PrintCheckCard check={scene?.check ?? null} stats={scene?.stats ?? null} widthMm={doc.frame.widthMm} heightMm={doc.frame.heightMm} shirt={doc.style.shirt}
        inkLimit={doc.style.inkLimit} setInkLimit={(n) => edit((d) => ({ ...d, style: { ...d.style, inkLimit: n } }))} />
      <Dock tool={tool} setTool={setTool} status={status} loadingSeconds={loadingSeconds} loadingText={loadingText} onCancel={cancelDownload}
        showDownload={!!loaded && !covered && loadingSince === null} onDownload={() => void download(docRef.current)} view={view} setView={setView} />

      {dialog === 'quickstart' ? <QuickStart onExample={showExample} onClose={closeQuickStart} /> : null}
      {dialog === 'help' ? <HelpDialog onClose={() => setDialog(null)} onQuickStart={() => setDialog('quickstart')} /> : null}
      {confirm ? <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} /> : null}
      <TooltipLayer />
    </div>
  )
}
