// Base-map configuration for Crime Mapping.
//
// These assert the parts of a tile layer that fail SILENTLY in the browser.
// A wrong tile URL does not throw and does not fail the build — the map simply
// renders blank, or renders scrambled, and only a person looking at the screen
// notices. The Esri axis order in particular is a mistake that still returns
// HTTP 200 for every tile, so nothing but an assertion or an eyeball catches it.
import { describe, expect, it } from 'vitest';
import { BASEMAPS } from './basemaps';

describe('Crime Mapping base maps', () => {
  it('offers exactly the two documented choices', () => {
    // The sidebar renders from this object, so its keys ARE the options a user
    // sees. A third entry appearing here without a deliberate decision would
    // put an untested base map in front of officers.
    expect(Object.keys(BASEMAPS).sort()).toEqual(['satellite', 'street']);
    expect(BASEMAPS.street.label).toBe('OpenStreetMap');
    expect(BASEMAPS.satellite.label).toBe('Satellite');
  });

  it('keeps the attribution each tile service requires as a condition of use', () => {
    // Not cosmetic: OSM is ODbL and Esri's basemap terms both require the
    // credit to be displayed. Removing it to tidy the map corner would breach
    // the licence the barangay is using the tiles under.
    expect(BASEMAPS.street.attribution).toContain('OpenStreetMap contributors');
    expect(BASEMAPS.satellite.attribution).toContain('Esri');
  });

  it('uses {z}/{x}/{y} for the OSM-style street tiles', () => {
    expect(BASEMAPS.street.url).toContain('{z}/{x}/{y}');
    expect(BASEMAPS.street.url).toMatch(/^https:/);
  });

  it('uses Esri World Imagery with {z}/{y}/{x} — row before column', () => {
    // THE POINT OF THIS FILE. ArcGIS REST tile paths are z/y/x, the reverse of
    // the OSM convention directly above. Copying the OSM template and swapping
    // the host yields a satellite layer that loads real tiles into the wrong
    // squares: a map that looks broken but reports no error anywhere.
    expect(BASEMAPS.satellite.url).toContain('World_Imagery');
    expect(BASEMAPS.satellite.url).toContain('{z}/{y}/{x}');
    expect(BASEMAPS.satellite.url).not.toContain('{z}/{x}/{y}');
    expect(BASEMAPS.satellite.url).toMatch(/^https:/);
  });

  it('carries no API key or token in the tile URLs', () => {
    // The satellite layer was chosen partly because it needs no credential.
    // If someone later swaps in a keyed service, the key must not arrive as a
    // literal in source — this fails the moment one does.
    Object.values(BASEMAPS).forEach((config) => {
      expect(config.url).not.toMatch(/token=|api_?key=|access_token=/i);
    });
  });

  it('lets both base maps zoom in as far as the map allows', () => {
    // The map is created with maxZoom 19. A base map declaring less would stop
    // producing tiles partway in and leave grey squares under the markers at
    // exactly the zoom an officer uses to read a street.
    expect(BASEMAPS.street.maxZoom).toBe(19);
    expect(BASEMAPS.satellite.maxZoom).toBe(19);
  });
});
