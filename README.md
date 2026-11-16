# Route Map Studio

Route Map Studio is a browser app that turns a running club's route into a print-ready map for a T-shirt. Find the place, draw the route by clicking along the streets and drag it into shape (or import a GPX from Strava), tick the cafés, stations and landmarks along it, pick a look, and hold it to 1, 2 or 3 inks for a cheaper screen print. Export a real-size SVG for Illustrator, with one named group per layer and live text, or a 300 dpi PNG. Map data comes from OpenStreetMap.

**Use it online:** https://gil336699.github.io/route-map-studio/

![Demo: the quick start opens the example, a 3.74-mile loop along the Schuylkill in Philadelphia, on a cream print. Pressing D shows the route's points as handles. A point on the Benjamin Franklin Parkway is dragged onto 20th Street, then the line on Race Street is dragged down 19th Street into a detour; during each drag the new way shows as a dashed line, and the loop grows to 4.67 miles. The detour's point is clicked, Remove point takes it out, and ⌘Z brings it back. In the landmarks list, Nook Bakery & Coffee Bar and Walnut Street Bridge are ticked and appear on the print as pins with a bakery and a bridge icon. Pressing P and clicking the start drops a pin, labelled Start, and the icon picker gives it the start and finish flag. The Marathon shirt look turns the print red with one white ink, a huge 4.7 and a key for bakeries, bridges and the start and finish, and Export SVG downloads a 45 KB file in 1 ink.](docs/demo.gif)

[Watch the demo as a video](docs/demo.mp4) (MP4, 1920 × 1080, 29 s). The demo used a saved copy of the OpenStreetMap data for this area, so its download is quicker than one from the public servers (see Known limits).

Everything runs in your browser. Your routes, pins and files stay on your computer; only the map area you download is fetched, from OpenStreetMap's public servers. The last five maps you downloaded are kept in the browser for 30 days, so reopening a project or the same area needs no new download.

## Run

Needs Node 22 or newer.

```bash
npm install
npm run dev
```

Then open the address Vite prints, usually http://localhost:5173/.

## Publish

Every push to `main` is built and published to GitHub Pages by `.github/workflows/pages.yml`. To host it anywhere else, run `npm run build` and serve the `dist` folder; asset paths are relative, so any folder or domain works.

## Layout

- **Print.** The print fills the window at its real proportions, on the shirt colour. What you see is exactly what exports. The layers are named after what they hold, and each route's layer after the route.
- **Left panel.** Five tabs in the order a designer works: **Place** (find the area, download the map), **Route** (routes, drawing, landmarks and pins), **Look** (starting looks, inks, shirt, layers, route line, detail), **Text** (title, distance, key) and **Export** (print size, files).
- **Top right.** Open, Save project (a dot means unsaved changes), Export SVG and **?** for help. Below it, the **print check**: the inks the print needs, the ink limit, and any warnings.
- **Bottom.** The Draw, Pin and Move tools, the status, and the switch between the print and the print **On shirt**. While a map downloads or is drawn, a card on the print says so. In the Draw tool the selected route's points are handles to drag or click, with a + halfway along each stretch that is long enough on screen.

In a window under 1500 px wide the status gets a row of its own under the tools, so long messages show in full. On a narrow window the panels slim down; on a tablet or phone the print sits on top and everything else follows below it, in one column.

## Help in the app

Every control describes itself, with its shortcut, when you hover over it or Tab to it (a click does not pop one up). Unavailable controls say why, for example "A loop needs at least 3 points." A three-step quick start greets first visits, with an example to start from, and **?** lists every shortcut. Clearing or deleting a route, and opening a project over unsaved work, ask first. Undo (⌘Z) takes back any change to a route or a pin, and the status says what it took back.

## Workflow

1. **Place.** Search for a park, a street or a city. Picking a result centres the map and downloads it. Or type the centre and the width on the ground, then press **Download map**.
2. **Route.** Press **D** and click along the route. Each point joins the last along roads and trails; switch to **Straight** where the map is missing a path. Or press **Import GPX**: in Strava on the web, open the run, then the ⋯ menu, then **Export GPX**. Add more routes with **+ New route**; each gets its own colour and layer.
3. **Edit.** Still in Draw, drag a point to move it, drag the line (or a +) to add a detour, and click a point to remove it. Only the stretches beside the point are drawn again, each the way it was drawn, along the streets or straight. A click on the line itself adds the next point at the end, for a route that goes back the way it came. **[** and **]** step through the points by keyboard, and Delete removes the one picked. An imported GPX track stays exactly as recorded.
4. **Landmarks.** The Route tab lists what is near the routes: cafés, bakeries, ice cream, bars and breweries, restaurants, museums, monuments, sights, parks, bridges, stadiums, stations, water and restrooms. Tick the ones to show; each comes in with its own icon. Press **P** and click for a pin of your own, such as the club's meeting point or a company's office, and pick its icon from 41, or set it to **Text only** for a street name.
5. **Look.** Pick a starting look. For screen printing, set **Inks** to 1, 2 or 3: every colour is mapped onto that many inks, and the shirt shows through as the background. Adjust the layers, line weights, frame and detail.
6. **Text.** Type the club name and a subtitle. Turn on **Big number** for a race-shirt distance like 13.1, typed or taken from the route, and **Show a key** to name the icons ("Coffee stops").
7. **Export.** Choose the print size (12 × 14 in for a shirt back by default) and press **Export SVG**. **Save project** keeps the routes, pins and settings to open later.

### Working with Illustrator

The SVG opens at real size. Each layer is a named group: Background, Parks, Water, Railways, Paths and trails, Streets, Main roads, one group per route, Distance markers, Pins, Text and the OpenStreetMap credit. With **Keep each road separate** off (the default), each layer is one compound path, which keeps the file small and Illustrator quick; turn it on to edit streets one by one. A circle or rounded frame is a clipping mask. Text is live, set in Helvetica Neue, so you can swap in the club's font.

Knockouts (the outline around a route, the cut-outs in icons, the halo behind labels, and the plate behind text over the map) are filled with the shirt colour. They print as no ink: tell the printer, or delete them and set the shapes to knock out in your separations.

## Feature reference

### Looks

| Look | What it is | Inks |
| --- | --- | --- |
| Marathon shirt | One white ink on a red shirt: a bold route, the river banks, landmark icons and a huge distance, like a city half-marathon tee. | 1 |
| Vintage | Muted retro colours on a cream shirt. | 6 |
| Night neon | Dark streets, one volt route and kilometre marks. | 5 |
| Race red | Black shirt, faint city, one bold red course. | 5 |
| Emblem | Every street in one light ink inside a circle, the route in a second ink. | 2 |
| Tonal | A map one shade lighter than the navy shirt and a quiet route. | 4 |
| Coastal pins | Light teal streets with red pins. | 5 |
| City blue | Dense blue streets and a red route. | 5 |
| 1 ink, light shirt | Black only, on any light shirt. | 1 |

Any look can be held to 1, 2 or 3 inks with the ink limit.

### Ink limit

| Inks | Ink 1 | Ink 2 | Ink 3 |
| --- | --- | --- | --- |
| 1 | Everything. The route is drawn half again as heavy, so it stands out by weight. | | |
| 2 | The map | Routes, pins, markers and text | |
| 3 | Main roads and text | Routes, pins and markers | Streets, paths and water |

Parks drop out under an ink limit, since they would need an ink of their own. A second route takes the map's ink (with 2 inks) or the main ink (with 3).

### Print check

| Check | Rule |
| --- | --- |
| Inks | Every distinct colour the file prints, with the shirt colour left out when the background is not printed. |
| Line weight | At least 1 pt, or 2 pt for ink lighter than a dark shirt, where ink spreads into the gaps. |
| Text size | At least 8 pt. Pin labels, the key, markers and the credit never go smaller. |

The rules come from printers' artwork guides, which differ, so the check advises and never blocks. Confirm with the printer.

### Exports

| Export | Contents | Units |
| --- | --- | --- |
| SVG | The print as shown: one named group per layer, routes, markers, pins with icons, the text, the key and the OpenStreetMap credit. | mm, at real size |
| PNG | The same, at 300 dpi (3600 × 4200 px for 12 × 14 in). | px |
| Project | The page, the look, every route and pin, as `.route-map.json` (schema `route-map-studio.project`, version 1). The map downloads again when it is opened. | degrees and mm |

## Controls

| Control | Effect |
| --- | --- |
| Find a place | Searches OpenStreetMap's Nominatim. Picking a result sets the centre and a width that fits the place, and downloads it. |
| Centre, Width on the ground | Where the map is and how much of the world the print shows, 0.2 to 40 km across. |
| Buildings | Building outlines, downloaded when the map has none; the same setting as the Buildings layer in the Look tab. Busy at shirt size, and a much larger download. If the download fails or is stopped, it turns back off. |
| Along roads and trails, Straight | How each new point joins the last, and how a stretch is joined again when a point between a roads stretch and a straight one is removed. Along roads needs a downloaded map. |
| Points on the map (Draw) | Drag to move; drag the line or a + to add a detour; click, then **Remove point** or Delete, to take one out; click a + to add a point on the line. |
| Undo, Redo | Take back, or make again, the last change to a route or a pin. |
| Close loop, Clear | Join the end back to the start, or remove every point of the selected route. |
| Fit | Moves and zooms the map so every route fits the page. |
| Landmarks | 14 kinds (restaurants off to start), within 100, 200 or 400 m of any route. The list shows the 40 nearest. |
| Pins | Icon (a dot, text only, or one of 41 in five groups: Running, Food and drink, Places, Getting there, Everyday) and label, printed in capitals. |
| Starting look | Sets every colour and the layout; keeps your words, routes, pins, units and ink limit. |
| Inks | Any, 1, 2 or 3, with a colour for each ink. |
| Shirt colour | For the preview and the print check. Never printed. |
| Print a background | A solid background behind the map. It costs an ink. |
| Frame | Full, Rounded or Circle. |
| Map layers | Show, colour and line width (pt) for main roads, streets, paths, railways, buildings, water and parks. **Banks** draws the river as its edges. With an ink limit, parks are left out, and their switch says why. |
| Route line | Width, knockout outline, dashed (every route; each route's - - button in the Route tab sets just that one), start and finish dots, distance markers and their spacing, miles or kilometres. |
| Detail | Smooth lines (0 to 1 mm), shortest line and smallest shape kept. |
| Words | Title (shrinks to fit), subtitle, colour. |
| Distance | Big number (typed, or the first route's length) or a distance line naming each route. |
| Key | Names each pin icon in use, by what it marks (Stations, Offices) until you type another name. |
| Layout | Text below the map or over it (on a plate in the shirt colour); left or centred. |
| Print size, Units | Presets for shirt backs and fronts, pockets, Letter, A4 and square, or any size; mm, in, pt or px. The map keeps its width on the ground. |
| OpenStreetMap credit | Small, up the right edge. Turn it off if the credit goes on the shirt's tag. |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| D | Draw: click to add route points; drag a point or the line to edit |
| P | Pin: click to drop a pin |
| M or Esc | Move: drag the map |
| [ and ] | Draw: pick the previous or next point |
| Delete | Draw: remove the picked point |
| Esc | Let a picked point go |
| F | Fit the map to the routes |
| ⌘Z, ⇧⌘Z | Undo and redo changes to routes and pins |
| ⌘S | Save the project |
| ⌘O | Open a project |
| ⌘E | Export SVG |
| ? | Help |

On the print, scroll or pinch to zoom and drag to move. On a touch screen, one finger draws or drags and two fingers pinch.

## How it works

The page sends the map engine requests in a Web Worker, so downloading, reading and drawing never freeze the window.

1. **Download.** One Overpass query fetches the streets, paths and trails (leaving out mapped sidewalks and crossings, which double every street), railways, rivers, water, parks, and the landmarks, for the page's area plus a 15 % margin. Landmarks come back as centre points; parks, bridges, stadiums, monuments and stations only with a name, and memorial plaques not at all. Rivers and lakes mapped as multipolygons are stitched into closed rings.
2. **Route.** The streets, paths and trails (but not motorways) form a graph. A click lands on the nearest point of a street within 200 m, preferring the connected network the previous point is on, and that street is split there, so a point sits exactly where it was clicked. Dijkstra's algorithm finds the shortest way from the previous point. A click farther than 200 m from any street (in a river, say) stays where it was made and joins with a straight line, and the status says so.
3. **Edit.** Each stretch remembers how it was made: along the streets, straight, or an imported track. Moving, inserting or removing a point draws again only the stretches that meet it, each its own way, so the rest of the route stays exactly as it was. While a point is dragged, the engine works the new route out again on every move (one request at a time, the newest winning) without touching the street graph: the splits a preview makes are taken back at once. Undo keeps the last 200 changes, each naming the one route or pin it touched.
4. **Draw.** Each feature is projected onto the page in millimetres with a local flat projection, simplified (Douglas-Peucker), clipped to the page, and short lines and small shapes are dropped. The SVG is built as text; the preview shows that same text, so exports hold exactly what the view shows.
5. **Inks.** With an ink limit, colours are mapped onto the inks by role before drawing. As the SVG is written, every ink it uses and the smallest text it sets are noted, so the print check reports what the file really prints.
6. **Servers.** Each public Overpass server gets 100 s. A busy, slow or broken one passes the download to the next (overpass-api.de, then overpass.private.coffee, then overpass.kumi.systems), and when all are busy the app waits 20 s and goes round once more, as Overpass asks. The status says what is happening, and Stop works at any point.

**Limits, honestly.** The projection is flat, which is accurate to well under 1 % across a city but not across a country. Map data is only as good as OpenStreetMap: a missing footbridge or a path joined to nothing sends routing the long way round, and the app says so with the numbers. Text sizes are estimated for layout, so a very long title or label in a narrow space can still crowd its neighbours.

## Known limits

| What | Measured |
| --- | --- |
| Download | 25 s and 46 s for the example around the Philadelphia Art Museum, on two runs. On 2026-11-15 all three public servers were at capacity or not answering for over an hour; the app then retries, says so, and opens the browser's copy when it has one. |
| Data | Leaving out mapped sidewalks and crossings cut a 6.6 × 7.3 km area from 27,527 to 11,504 map objects (with 324 landmarks, 8.4 MB, against 19.5 MB). |
| Landmarks | The 14 kinds add about 1 MB (12 %) to a 10 × 10 km download of central Philadelphia: 1,924 landmarks, 765 of them restaurants. |
| Routing | 49,629 nodes for that area. A click, including snapping and the shortest way, takes about 10 ms. |
| Editing | On a 23-point route drawn over that area: moving a point or a detour 21 to 22 ms, removing a point 7 ms, adding one on the line under 1 ms. A drag redraws its preview up to about 40 times a second. |
| Buildings | 6,550 buildings around the Art Museum (2.1 × 2.4 km) were a 6.5 MB, 88 s download from a public server. At 2.4 km across, most row houses are smaller than the 1 mm² **Smallest shape** and are left out; lower it to keep them. |
| Drawing | 4 to 20 ms per picture for a 12 × 14 in print of that area. |
| Files | SVG 45 to 210 KB for a 12 × 14 in print with one compound path per layer (89 KB in the QA run). PNG at 300 dpi: 3600 × 4200 px, 1.8 MB, made in 0.2 s. |
| Area | Up to 40 km across. Large areas download slowly and may be refused by the server. |
| Text | Every line of text shrinks to fit its row; very long words on a small page can fall below 8 pt, and the print check then says so. |

## Development

```bash
npm run dev       # development server
npm test          # unit tests (Vitest)
npm run lint      # ESLint, zero warnings allowed
npm run build     # typecheck and production build
npm run preview   # serve the production build
```

| Folder | What is there |
| --- | --- |
| `src/map/` | The engine, plain TypeScript: projection, simplify and clip, OSM parsing, routing graph, routes and route editing, landmarks, pin icons, inks and the SVG scene. |
| `src/lib/` | Overpass and Nominatim requests, project files, presets and looks, units, print check, files, document helpers, undo and redo, the worker hook, and the card the print shows while it waits for a map. |
| `src/worker/` | The map engine worker and its messages. |
| `src/components/` | The interface: viewport, panels, dock, top bar, print check, dialogs, tooltip layer and controls. |
| `docs/` | Research notes with sources. |
| `local/` | QA scripts, map data and mood boards. Not in git. |

## License

MIT. Map data © OpenStreetMap contributors, available under the Open Database License (openstreetmap.org/copyright).

Pin icons: [Maki](https://github.com/mapbox/maki) and [Temaki](https://github.com/rapideditor/temaki), both CC0 1.0 (public domain), so prints made with them need no credit. The runner and the running shoe are from [Phosphor](https://github.com/phosphor-icons/core), MIT; its licence is in `src/map/icons.ts`.
