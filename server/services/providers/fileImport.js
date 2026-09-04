/**
 * FileImportProvider - Parses uploaded CSV data and extracts candidate leads.
 */

const { normalizePhone, normalizeAddress, normalizeBusinessName, normalizePincode } = require('../normalizer');

class FileImportProvider {
  constructor() {
    this.name = 'Uploaded Lead Sheet';
    this.providerId = 'file_import';
  }

  parseCsv(csvContent) {
    if (!csvContent || typeof csvContent !== 'string') return [];
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const candidates = [];

    for (let i = 1; i < lines.length; i++) {
      // Split by comma ignoring commas inside quotes
      const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
      const item = {};
      headers.forEach((h, idx) => {
        let val = (row[idx] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1).trim();
        }
        item[h] = val;
      });

      const name = item.business_name || item.name || item.company || '';
      const phone = item.phone || item.mobile || item.contact || '';
      if (!name && !phone) continue;

      candidates.push({
        source: this.name,
        source_record_id: `upload-${Date.now()}-${i}`,
        business_name: normalizeBusinessName(name),
        raw_name: name,
        phone: phone,
        raw_phone: phone,
        alternate_phone: item.alternate_phone || null,
        email: item.email || null,
        website: item.website || null,
        full_address: normalizeAddress(item.address || item.full_address || ''),
        raw_address: item.address || item.full_address || '',
        street_address: item.street || '',
        area: item.area || '',
        city: item.city || '',
        district: item.district || item.city || '',
        state: item.state || '',
        pincode: normalizePincode(item.pincode || item.pin || ''),
        latitude: parseFloat(item.latitude) || null,
        longitude: parseFloat(item.longitude) || null,
        business_category: item.category || 'Kabadiwala',
        description: item.description || 'Imported via CSV lead file',
        rating: parseFloat(item.rating) || null
      });
    }

    return candidates;
  }
}

module.exports = FileImportProvider;
