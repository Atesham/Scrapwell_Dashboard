const cheerio = require('cheerio');

async function testGoogleParse() {
  const q = 'kabadiwala scrap dealer Gurgaon 122001';
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=in`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  
  // Search for business titles / links
  const items = [];
  $('h3').each((i, el) => {
    const title = $(el).text().trim();
    const parentA = $(el).closest('a');
    const href = parentA.attr('href');
    if (title && href) {
      items.push({ title, href });
    }
  });

  console.log(`Found ${items.length} h3 links:`);
  items.slice(0, 10).forEach(it => console.log(' -', it.title, '=>', it.href));
}

testGoogleParse();
