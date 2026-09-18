// The base-map choices offered by Crime Mapping.
//
// Two choices, declared as data rather than as two branches of an if, so that
// adding a third would be a new entry here and nothing else.
//
// Street is OpenStreetMap, which is also where the boundary polygon itself
// comes from (relation 11322824) — so the drawn boundary and the streets it is
// drawn over are the same survey, and the edges line up with the roads that
// actually form them.
//
// Satellite is Esri World Imagery, which is what makes the boundary checkable
// against the ground: an officer can see whether a pin sits on a house, an
// alley or a field, which the street map cannot show. Note the tile path is
// {z}/{y}/{x} — Esri's ArcGIS REST tile service orders row before column,
// unlike the {z}/{x}/{y} of the OSM-style URL above it. Getting that backwards
// yields a map that loads tiles successfully but draws the world scrambled.
//
// NO API KEY. This ArcGIS Online basemap tile service is reachable without a
// token for this kind of use, so there is no credential in this file and none
// is needed in .env — which is deliberate: a key committed here would be a
// published secret, and a key required at runtime would be one more way for the
// map to fail on a barangay laptop. The attribution below is the condition of
// use and must not be removed.
//
// WHY THIS IS ITS OWN MODULE, next to geo.js rather than inside Mapping.jsx.
// It is pure data with no Leaflet import, so the test suite can assert the tile
// URLs — the part that fails silently in a browser — under Vitest's `node`
// environment. Importing it from Mapping.jsx instead would drag Leaflet in,
// which touches `window` at module scope and cannot load without jsdom that
// this project deliberately does not install (see vitest.config.js).
export const BASEMAPS = {
  street: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  },
};
