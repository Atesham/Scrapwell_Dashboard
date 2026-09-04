/**
 * PincodeResolver - Resolves Indian 6-digit pincodes using India Post API
 * and OpenStreetMap Nominatim for exact geographic coordinates.
 */

// Fallback centroids for major Indian postal regions in case OSM rate-limits or is offline
const MAJOR_CENTROIDS = {
  '122': { city: 'Gurugram', state: 'Haryana', lat: 28.4595, lon: 77.0266 },
  '110': { city: 'New Delhi', state: 'Delhi', lat: 28.6139, lon: 77.2090 },
  '400': { city: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lon: 72.8777 },
  '560': { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  '500': { city: 'Hyderabad', state: 'Telangana', lat: 17.3850, lon: 78.4867 },
  '600': { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  '700': { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639 },
  '380': { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714 },
  '411': { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lon: 73.8567 },
  '302': { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 },
  '201': { city: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lon: 77.3910 }
};

function isValidIndianPincode(pincode) {
  return /^[1-9][0-9]{5}$/.test(String(pincode).trim());
}

async function resolvePincode(pincode) {
  const pin = String(pincode).trim();
  if (!isValidIndianPincode(pin)) {
    throw new Error(`Invalid Indian PIN code "${pin}". It must be exactly 6 digits not starting with 0.`);
  }

  let postalData = null;
  let city = '';
  let district = '';
  let state = '';
  let circle = '';
  let division = '';
  let postOffices = [];
  let localAreas = [];

  // Step 1: Query India Post API
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      headers: { 'User-Agent': 'ScrapWellKabadiwalaFinder/1.0' },
      signal: AbortSignal.timeout(6000)
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0] && data[0].Status === 'Success' && Array.isArray(data[0].PostOffice)) {
        postalData = data[0].PostOffice;
        const first = postalData[0];
        district = first.District || '';
        state = first.State || '';
        circle = first.Circle || '';
        division = first.Division || '';
        city = district || first.Name || '';

        postOffices = postalData.map(po => ({
          name: po.Name,
          branchType: po.BranchType,
          deliveryStatus: po.DeliveryStatus
        }));

        localAreas = postalData.map(po => po.Name).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn(`India Post API lookup warning for ${pin}:`, err.message);
  }

  // Fallback defaults if postal API had no record or timed out
  const prefix3 = pin.slice(0, 3);
  if (!state && MAJOR_CENTROIDS[prefix3]) {
    city = city || MAJOR_CENTROIDS[prefix3].city;
    district = district || MAJOR_CENTROIDS[prefix3].city;
    state = MAJOR_CENTROIDS[prefix3].state;
  }

  // Step 2: Query OpenStreetMap Nominatim for exact lat/lon
  let lat = null;
  let lon = null;
  let displayName = '';

  try {
    // Attempt postalcode search first
    const osmUrl = `https://nominatim.openstreetmap.org/search?postalcode=${pin}&country=India&format=json&limit=1`;
    const osmRes = await fetch(osmUrl, {
      headers: { 'User-Agent': 'ScrapWellKabadiwalaFinder/1.0 (admin@scrapwell.com)' },
      signal: AbortSignal.timeout(5000)
    });

    if (osmRes.ok) {
      const osmData = await osmRes.json();
      if (Array.isArray(osmData) && osmData.length > 0) {
        lat = parseFloat(osmData[0].lat);
        lon = parseFloat(osmData[0].lon);
        displayName = osmData[0].display_name;
      }
    }
  } catch (err) {
    console.warn(`Nominatim postalcode lookup warning for ${pin}:`, err.message);
  }

  // Step 3: Fallback geocoding by city/district if pin coordinates were not found
  if ((lat === null || lon === null) && (district || city)) {
    try {
      const fallbackUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent((district || city) + ', ' + state + ', India')}&format=json&limit=1`;
      const fbRes = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'ScrapWellKabadiwalaFinder/1.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData.length > 0) {
          lat = parseFloat(fbData[0].lat);
          lon = parseFloat(fbData[0].lon);
          displayName = fbData[0].display_name;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Final fallback to known regional centroid
  if (lat === null || lon === null) {
    if (MAJOR_CENTROIDS[prefix3]) {
      lat = MAJOR_CENTROIDS[prefix3].lat;
      lon = MAJOR_CENTROIDS[prefix3].lon;
      displayName = `${pin}, ${MAJOR_CENTROIDS[prefix3].city}, ${MAJOR_CENTROIDS[prefix3].state}, India`;
    } else {
      // Default central India coordinates
      lat = 20.5937;
      lon = 78.9629;
      displayName = `${pin}, India`;
    }
  }

  return {
    pincode: pin,
    city: city || district || 'Unknown City',
    district: district || city || 'Unknown District',
    state: state || 'India',
    circle,
    division,
    latitude: lat,
    longitude: lon,
    display_name: displayName,
    post_offices: postOffices,
    offices: postOffices,
    local_areas: Array.from(new Set(localAreas))
  };
}

module.exports = {
  isValidIndianPincode,
  resolvePincode
};
