async function testGoogle() {
  const q = 'kabadiwala scrap dealer 122001';
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=in`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  console.log('Google status:', res.status);
  const text = await res.text();
  console.log('Google length:', text.length);
  const hasCaptcha = text.includes('detected unusual traffic') || text.includes('recaptcha');
  console.log('Has CAPTCHA:', hasCaptcha);
  
  // Extract business names / phone numbers / map links
  const cheerio = require('cheerio');
  const $ = cheerio.load(text);
  
  // Look for Google Local Pack / Maps results
  console.log('Local pack matches:', $('[data-local-attribute]').length, $('.rllt__details').length, $('div[role="heading"]').length);
  
  $('div[role="heading"]').each((i, el) => {
    const text = $(el).text().trim();
    if (text) console.log('Heading:', text);
  });
}

testGoogle();
