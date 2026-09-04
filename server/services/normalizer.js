/**
 * Normalizer - Normalizes Indian phone numbers, business names, addresses, and pincodes
 * while retaining raw source values for auditing and provenance.
 */

/**
 * Normalizes an Indian phone number to E.164 standard: +91XXXXXXXXXX
 * Handles:
 *  - 09876543210 -> +919876543210
 *  - 9876543210 -> +919876543210
 *  - +91 98765 43210 -> +919876543210
 *  - 0124-4567890 (landlines) -> preserved with std code
 */
function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;

  // Extract all digits and optional leading plus
  let cleaned = rawPhone.replace(/[^\d+]/g, '');

  // Handle double leading zeros or +
  if (cleaned.startsWith('0091')) {
    cleaned = '+91' + cleaned.slice(4);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    // e.g. 09876543210
    cleaned = '+91' + cleaned.slice(1);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    // e.g. 919876543210
    cleaned = '+' + cleaned;
  } else if (!cleaned.startsWith('+') && cleaned.length === 10) {
    // standard 10 digit Indian mobile e.g. 9876543210
    cleaned = '+91' + cleaned;
  }

  // Validate if it matches standard Indian 10-digit mobile (+91 followed by 6, 7, 8, or 9 and 9 digits)
  const mobileRegex = /^\+91[6-9]\d{9}$/;
  if (mobileRegex.test(cleaned)) {
    return cleaned;
  }

  // If it's a 10-digit number that starts with other digits or valid international, return if valid
  if (/^\+?\d{10,13}$/.test(cleaned)) {
    return cleaned.startsWith('+') ? cleaned : `+91${cleaned.slice(-10)}`;
  }

  return null;
}

/**
 * Normalizes Indian business name:
 * - Trims whitespace
 * - Removes repeated punctuation
 * - Title-cases properly
 * - Cleans redundant noisy strings like "Pvt Ltd.", "Shop", etc. while retaining core name
 */
function normalizeBusinessName(rawName) {
  if (!rawName || typeof rawName !== 'string') return 'Unknown Business';

  let cleaned = rawName
    .replace(/[«»"'\*_\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove common SEO prefixes/suffixes like "Best Kabadiwala in...", "- Justdial", etc.
  cleaned = cleaned
    .replace(/\s*-\s*(Justdial|IndiaMART|Sulekha|Facebook|Google Maps|Scrap dealers|Tradeindia).*/i, '')
    .replace(/^(Top|Best|Verified)\s+/i, '')
    .trim();

  // Convert to clean Title Case
  cleaned = cleaned.replace(/\w\S*/g, (txt) => {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });

  return cleaned || rawName.trim();
}

/**
 * Normalizes Indian street and locality address
 */
function normalizeAddress(rawAddress) {
  if (!rawAddress || typeof rawAddress !== 'string') return '';

  let cleaned = rawAddress
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ', ')
    .replace(/,\s*-\s*,/g, ', ')
    .trim();

  // Standardize common terms
  cleaned = cleaned
    .replace(/\bSec\b\.?/gi, 'Sector')
    .replace(/\bRd\b\.?/gi, 'Road')
    .replace(/\bNr\b\.?/gi, 'Near')
    .replace(/\bOpp\b\.?/gi, 'Opposite')
    .replace(/\bPh\b\.?/gi, 'Phase')
    .replace(/\bIndl\b\.?/gi, 'Industrial')
    .replace(/\bGurgaon\b/gi, 'Gurugram');

  return cleaned;
}

/**
 * Normalizes Indian 6-digit Pincode
 */
function normalizePincode(rawPincode) {
  if (!rawPincode) return '';
  const digits = String(rawPincode).replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const pin = digits.slice(0, 6);
    if (/^[1-9]\d{5}$/.test(pin)) return pin;
  }
  return '';
}

/**
 * Calculates geographic distance in KM using Haversine formula
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Math.round(d * 10) / 10;
}

module.exports = {
  normalizePhone,
  normalizeBusinessName,
  normalizeAddress,
  normalizePincode,
  calculateDistanceKm
};
