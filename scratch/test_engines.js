const cheerio = require('cheerio');

async function testEngines() {
  const pin = '110025';
  const query = `kabadiwala scrap dealer ${pin}`;
  console.log('Testing query:', query);

  // Test 1: Bing Search
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    console.log('Bing status:', res.status);
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.b_algo').each((i, el) => {
      const title = $(el).find('h2 a').text().trim();
      const href = $(el).find('h2 a').attr('href');
      const snippet = $(el).find('.b_caption p').text().trim();
      if (title) results.push({ title, href, snippet });
    });
    console.log('Bing found:', results.length);
    results.slice(0, 5).forEach(r => console.log('  [Bing]', r.title, '=>', r.snippet.slice(0, 80)));
  } catch (e) {
    console.log('Bing failed:', e.message);
  }

  // Test 2: Yahoo Search
  try {
    const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    console.log('Yahoo status:', res.status);
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $('.algo').each((i, el) => {
      const title = $(el).find('h3 a').text().trim();
      const href = $(el).find('h3 a').attr('href');
      const snippet = $(el).find('.compText').text().trim();
      if (title) results.push({ title, href, snippet });
    });
    console.log('Yahoo found:', results.length);
    results.slice(0, 5).forEach(r => console.log('  [Yahoo]', r.title, '=>', r.snippet.slice(0, 80)));
  } catch (e) {
    console.log('Yahoo failed:', e.message);
  }
}

testEngines();
