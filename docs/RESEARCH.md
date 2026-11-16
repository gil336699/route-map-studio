# Route Map Studio: research notes

Research for a browser tool that turns a running club's route into a print-ready, layered SVG map for a T-shirt, made before the first build. 2026-11-15.

## What designers and route-poster tools do

| Finding | What the app does with it |
| --- | --- |
| GPX is the common input. Some tools also take TCX, FIT, KML or GeoJSON, and several pull runs straight from Strava. | Imports GPX and GeoJSON. Draws routes by clicking, following roads and trails. |
| Several routes in one print, each in its own colour, is a selling point. | Several routes, each in its own layer and colour. |
| Start and finish pins, and pins for special spots. | Start and finish dots. Landmark pins with icons (coffee, museum, water, star, flag) or text only. |
| Stats are filled in automatically from the route and stay editable. | Distance from the route, in km or mi, or typed by hand. |
| Editors run place → style → text → size, with a live preview (Mapiful). | Tabs in the same order: Place, Route, Look, Text, Export. The preview is the export. |
| Club shirts in 2026: a big back print with a small front mark, retro and muted colours, minimal designs that print cheaply. | A 12 × 14 in back print by default, a route-only front chest mark, and a Vintage look. |
| OpenStreetMap's own SVG export is hard to edit (clipped and masked images). Good exporters put each feature type in its own named group. | One named group per layer (water, streets, route, pins, text), live text, real size in mm. |
| Big city extracts get heavy and slow Illustrator. | Simplify and drop tiny details on the page, and keep one compound path per layer by default. |

## Print rules (screen printing)

Printers' guides disagree, so these are starting points. Confirm with the client's printer.

- **Lines:** at least 1 pt. Light ink on a dark shirt needs about 2 pt, because the ink spreads and the underbase closes gaps. Some shops ask for 3 pt light-on-dark.
- **Text:** at least 8 pt.
- **Inks:** each colour is a separate screen, so the ink count is the cost. Tints need halftones, which need fine mesh.
- **Knockouts:** a route outline or icon cut-out in the shirt colour prints as no ink.

The app's print check uses 1 pt, 2 pt light-on-dark and 8 pt. It counts inks with the shirt colour left out, and an ink limit maps any look onto 1, 2 or 3 inks.

## Found while building the boards

- The Overpass download for a 6.6 × 7.3 km area took 57 s and 19.5 MB. The app should download only a little beyond the page.
- OpenStreetMap has gaps. At the Girard Avenue Bridge the sidewalk doesn't connect to the MLK Drive trail 65 m away, so "follow roads" went 700 m the long way round. The app now says so with the numbers, and suggests drawing that bit straight.
- There are 324 landmarks in the Art Museum area (209 cafés, 69 museums, 31 sights, 15 water fountains). 12 lie within 200 m of the stand-in loop, including the Philadelphia Museum of Art, Cosmic Cafe, Boathouse Row and the Rocky Steps.

## Scale bar, compass and position (0.3.0)

Cartography guides agree on three things, and the city-poster tools add a fourth.

- **Scale bar: one round length, few parts, numbers above.** The longest distance should be a round number (1,000 m, 1 mile, 5 km), with parts at a half, a quarter or a fifth of it, and no odd decimals. The numbers go above the bar. The bar should be easy to find but low in the hierarchy: fine lines, small but readable text. A bar stays right when the print is scaled, which a ratio such as 1:25,000 does not (Ordnance Survey, Esri, QGIS). The app picks the round length nearest a quarter of the map's width, never more than a third, in the print's units (metres under a kilometre).
- **Compass: small, simple, in the map's style.** A plain arrow beats an elaborate rose, and on a large-scale map where north is up it can be left out (Ordnance Survey, Audubon, Esri, John Nelson). North is always up on this app's maps, so the compass is a design touch on a shirt, and the plain arrow is the default. The rose is there for vintage looks.
- **Position.** City posters set the coordinates as one letter-spaced line near the place name, such as 39°58′ N 75°11′ W. Degrees and minutes are within about 1.5 km, decimal degrees to four places within about 10 m, and seconds within about 30 m.
- **Print.** The same rules as everything else on the shirt: lines of at least 1 pt (2 pt for light ink on a dark shirt) and text of at least 8 pt. Helvetica Neue, Helvetica and Arial all have the degree sign and the prime marks (′ and ″), so the coordinates print in the file's own font.

The mood board (four scale bars, four compasses, three places for them and three ways to write the position, drawn on a real 12 × 14 in print on a navy shirt) is in `local/moodboard-v3/` (not in git). The pick: all four of each as options, a corner the user picks or the text band, and degrees and minutes.

## Sources

Running-club shirts and printing:
- [Fortera Apparel: custom running shirts guide](https://forteraapparel.com/blogs/news/custom-running-shirts-guide)
- [Vistaprint: T-shirt design ideas](https://www.vistaprint.com/hub/t-shirt-design-ideas)
- [Merchize: running club shirt trends](https://merchize.com/running-club-shirts/)
- [Rush Order Tees: how to design custom running shirts](https://www.rushordertees.com/blog/how-to-design-custom-running-shirts/)

Route-poster tools:
- [PathPosters](https://pathposters.com/), [PrintMap running route poster](https://printm.app/running-route-poster), [RunningMaps](https://runmapart.com/pages/running-map-print), [The Post Race poster creator](https://map-generator.thepostrace.com/en/), [Route Posters](https://route-posters.com/), [pretty-gpx (open source)](https://github.com/ThomasParistech/pretty-gpx), [Maramaps](https://maramaps.com/running-route-poster-maker), [Craft & Oak GPX posters](https://www.craftoak.com/gpx-posters), [ilovegpx poster guide](https://ilovegpx.org/en/blog/gpx-poster-route-map), [Sportymaps](https://sportymaps.com/)
- [Mapiful editor](https://www.mapiful.com/us/editor/) and [a Mapiful review](https://www.cassiescroggins.com/mapiful-review/)

Artwork rules:
- [NW Custom Apparel: preparing screen printing artwork](https://nwcustomapparel.net/prepare-artwork-t-shirt-screen-printing/)
- [NW Custom Apparel: technical logo rules](https://nwcustomapparel.net/technical-logo-design-rules-embroidery-printing/)
- [FastEditor: minimum line thickness and font size](https://www.fasteditor.com/blog/minimum-line-thickness-font-size-print)
- [Stitchi: screen printing artwork guidelines](https://www.stitchi.com/blog/screen-printing-artwork-preparation-6-guidelines)
- [Tekton LA: halftone settings](https://tektonla.com/blogs/news/halftone-screen-printing)
- [Transfer Express: detail guidelines](https://blog.transferexpress.com/tips-for-screen-printing-custom-artwork-tip-4-detail-guidelines/)

OpenStreetMap to Illustrator:
- [OpenStreetMap Wiki: exporting to Adobe Illustrator](https://wiki.openstreetmap.org/wiki/Exporting_to_Adobe_Illustrator)
- [OSM2CDR: OpenStreetMap to SVG](https://osm2cdr.com/formats/svg/), [MapVectorizer](https://app.mapvectorizer.com/)
- [Atlas: OpenStreetMap to Illustrator](https://atlas.co/blog/open-street-map-to-illustrator/), [Atlas: how to make a city map poster](https://atlas.co/blog/how-to-make-a-city-map-poster/)
- [Let's make some vector maps (Medium)](https://medium.com/@sinclarius/lets-make-some-vector-maps-792481d5f328), [Maperitive](http://maperitive.net/)

Scale bars, north arrows and coordinates:
- [Ordnance Survey: scale](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/scale) and [north arrows](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/north-arrows)
- [Esri: choosing the best way to indicate map scale](https://www.esri.com/arcgis-blog/products/product/mapping/choosing-the-best-way-to-indicate-map-scale), [north arrow necessity](https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/north-arrow-necessity)
- [Audubon cartography guide: map elements](https://carto-guide-audubon.hub.arcgis.com/pages/make-good-maps-elements)
- [John Nelson: put a north arrow on it?](https://adventuresinmapping.com/2021/10/27/put-a-north-arrow-on-it/)
- [Penn State GEOG 486: marginalia design](https://courses.ems.psu.edu/geog486/node/513)
- [Time & Spatial: scale bars, north arrows and grids](https://www.timeandspatial.com/study/map-design/scale-bars-north-arrows-and-grids)
- [A scale bar that stays accurate in QGIS](https://arijolma.org/how-to-add-a-scale-bar-that-stays-accurate-in-qgis/)
