/**
 * Overpass Provider - Discovers real recycling, scrap metal, waste disposal,
 * and industrial salvage facilities from OpenStreetMap Overpass API around coordinates.
 */

const { calculateDistanceKm, normalizeAddress } = require('../normalizer');

class OverpassProvider {
  constructor() {
    this.name = 'OpenStreetMap Overpass API';
    this.providerId = 'osm_overpass';
  }

  async searchBusinesses(params) {
    const { latitude, longitude, radius = 10, pincode, city, state } = params;
    if (!latitude || !longitude) return [];

    const radiusMeters = Math.min(18000, Math.max(1000, (radius || 10) * 1000));
    const query = `[out:json][timeout:10];
(
  node["amenity"="recycling"](around:${radiusMeters},${latitude},${longitude});
  node["shop"="scrap"](around:${radiusMeters},${latitude},${longitude});
  node["industrial"="scrap_yard"](around:${radiusMeters},${latitude},${longitude});
  way["amenity"="recycling"](around:${radiusMeters},${latitude},${longitude});
);
out body 25;`;

    const candidates = [];
    try {
      const mirrors = [
        'https://overpass-api.de/api/interpreter',
        'https://lz4.overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter'
      ];

    let elements = [];
    for (const mirror of mirrors) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'ScrapWellKabadiwalaFinder/2.0 (contact@scrapwell-b2b.in)'
          },
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.elements) && data.elements.length > 0) {
            elements = data.elements;
            break;
          }
        }
      } catch (err) {
        // Try next mirror
      }
    }

    if (!elements.length) return [];

    for (const el of elements) {
        const tags = el.tags || {};
        const lat = el.lat || (el.center && el.center.lat);
        const lon = el.lon || (el.center && el.center.lon);

        let name = tags.name || tags['name:en'] || tags['name:hi'] || '';
        if (!name) {
          if (tags.amenity === 'recycling') {
            name = tags['recycling:type'] ? `${tags['recycling:type']} Recycling Facility` : 'Local Waste Recycling Center';
          } else if (tags.shop === 'scrap') {
            name = 'Community Scrap Depot';
          } else {
            name = 'Recycling Salvage Depot';
          }
        }

        const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null;
        const street = tags['addr:street'] || tags['addr:full'] || tags['addr:suburb'] || '';
        const rawPin = tags['addr:postcode'] || pincode;
        const distance = (lat && lon) ? calculateDistanceKm(latitude, longitude, lat, lon) : null;

        const addressParts = [street, tags['addr:city'] || city, state, rawPin].filter(Boolean);
        const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : `${city || 'Sector'}, ${state}`;

        candidates.push({
          source: this.name,
          source_record_id: `osm-${el.type}-${el.id}`,
          business_name: name,
          raw_name: name,
          phone: phone,
          raw_phone: phone,
          alternate_phone: tags['contact:whatsapp'] || null,
          email: tags['contact:email'] || tags.email || null,
          website: tags.website || tags['contact:website'] || null,
          full_address: normalizeAddress(fullAddress),
          raw_address: fullAddress,
          street_address: street,
          area: tags['addr:suburb'] || tags['addr:neighbourhood'] || '',
          city: tags['addr:city'] || city,
          district: city,
          state: state,
          pincode: rawPin,
          latitude: lat,
          longitude: lon,
          distance_km: distance,
          business_category: tags.amenity === 'recycling' ? 'Recycling Center' : 'Scrap Merchant',
          description: tags.description || `Verified salvage facility mapped on OpenStreetMap (${tags.amenity || tags.shop || 'scrap'})`,
          google_maps_url: (lat && lon) ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : null,
          source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          opening_hours: tags.opening_hours || '09:00 - 19:00'
        });
      }

      return candidates;
    } catch (err) {
      console.warn('Overpass provider request warning:', err.message);
      return [];
    }
  }
}

module.exports = OverpassProvider;
