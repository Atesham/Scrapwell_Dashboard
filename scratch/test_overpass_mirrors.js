async function testOverpass(lat, lon) {
  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  const query = `[out:json][timeout:10];
(
  node["amenity"="recycling"](around:15000,${lat},${lon});
  node["shop"="scrap"](around:15000,${lat},${lon});
  node["industrial"="scrap_yard"](around:15000,${lat},${lon});
  way["amenity"="recycling"](around:15000,${lat},${lon});
);
out body 20;`;

  for (const mirror of mirrors) {
    try {
      console.log('Trying mirror:', mirror);
      const start = Date.now();
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ScrapWell/2.0'
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(8000)
      });
      console.log('Status:', res.status, 'Time:', Date.now() - start, 'ms');
      if (res.ok) {
        const data = await res.json();
        console.log('Elements found:', data.elements?.length);
        if (data.elements?.length) {
          console.log('Sample:', data.elements[0].tags);
          return;
        }
      }
    } catch (e) {
      console.log('Mirror failed:', mirror, e.message);
    }
  }
}

testOverpass(28.56, 77.28); // 110025 Okhla / South Delhi
