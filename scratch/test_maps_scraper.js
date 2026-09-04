const cheerio = require('cheerio');

async function testGoogleMapsScraper(query) {
  console.log('Testing query:', query);
  
  // 1. DuckDuckGo HTML search for Google Maps places
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8'
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.result').each((i, elem) => {
      const title = $(elem).find('.result__title a').text().trim();
      const href = $(elem).find('.result__title a').attr('href') || '';
      const snippet = $(elem).find('.result__snippet').text().trim();
      if (title) {
        results.push({ title, href, snippet });
      }
    });
    console.log(`DuckDuckGo returned ${results.length} results:`);
    results.slice(0, 5).forEach(r => console.log(' -', r.title, '=>', r.snippet.slice(0, 100)));
  } catch (err) {
    console.error('DDG error:', err.message);
  }

  // 2. Test OpenStreetMap Nominatim amenity=recycling or craft/shop
  try {
    const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('scrap ' + query)}&countrycodes=in&limit=10`;
    const res = await fetch(osmUrl, {
      headers: { 'User-Agent': 'ScrapWellBot/2.0 (scrapwell@example.com)' }
    });
    const data = await res.json();
    console.log(`OSM Nominatim returned ${data.length} results:`);
    data.slice(0, 3).forEach(d => console.log(' -', d.display_name));
  } catch (err) {
    console.error('OSM error:', err.message);
  }
}

testGoogleMapsScraper('kabadiwala 122001');
