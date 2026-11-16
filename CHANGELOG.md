# Changelog

## 0.3.0 2026-11-16

- A scale bar, in the Text tab. It shows a round distance at the map's true scale, such as 1 mile on a map 7.5 km across, and picks a new length when you zoom (0.5 miles at 3 km). Under a kilometre it counts in metres. Four styles, each shown as a tile as it prints: **Bracket**, one length between two ticks; **Ruler**; **Checkered**, the atlas bar; and **Miles and km**, kilometres above the line and miles below.
- A compass in four styles: **Arrow**, a bold N over a slim arrow; **Split**, the half-filled arrowhead; **Badge**, a round badge in the pin colour, like the pins; and **Rose**, with N, E, S and W.
- **Where** they go, picked on a small page: one of the map's four corners, or the text band. In a corner the compass stacks over the scale bar, with a knockout halo so they read over the streets, and with the text over the map they stay above it. In the band they sit under the title's line, so the title keeps its full width, and only the lines beside them make room. Centred text puts the compass at one end and a shorter scale bar at the other. With the text off they go to the bottom-right corner, and the band button says why it is off.
- The map's position, as one letter-spaced line such as 39°58′ N 75°11′ W. It goes at the right of the text band, opposite the subtitle, or under the scale bar and compass when they are in the band too. Centred text adds it to the subtitle, and without text it joins the scale bar in its corner. Write it in degrees and minutes, decimal degrees or seconds, for the map's centre or the start of the first route.
- All three print in the text colour (the badge in the pin colour), so they add no ink. Their lines are 2 pt for light ink on a dark shirt, as the print check asks, and their text is never under 8 pt. Each is its own group in the SVG: Scale bar, Compass and Coordinates.
- Projects keep them, and a new look keeps them. Files from 0.2 open with all three off, so older designs print as they did.

## 0.2.1 2026-11-16

- A new demo at the top of the README, and as a video on the release, showing what 0.2 added. In the example loop along the Schuylkill, the Draw tool drags a point off the Benjamin Franklin Parkway onto 20th Street and drags the line down 19th Street into a detour, with the dashed preview showing during each drag. A point is removed, then ⌘Z brings it back. A bakery and a bridge are ticked from the new kinds of landmark, and a pin dropped at the start gets the start and finish flag from the new icon picker. Then come the Marathon shirt look and the SVG export. Before, the demo was from 0.1.1 and showed none of the editing, the new icons or the new kinds of landmark. Like that one, it was recorded with a saved copy of the OpenStreetMap data, so its download is quicker than one from the public servers.

## 0.2.0 2026-11-16

- Edit a drawn route right on the map. In the Draw tool, drag a point to move it. Drag the line, or the + halfway along a stretch, to add a detour. Click a point, then **Remove point** or Delete, to take it out. A click on a + adds a point without changing the line, ready to drag later. Only the stretches beside the point are drawn again, each the way it was drawn: along the streets, or straight. While you drag, the new way shows as a dashed line. Before, the only way to change a route was Undo point, which took the last point off the end.
- **[** and **]** pick the previous or next point by keyboard, and the map moves to a point out of view. Delete removes it, Esc lets it go.
- Undo and Redo (⌘Z and ⇧⌘Z, or the buttons in the Route tab) take back any change to a route or a pin: an added, moved or removed point, a detour, a closed loop, a cleared or deleted route, an import, a pin dropped, removed or given a new icon. A rename or a new colour made since stays. Before, ⌘Z only took off the last point.
- A route imported from GPX stays exactly as recorded: it shows no handles, and a drag on it moves the map. Points drawn on after it can still be edited.
- 41 pin icons instead of 5, in five groups (Running, Food and drink, Places, Getting there, Everyday): a runner, a start and finish flag, restrooms, first aid, a bakery, a brewery, an office building for a company, a train station, a stadium, a boat, and more. Pick them from a grid that shows each icon as it prints. Before, a station or a company had to borrow the star or the flag. The icons are Maki and Temaki, public domain, so a shirt printed with them needs no credit; the runner and the running shoe are Phosphor (MIT).
- The landmark finder looks for more kinds: bakeries, ice cream, bars and breweries, restaurants (off to start, as a city has so many), monuments, parks, bridges, stadiums, stations and restrooms, as well as cafés, museums, water and sights. Each comes in with its own icon. With 14 kinds the list shows the 40 nearest and says how many there are. The map download grows by about a tenth.
- The key names each icon by what it marks (Stations, Offices, Bridges) until you type your own name.
- The Buildings switch works. Turning it on downloads the buildings when the map has none, and shows them at once. The switches in the Place and Look tabs are now one setting, and a new look keeps it. If the download fails or is stopped, the switch goes back off and says so. Before, buildings showed only after turning on the Place switch, downloading again and turning on the Look switch, and every look turned them off again.
- The Dashed switch works. In the Look tab it is now **Dash every route**, and each route's - - button in the Route tab dashes just that one. Before, the switch did nothing, because every route kept a setting of its own.
- With an ink limit, the Parks switch shows off and says why: parks would need an ink of their own. Before, it could be switched on with no effect.
- Project files keep how each stretch was drawn. Files from 0.1 open as before, with their buildings and dashed settings read the way they were meant.

## 0.1.2 2026-11-16

- Clicking a control no longer pops up its tooltip. Tooltips show when you hover, after a short pause, or at once when you Tab to a control. Before, every click showed one right under the pointer, text fields included.
- Long messages in the bottom bar now show in full. In a window under 1500 px wide the message gets its own row under the tools, and it can take three lines. Before, at 1280 × 720 the example's "Here is a loop along the Schuylkill…" was cut off after two lines. Even on a wide screen the long warnings were cut, such as the one about a route going the long way round.
- The print no longer sits blank after a map downloads. A card says "Drawing the map…", or "Drawing the example route…", until the picture is in. It says "Downloading the map…" whenever the print shows no map yet, not only on the first download. Before, the card went away as soon as the download finished, so the print stayed empty for a moment. Opening the example over another map left it empty, with no word why, for the whole download.
- In a window about 1100 × 700, the bottom bar no longer covers the bottom 13 px of the print.

## 0.1.1 2026-11-15

- A demo at the top of the README, and as a video on the release: the example loop along the Schuylkill, a café and the Philadelphia Museum of Art ticked as landmarks, the Marathon shirt look held to one ink, the print on a shirt and the SVG export. It was recorded with a saved copy of the OpenStreetMap data, because the public map servers were overloaded that day.
- Each tab now opens at its top. Before, a tab opened as far down as the last one was scrolled: after scrolling the Route tab down to the landmarks, the Look tab opened with its starting looks out of view.

## 0.1.0 2026-11-15

The first version.

- Find a place and download its streets, paths, river, parks and landmarks from OpenStreetMap, right in the browser.
- Draw a route by clicking: each point joins the last along roads and trails, or with a straight line. Clicks near a stray path land on the connected streets, and a leg that goes the long way round says so, with the numbers.
- Import GPX (from Strava, Garmin or Komoot) or GeoJSON. Several routes, each in its own colour and layer.
- Landmarks along the route: cafés, museums, water fountains and sights within 100, 200 or 400 m, ticked onto the print as pins with icons. Drop your own pins, or text-only labels for street names.
- Nine starting looks, from a red half-marathon tee in one white ink to vintage, night neon, emblem and tonal.
- An ink limit holds any look to 1, 2 or 3 inks for screen printing. The print check counts the inks and flags lines under 1 pt (2 pt for light ink on a dark shirt) and text under 8 pt.
- Type: the club name, a subtitle, the distance as a line or a huge number, a key for the icons, below or over the map. Long titles shrink to fit.
- Frames: full, rounded or circle. Start and finish dots, distance markers every so many miles or kilometres, dashed routes, knockout outlines.
- Export a real-size SVG for Illustrator, one named group per layer with live text, a 300 dpi PNG, and a project file. A preview shows the print on a shirt.
- Busy map servers are handled: each gets a time limit, a busy or slow one passes the download to the next, and the status says what is happening. The last five downloaded maps are kept in the browser for 30 days, so reopening a project is instant.
- Clicks land on the street where you click, not on the nearest corner, and a click far from any street stays where it was made. A double click adds nothing.
- The print check counts the inks the file really uses and the smallest text it sets. Parks inside parks stay filled, lakes keep their islands, and river banks are never stroked along the page edge.
- Every line of text shrinks to fit the page, the big number included, and the plate behind text over the map covers all of it.
- Project files are checked field by field, so a damaged or hand-edited file opens with defaults instead of breaking the print. Pin icons are kept.
