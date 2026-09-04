async function testNominatim() {
  const queries = [
    'kabadiwala in Delhi',
    'scrap dealer Gurgaon',
    'recycling in Bengaluru',
    'scrap dealer 110025'
  ];

  for (const q of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=in`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'ScrapWellApp/2.1 (contact@scrapwell-b2b.in)',
          'Accept': 'application/json'
        }
      });
      console.log('Query:', q, 'Status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('Results:', data.length);
        data.forEach(d => console.log('  -', d.name || d.display_name));
      } else {
        console.log('Error text:', await res.text());
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
}

testNominatim();
