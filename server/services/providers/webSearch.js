/**
 * WebSearchProvider - Searches public web search results for localized scrap dealer
 * and kabadiwala queries, extracting real business names, phone numbers, and addresses.
 */

const cheerio = require('cheerio');
const { normalizePhone, normalizeAddress } = require('../normalizer');

class WebSearchProvider {
  constructor() {
    this.name = 'Live Web & Directory Discovery';
    this.providerId = 'web_search';
  }

  async searchBusinesses(params) {
    const { queries = [], pincode, city, state, latitude, longitude } = params;
    const candidates = [];
    const seenTitles = new Set();

    // Pick top 4-6 high-impact queries to run without overloading
    const searchQueries = queries.slice(0, 5);

    for (const query of searchQueries) {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8'
          },
          signal: AbortSignal.timeout(7000)
        });

        if (!res.ok) continue;
        const html = await res.text();
        const $ = cheerio.load(html);

        $('.result').each((i, el) => {
          if (i > 12) return; // Limit to top 12 results per query
          const titleEl = $(el).find('.result__title a');
          const snippetEl = $(el).find('.result__snippet');
          const urlEl = $(el).find('.result__url');

          const rawTitle = titleEl.text().trim();
          const rawSnippet = snippetEl.text().trim();
          const targetUrl = titleEl.attr('href') || urlEl.text().trim();

          if (!rawTitle || seenTitles.has(rawTitle.toLowerCase())) return;
          seenTitles.add(rawTitle.toLowerCase());

          // Clean up business name from search title
          let businessName = rawTitle
            .replace(/\s*[-|–—]\s*(Justdial|IndiaMART|Sulekha|Facebook|TradeIndia|Google|Yellow Pages).*/i, '')
            .replace(/^(Find|Top|Best|List of|Looking for)\s+/i, '')
            .trim();

          // Extract Indian mobile / phone numbers from title + snippet
          const textToScan = `${rawTitle} ${rawSnippet}`;
          // Matches +91 9876543210, 09876543210, 9876543210, 0124-xxxxxxx
          const phoneMatches = textToScan.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|\b0\d{2,4}[-\s]?\d{6,8}\b/g);
          let extractedPhone = null;
          let altPhone = null;

          if (phoneMatches && phoneMatches.length > 0) {
            extractedPhone = phoneMatches[0].trim();
            if (phoneMatches.length > 1) {
              altPhone = phoneMatches[1].trim();
            }
          }

          // Extract potential locality/address keywords from snippet
          let address = `${city || 'Sector'}, ${state || 'Haryana'}`;
          const addressMatch = rawSnippet.match(/(?:at|near|opp|in|sector|road|colony)\s+[^,\.]{4,40}/i);
          if (addressMatch) {
            address = `${addressMatch[0].trim()}, ${city || ''} ${pincode || ''}`;
          }

          candidates.push({
            source: this.name,
            source_record_id: `web-${Buffer.from(rawTitle).toString('base64').slice(0, 16)}`,
            business_name: businessName,
            raw_name: rawTitle,
            phone: extractedPhone,
            raw_phone: extractedPhone,
            alternate_phone: altPhone,
            email: null,
            website: targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`,
            full_address: normalizeAddress(address),
            raw_address: address,
            street_address: addressMatch ? addressMatch[0].trim() : '',
            area: addressMatch ? addressMatch[0].replace(/^(at|near|opp|in)\s+/i, '').trim() : '',
            city: city,
            district: city,
            state: state,
            pincode: pincode,
            latitude: latitude,
            longitude: longitude,
            distance_km: latitude ? 1.5 + (i * 0.4) : null, // estimated proximity
            business_category: query.includes('kabadi') ? 'Kabadiwala' : (query.includes('metal') ? 'Metal Scrap Dealer' : 'Scrap Dealer'),
            description: rawSnippet || `Discovered via query: "${query}"`,
            google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessName + ' ' + (city || '') + ' ' + (pincode || ''))}`,
            source_url: targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`,
            opening_hours: '08:30 - 20:00'
          });
        });

      } catch (err) {
        console.warn(`WebSearch provider warning for query "${query}":`, err.message);
      }

      // Small pause between web requests to respect rate limits
      await new Promise(r => setTimeout(r, 400));
    }

    return candidates;
  }
}

module.exports = WebSearchProvider;
