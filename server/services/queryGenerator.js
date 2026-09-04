/**
 * QueryGenerator - Generates localized English, Hindi, and Hinglish search queries
 * for Indian pincodes, cities, local areas, and target scrap business categories.
 */

const CATEGORY_TERM_MAP = {
  KABADIWALA: ['kabadiwala', 'kabadi wala', 'kabadi shop', 'kabadi'],
  SCRAP_DEALER: ['scrap dealer', 'scrap merchant', 'scrap shop', 'scrap yard'],
  SCRAP_COLLECTOR: ['scrap collector', 'doorstep scrap collection', 'scrap buyer'],
  WASTE_PAPER_DEALER: ['waste paper dealer', 'raddi wala', 'raddi dealer', 'old newspaper buyer'],
  JUNK_DEALER: ['junk dealer', 'bhangar wala', 'bhangar dealer', 'junk shop'],
  RECYCLING_CENTER: ['recycling center', 'waste recycling center', 'recycling facility'],
  WASTE_RECYCLER: ['waste recycler', 'plastic waste recycler', 'e waste scrap dealer'],
  METAL_SCRAP_DEALER: ['metal scrap dealer', 'iron scrap dealer', 'lohe ka kabadi', 'copper brass scrap dealer']
};

function generateQueries(geoInfo, selectedCategories = [], maxQueries = 25) {
  const { pincode, city, district, state, local_areas = [] } = geoInfo;
  const queries = new Set();

  const activeCategories = (selectedCategories && selectedCategories.length > 0)
    ? selectedCategories
    : Object.keys(CATEGORY_TERM_MAP);

  const cityName = city || district || '';
  const areaName = (local_areas && local_areas.length > 0) ? local_areas[0] : '';

  // 1. High-priority direct pincode queries
  queries.add(`kabadiwala ${pincode}`);
  queries.add(`scrap dealer ${pincode}`);
  queries.add(`scrap shop near ${pincode}`);
  queries.add(`kabadi ${pincode}`);
  queries.add(`raddi dealer ${pincode}`);
  queries.add(`recycling center ${pincode}`);

  // 2. City + Pincode combinations
  if (cityName) {
    queries.add(`scrap dealer ${cityName} ${pincode}`);
    queries.add(`kabadiwala ${cityName}`);
    queries.add(`raddi wala ${cityName}`);
    queries.add(`metal scrap dealer ${cityName}`);
    queries.add(`waste paper dealer ${cityName}`);
    queries.add(`junk dealer ${cityName}`);
    queries.add(`old newspaper buyer ${cityName}`);
    queries.add(`bhangar wala ${cityName}`);
  }

  // 3. Category-specific queries
  for (const cat of activeCategories) {
    const terms = CATEGORY_TERM_MAP[cat] || [cat.toLowerCase().replace(/_/g, ' ')];
    const primaryTerm = terms[0];
    const secondaryTerm = terms[1] || primaryTerm;

    queries.add(`${primaryTerm} ${pincode}`);
    if (cityName) {
      queries.add(`${secondaryTerm} ${cityName}`);
    }
  }

  // 4. Local area queries for all localities & wards across the entered PIN code
  if (local_areas && local_areas.length > 0) {
    for (const area of local_areas.slice(0, 12)) {
      if (area && area.toLowerCase() !== cityName.toLowerCase()) {
        queries.add(`kabadiwala ${area} ${pincode}`);
        queries.add(`scrap dealer ${area} ${pincode}`);
      }
    }
  }

  // 5. Hindi / Hinglish colloquial variants
  queries.add(`kabadi wala phone number ${pincode}`);
  queries.add(`lohe ka kabadi ${cityName || pincode}`);
  queries.add(`raddi wala near me ${pincode}`);

  // Convert Set to Array and limit to maxQueries
  const list = Array.from(queries);
  return list.slice(0, maxQueries);
}

module.exports = {
  generateQueries,
  CATEGORY_TERM_MAP
};
