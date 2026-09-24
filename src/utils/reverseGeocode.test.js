import { describe, expect, it, vi } from 'vitest';
import {
  NOMINATIM_REVERSE_ENDPOINT,
  OSM_TO_SITIO_MAP,
  attributedToAnotherBarangay,
  autofillPatch,
  buildReverseUrl,
  extractLocation,
  isStreetName,
  matchKnownSitio,
  resolveSitio,
  reverseGeocode,
} from './reverseGeocode';
import { SITIOS } from './constants';

/**
 * Pin -> Sitio / street.
 *
 * The whole point of this suite is the NEGATIVE half: that a lookup which
 * cannot establish a street or a sitio says so, rather than producing the
 * nearest plausible answer. A crime record naming a street the report did not
 * is worse than one with the field blank, because nothing afterwards reveals
 * which it was.
 *
 * The network half is exercised through an injected fetch, so nothing here
 * reaches OpenStreetMap and the suite still runs on a machine with no
 * connection — the same condition the feature itself has to survive.
 */

/** A Nominatim jsonv2 body, with whatever address keys a test cares about. */
const response = (address) => ({ place_id: 1, address });

/** An injected fetch that answers once with `body`. */
const respondWith = (body, { ok = true } = {}) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body });

describe('the query asks for a street, not a district', () => {
  it('goes to OpenStreetMap at building/street zoom with address details', () => {
    const url = new URL(buildReverseUrl(14.7559, 121.0561));

    expect(url.origin + url.pathname).toBe(NOMINATIM_REVERSE_ENDPOINT);
    expect(url.searchParams.get('lat')).toBe('14.7559');
    expect(url.searchParams.get('lon')).toBe('121.0561');
    // 18 is the level at which `road` is the way the point is on. A lower zoom
    // answers with the district, which would fill Location / Street with
    // "Camarin" for every pin in the barangay.
    expect(url.searchParams.get('zoom')).toBe('18');
    // Without this there is no `address` object at all and nothing to read.
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(url.searchParams.get('format')).toBe('jsonv2');
  });

  it('encodes a negative coordinate rather than splicing it into the query', () => {
    const url = new URL(buildReverseUrl(-14.7559, -121.0561));
    expect(url.searchParams.get('lat')).toBe('-14.7559');
    expect(url.searchParams.get('lon')).toBe('-121.0561');
  });
});

describe('what a response is allowed to establish', () => {
  it('reads the street from `road`', () => {
    const found = extractLocation(response({ road: 'Narra Street' }), SITIOS);
    expect(found.street).toBe('Narra Street');
  });

  it('falls back to the pedestrian, footway and path keys, in that order', () => {
    // A dense barangay's addresses are frequently alleys and footpaths, which
    // Nominatim does not return under `road`.
    expect(extractLocation(response({ pedestrian: 'Mabuhay Walk' }), SITIOS).street)
      .toBe('Mabuhay Walk');
    expect(extractLocation(response({ footway: 'Rizal Alley' }), SITIOS).street)
      .toBe('Rizal Alley');
    expect(extractLocation(response({ path: 'Riverside Path' }), SITIOS).street)
      .toBe('Riverside Path');
    expect(
      extractLocation(response({ road: 'Narra Street', footway: 'Side Alley' }), SITIOS)
        .street,
    ).toBe('Narra Street');
  });

  it('returns null rather than a guess when no key names a street', () => {
    expect(extractLocation(response({ city: 'Caloocan' }), SITIOS).street).toBeNull();
    expect(extractLocation(response({}), SITIOS).street).toBeNull();
    expect(extractLocation({}, SITIOS).street).toBeNull();
    expect(extractLocation(null, SITIOS).street).toBeNull();
    expect(extractLocation('not json', SITIOS).street).toBeNull();
  });

  it('refuses a house number that landed in a street key', () => {
    // "12" written into Location / Street reads as a real answer.
    expect(extractLocation(response({ road: '12' }), SITIOS).street).toBeNull();
    expect(extractLocation(response({ road: '   ' }), SITIOS).street).toBeNull();
    expect(extractLocation(response({ road: 42 }), SITIOS).street).toBeNull();
  });
});

describe('a response attributed to another barangay establishes nothing', () => {
  /**
   * The case this guards, observed live. The stored boundary polygon accepts
   * 14.762186, 121.056860 as Barangay 178; Nominatim attributes that same point
   * to Barangay 187, Zone 16. A street taken from that response would be a
   * neighbouring barangay's street on a Barangay 178 crime record.
   */
  const barangay187 = {
    road: 'Kalantiaw Street',
    quarter: 'Barangay 187',
    suburb: 'Zone 16',
    city: 'Caloocan',
  };

  it('detects the mismatch wherever in the address it is named', () => {
    expect(attributedToAnotherBarangay(barangay187)).toBe(true);
    expect(attributedToAnotherBarangay({ village: 'Barangay 12' })).toBe(true);
    expect(attributedToAnotherBarangay({ neighbourhood: 'Brgy. 186' })).toBe(true);
    expect(attributedToAnotherBarangay({ suburb: 'Bgy 177' })).toBe(true);
  });

  it('accepts Barangay 178 in any of its spellings', () => {
    for (const spelling of ['Barangay 178', 'Brgy. 178', 'Bgy 178', 'barangay 0178']) {
      expect(attributedToAnotherBarangay({ quarter: spelling })).toBe(false);
    }
  });

  it('reads the barangay from `quarter`, which is where it actually arrives', () => {
    // The live service returns quarter: "Barangay 178", neighbourhood:
    // "Zone 15". A key whitelist that guessed `neighbourhood` would never fire.
    expect(
      attributedToAnotherBarangay({ quarter: 'Barangay 178', neighbourhood: 'Zone 15' }),
    ).toBe(false);
  });

  it('does not mistake a zone or a district for a barangay', () => {
    // "Zone 15" and "Camarin" are the zone and the district. Matching either as
    // a barangay would reject every lookup in the barangay.
    expect(attributedToAnotherBarangay({ neighbourhood: 'Zone 15' })).toBe(false);
    expect(attributedToAnotherBarangay({ suburb: 'Camarin' })).toBe(false);
    expect(attributedToAnotherBarangay({ city_district: 'District 3' })).toBe(false);
    expect(attributedToAnotherBarangay({ postcode: '1423' })).toBe(false);
  });

  it('treats a response that names no barangay as usable', () => {
    // This is a CROSS-check, not the boundary test. src/utils/geo.js and the
    // server's own polygon decide what may be recorded; refusing silence would
    // throw away streets wherever OpenStreetMap lacks the administrative tag.
    expect(attributedToAnotherBarangay({ road: 'Narra Street' })).toBe(false);
    expect(attributedToAnotherBarangay({})).toBe(false);
    expect(attributedToAnotherBarangay(null)).toBe(false);
  });

  it('refuses the whole result, not merely the street', () => {
    const found = extractLocation({ address: barangay187 }, SITIOS);
    expect(found).toEqual({ street: null, sitio: null, streetKind: null });
  });

  it('refuses it even when the response also names a sitio the form offers', () => {
    // Nothing on a foreign-barangay response is salvageable, including an area
    // name that happens to match.
    const found = extractLocation(
      { address: { ...barangay187, neighbourhood: 'Sitio 3' } },
      SITIOS,
    );
    expect(found).toEqual({ street: null, sitio: null, streetKind: null });
  });

  it('still fills a street when the barangay agrees', () => {
    const found = extractLocation(
      {
        address: {
          road: 'Espina Baba Street',
          quarter: 'Barangay 178',
          neighbourhood: 'Zone 15',
          suburb: 'Camarin',
        },
      },
      SITIOS,
    );
    expect(found.street).toBe('Espina Baba Street');
  });
});

describe('a facility name is not a street name', () => {
  /**
   * Observed live at 14.758822, 121.060372 — inside the barangay, matched
   * object `leisure/sports_hall` with an empty name, and Nominatim puts
   * "North Elementary" in `address.road`. Without this guard that is written
   * into Location / Street as though such a street existed.
   */
  it('rejects the facility name the live service actually returned', () => {
    expect(isStreetName('North Elementary')).toBe(false);
    expect(
      extractLocation(
        { address: { road: 'North Elementary', quarter: 'Barangay 178' } },
        SITIOS,
      ).street,
    ).toBeNull();
  });

  it('rejects other names with no street-type word in them', () => {
    expect(isStreetName('Barangay Hall')).toBe(false);
    expect(isStreetName('Camarin Health Center')).toBe(false);
    expect(isStreetName('San Vicente Chapel')).toBe(false);
  });

  it('keeps every street name the live service returned inside the barangay', () => {
    // The full set observed across 29 sampled points. If a future edit to the
    // rule drops one of these, it drops a real Barangay 178 street.
    const observed = [
      'Espina Baba Street', 'Buri Palm Street', 'Saint Matthew Street',
      'Saint George Street', 'Saint Cecilla Street', 'Violet Street',
      'H. Dela Costa Avenue', 'Iloilo Street', 'Durian Street',
      'Mangga Street', 'Vanguard Street', 'Pili Street', 'Kasoy Street',
      'Duhat Street', 'Saint Catherine Street', 'Ascencion Street',
      'Wawa Street', 'San Vicente Street', 'T. M. Kalaw Street',
    ];
    for (const name of observed) {
      expect(isStreetName(name), name).toBe(true);
    }
  });

  it('accepts the abbreviated and local street-type words too', () => {
    for (const name of ['Rizal St.', 'Mabini Ave', 'Narra Rd.', 'Kalayaan Ext.']) {
      expect(isStreetName(name), name).toBe(true);
    }
  });

  it('does not stop at a street key holding a facility name', () => {
    // A facility name in `road` must not end the search — a later key may hold
    // the real street.
    const found = extractLocation(
      {
        address: {
          road: 'North Elementary',
          footway: 'Sampaguita Alley',
          quarter: 'Barangay 178',
        },
      },
      SITIOS,
    );
    expect(found.street).toBe('Sampaguita Alley');
  });

  it('does not judge a street by the matched object\'s category', () => {
    // `category` looks like the discriminator and is not one: the same
    // `leisure` category that produced "North Elementary" also produced these.
    expect(isStreetName('T. M. Kalaw Street')).toBe(true);
    expect(isStreetName('Buri Palm Street')).toBe(true);
    // Nothing in the module reads `category` at all.
    expect(
      extractLocation(
        { category: 'leisure', type: 'pitch', address: { road: 'T. M. Kalaw Street' } },
        SITIOS,
      ).street,
    ).toBe('T. M. Kalaw Street');
  });
});

describe('a Sitio is never invented', () => {
  it('accepts an area name only when the form already offers it', () => {
    expect(matchKnownSitio('Sitio 3', SITIOS)).toBe('Sitio 3');
    expect(matchKnownSitio('sitio  3', SITIOS)).toBe('Sitio 3');
    expect(matchKnownSitio('  SITIO 3 ', SITIOS)).toBe('Sitio 3');
  });

  it('returns the form\'s own spelling, never OpenStreetMap\'s', () => {
    // So the value written can never be an option the <select> does not hold.
    expect(matchKnownSitio('SITIO 5', SITIOS)).toBe('Sitio 5');
  });

  it('does not match by prefix, containment or approximation', () => {
    expect(matchKnownSitio('Sitio 10', SITIOS)).toBeNull();
    expect(matchKnownSitio('Sitio', SITIOS)).toBeNull();
    expect(matchKnownSitio('Sitio 3 Extension', SITIOS)).toBeNull();
    expect(matchKnownSitio('Sitio Uno', SITIOS)).toBeNull();
    expect(matchKnownSitio('Camarin', SITIOS)).toBeNull();
  });

  it('rejects anything that is not a name', () => {
    expect(matchKnownSitio(null, SITIOS)).toBeNull();
    expect(matchKnownSitio('', SITIOS)).toBeNull();
    expect(matchKnownSitio('   ', SITIOS)).toBeNull();
    expect(matchKnownSitio('Sitio 1', null)).toBeNull();
  });

  it('leaves the sitio null for a real Barangay 178 response', () => {
    // WHAT THIS DOCUMENTS. Nothing in this repository maps a coordinate to a
    // Sitio, and SITIOS is the placeholder list Sitio 1..Sitio 7, so
    // OpenStreetMap's own neighbourhood names do not match any of them. The
    // street is filled; the Sitio stays the encoder's to choose. That is the
    // required behaviour, not a shortfall of the matcher.
    const found = extractLocation(
      response({
        road: 'Narra Street',
        neighbourhood: 'Camarin',
        suburb: 'Barangay 178',
        city: 'Caloocan',
      }),
      SITIOS,
    );

    expect(found.street).toBe('Narra Street');
    expect(found.sitio).toBeNull();
  });

  it('reads a sitio from any of the four area keys when it does match', () => {
    for (const key of ['neighbourhood', 'quarter', 'suburb', 'village']) {
      expect(extractLocation(response({ [key]: 'Sitio 7' }), SITIOS).sitio)
        .toBe('Sitio 7');
    }
  });

  it('reads a sitio from `residential` and from the matched object name', () => {
    expect(extractLocation(response({ residential: 'Sitio 2' }), SITIOS).sitio)
      .toBe('Sitio 2');
    expect(extractLocation({ name: 'Sitio 4', address: {} }, SITIOS).sitio)
      .toBe('Sitio 4');
  });

  it('keeps looking past an area that is not a sitio', () => {
    // "Zone 15" in `neighbourhood` must not hide the sitio in `village`.
    const found = extractLocation(
      response({ neighbourhood: 'Zone 15', village: 'Sitio 6' }),
      SITIOS,
    );
    expect(found.sitio).toBe('Sitio 6');
  });
});

describe('without a street, a landmark comes before an area and a zone comes last', () => {
  it('prefers a named street over any landmark or area', () => {
    const found = extractLocation(
      { name: 'Camarin Health Center', address: { road: 'Narra Street', neighbourhood: 'Zone 15' } },
      SITIOS,
    );
    expect(found).toMatchObject({ street: 'Narra Street', streetKind: 'street' });
  });

  it('uses the matched object name before any area', () => {
    const found = extractLocation(
      { name: 'North Elementary', address: { neighbourhood: 'Zone 15', suburb: 'Camarin' } },
      SITIOS,
    );
    expect(found).toMatchObject({ street: 'North Elementary', streetKind: 'place' });
  });

  it('reads a landmark, building or business from the place keys', () => {
    for (const key of ['amenity', 'shop', 'office', 'tourism', 'leisure', 'historic', 'building']) {
      expect(
        extractLocation(response({ [key]: 'Camarin Health Center', suburb: 'Camarin' }), SITIOS),
        key,
      ).toMatchObject({ street: 'Camarin Health Center', streetKind: 'place' });
    }
  });

  it('does not count the matched area itself as a landmark', () => {
    // When the matched object IS the neighbourhood, its name is an area.
    expect(
      extractLocation({ name: 'Camarin', address: { suburb: 'Camarin', neighbourhood: 'Zone 15' } }, SITIOS),
    ).toMatchObject({ street: 'Camarin', streetKind: 'area' });
    expect(extractLocation({ name: 'Zone 15', address: {} }, SITIOS))
      .toMatchObject({ street: 'Zone 15', streetKind: 'area' });
  });

  it('falls back through neighbourhood, residential, suburb and village, in that order', () => {
    const all = {
      neighbourhood: 'Maligaya',
      residential: 'Bagong Silang Homes',
      suburb: 'Camarin',
      village: 'Kaybiga',
    };
    const order = ['neighbourhood', 'residential', 'suburb', 'village'];
    order.forEach((key, i) => {
      const address = Object.fromEntries(order.slice(i).map((k) => [k, all[k]]));
      expect(extractLocation(response(address), SITIOS)).toMatchObject({
        street: all[key],
        streetKind: 'area',
      });
    });
  });

  it('uses a "Zone N" area only when nothing more specific is named', () => {
    // Every point in the barangay is in Zone 15, so it says the least.
    expect(
      extractLocation(response({ neighbourhood: 'Zone 15', suburb: 'Camarin' }), SITIOS).street,
    ).toBe('Camarin');
    expect(
      extractLocation(response({ neighbourhood: 'Zone 15', quarter: 'Barangay 178' }), SITIOS),
    ).toMatchObject({ street: 'Zone 15', streetKind: 'area' });
  });

  it('skips a barangay designation, which is the whole barangay and not a place in it', () => {
    const found = extractLocation(
      response({ neighbourhood: 'Barangay 178', suburb: 'Camarin' }),
      SITIOS,
    );
    expect(found.street).toBe('Camarin');
    expect(extractLocation({ name: 'Barangay 178', address: { quarter: 'Barangay 178' } }, SITIOS))
      .toEqual({ street: null, sitio: null, streetKind: null });
  });

  it('does not repeat the chosen Sitio in Location / Street', () => {
    const found = extractLocation(
      response({ neighbourhood: 'Sitio 3', suburb: 'Camarin' }),
      SITIOS,
    );
    expect(found).toMatchObject({ sitio: 'Sitio 3', street: 'Camarin', streetKind: 'area' });
  });

  it('refuses a house number or blank in a place or area key as it does in a street key', () => {
    expect(
      extractLocation({ name: '7', address: { amenity: ' ', neighbourhood: '12', suburb: '  ' } }, SITIOS),
    ).toEqual({ street: null, sitio: null, streetKind: null });
  });

  it('uses the area when the only street key holds a facility name', () => {
    const found = extractLocation(
      response({ road: 'North Elementary', quarter: 'Barangay 178', neighbourhood: 'Zone 15' }),
      SITIOS,
    );
    expect(found).toMatchObject({ street: 'Zone 15', streetKind: 'area' });
  });
});

describe('OpenStreetMap areas translate to official Sitios only through the table', () => {
  const table = { 'Maligaya Subdivision': 'Sitio 3', Kaybiga: 'Sitio 5' };

  it('ships with no entries, so no Sitio is assigned until the client confirms one', () => {
    // Every Barangay 178 point returns Zone 15 and Camarin; an entry for
    // either would put one Sitio on every incident.
    expect(OSM_TO_SITIO_MAP).toEqual({});
    expect(Object.isFrozen(OSM_TO_SITIO_MAP)).toBe(true);
    expect(
      extractLocation(response({ neighbourhood: 'Zone 15', suburb: 'Camarin' }), SITIOS).sitio,
    ).toBeNull();
  });

  it('selects the translated Sitio when an area is a key of the table', () => {
    expect(resolveSitio('Maligaya Subdivision', SITIOS, table)).toBe('Sitio 3');
    expect(resolveSitio('  maligaya   subdivision ', SITIOS, table)).toBe('Sitio 3');
    const found = extractLocation(
      response({ neighbourhood: 'Zone 15', village: 'Kaybiga' }),
      SITIOS,
      table,
    );
    expect(found).toMatchObject({ sitio: 'Sitio 5', street: 'Kaybiga', streetKind: 'area' });
  });

  it('still takes an area that already is an official Sitio', () => {
    expect(resolveSitio('Sitio 7', SITIOS, table)).toBe('Sitio 7');
  });

  it('ignores a translation that is not one of the dropdown options', () => {
    expect(
      resolveSitio('Maligaya Subdivision', SITIOS, { 'Maligaya Subdivision': 'Sitio 99' }),
    ).toBeNull();
  });

  it('does not match a table key by prefix or containment', () => {
    expect(resolveSitio('Maligaya', SITIOS, table)).toBeNull();
    expect(resolveSitio('Maligaya Subdivision Phase 2', SITIOS, table)).toBeNull();
    expect(resolveSitio(null, SITIOS, table)).toBeNull();
  });

  it('is applied by the network wrapper too', async () => {
    const fetchImpl = respondWith(response({ residential: 'Maligaya Subdivision' }));
    await expect(
      reverseGeocode(14.7559, 121.0561, { fetchImpl, sitios: SITIOS, sitioMap: table }),
    ).resolves.toMatchObject({ sitio: 'Sitio 3' });
  });

  it('refuses a translation on a response attributed to another barangay', () => {
    expect(
      extractLocation(response({ quarter: 'Barangay 187', village: 'Kaybiga' }), SITIOS, table),
    ).toEqual({ street: null, sitio: null, streetKind: null });
  });
});

describe('a failed lookup is not an answer', () => {
  it('reports null — not an empty result — when the request fails', async () => {
    // Distinct from { street: null }: "offline" must not be shown to an
    // encoder as "OpenStreetMap does not name a street here".
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(
      reverseGeocode(14.7559, 121.0561, { fetchImpl, sitios: SITIOS }),
    ).resolves.toBeNull();
  });

  it('reports null on a non-OK response', async () => {
    const fetchImpl = respondWith(response({ road: 'Narra Street' }), { ok: false });
    await expect(
      reverseGeocode(14.7559, 121.0561, { fetchImpl, sitios: SITIOS }),
    ).resolves.toBeNull();
  });

  it('reports null on a malformed body instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await expect(
      reverseGeocode(14.7559, 121.0561, { fetchImpl, sitios: SITIOS }),
    ).resolves.toBeNull();
  });

  it('never rejects, so a superseded pin cannot produce an unhandled error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const promise = reverseGeocode(14.7559, 121.0561, {
      fetchImpl,
      sitios: SITIOS,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).resolves.toBeNull();
  });

  it('returns what it read when the request succeeds', async () => {
    const fetchImpl = respondWith(response({ road: 'Narra Street' }));
    await expect(
      reverseGeocode(14.7559, 121.0561, { fetchImpl, sitios: SITIOS }),
    ).resolves.toEqual({ street: 'Narra Street', sitio: null, streetKind: 'street' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe(buildReverseUrl(14.7559, 121.0561));
  });
});

describe('what the form is allowed to write', () => {
  const nothingWritten = { street: null, sitio: null };

  it('fills a blank field', () => {
    const { patch, written } = autofillPatch(
      { street: '', sitio: '' },
      { street: 'Narra Street', sitio: 'Sitio 7' },
      nothingWritten,
    );

    expect(patch).toEqual({ street: 'Narra Street', sitio: 'Sitio 7' });
    expect(written).toEqual({ street: 'Narra Street', sitio: 'Sitio 7' });
  });

  it('never overwrites text the encoder typed', () => {
    const { patch, written } = autofillPatch(
      { street: 'Beside the covered court', sitio: 'Sitio 2' },
      { street: 'Narra Street', sitio: 'Sitio 7' },
      nothingWritten,
    );

    expect(patch).toEqual({});
    // Not remembered as ours either — so if the encoder later clears the
    // field, the next lookup treats it as blank rather than as its own.
    expect(written).toEqual(nothingWritten);
  });

  it('replaces its own stale value when the pin moves', () => {
    const { patch } = autofillPatch(
      { street: 'Narra Street', sitio: '' },
      { street: 'Acacia Street', sitio: null },
      { street: 'Narra Street', sitio: null },
    );

    expect(patch).toEqual({ street: 'Acacia Street' });
  });

  it('withdraws its own value when the new point supports nothing', () => {
    // The value was the map's claim about a point the record no longer has.
    const { patch, written } = autofillPatch(
      { street: 'Narra Street', sitio: '' },
      { street: null, sitio: null },
      { street: 'Narra Street', sitio: null },
    );

    expect(patch).toEqual({ street: '' });
    expect(written).toEqual(nothingWritten);
  });

  it('does not withdraw the encoder\'s value when nothing is determined', () => {
    const { patch } = autofillPatch(
      { street: 'Beside the covered court', sitio: 'Sitio 2' },
      { street: null, sitio: null },
      nothingWritten,
    );

    expect(patch).toEqual({});
  });

  it('patches nothing when a blank field stays blank', () => {
    const { patch } = autofillPatch(
      { street: '', sitio: '' },
      { street: null, sitio: null },
      nothingWritten,
    );

    // An empty patch is what lets the caller apply it unconditionally without
    // causing a render, and therefore without re-running the lookup.
    expect(patch).toEqual({});
  });

  it('patches nothing when the lookup repeats a value it already wrote', () => {
    const { patch, written } = autofillPatch(
      { street: 'Narra Street', sitio: '' },
      { street: 'Narra Street', sitio: null },
      { street: 'Narra Street', sitio: null },
    );

    expect(patch).toEqual({});
    expect(written).toEqual({ street: 'Narra Street', sitio: null });
  });

  it('treats the two fields independently', () => {
    // The ordinary Barangay 178 case: a street is determined, a sitio is not,
    // and the encoder has already chosen the sitio themselves.
    const { patch } = autofillPatch(
      { street: '', sitio: 'Sitio 4' },
      { street: 'Narra Street', sitio: null },
      nothingWritten,
    );

    expect(patch).toEqual({ street: 'Narra Street' });
  });

  it('treats whitespace-only text as blank', () => {
    const { patch } = autofillPatch(
      { street: '   ', sitio: null },
      { street: 'Narra Street', sitio: null },
      nothingWritten,
    );

    expect(patch).toEqual({ street: 'Narra Street' });
  });
});
