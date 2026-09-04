/**
 * Deduplicator - Multi-tier deduplication engine for ScrapWell lead discovery.
 * Clusters leads by normalized phone, website, business name + address, and fuzzy proximity,
 * preserving complete provenance in `sources_found` and assigning `duplicate_group_id`.
 */

const crypto = require('crypto');

// String similarity metric (Dice coefficient on character bigrams)
function getDiceSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const getBigrams = (str) => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const item of b1) {
    if (b2.has(item)) intersection++;
  }

  return (2 * intersection) / (b1.size + b2.size);
}

/**
 * Deduplicates an array of candidate leads and merges duplicate records
 */
function deduplicateLeads(candidates, existingLeads = []) {
  const mergedLeads = [];
  const allKnown = [...existingLeads];

  for (const candidate of candidates) {
    let matchedLead = null;
    let matchReason = '';

    // Tier 1: Exact Normalized Phone match
    if (candidate.normalized_phone) {
      matchedLead = mergedLeads.find(l => l.normalized_phone && l.normalized_phone === candidate.normalized_phone) ||
                    allKnown.find(l => l.normalized_phone && l.normalized_phone === candidate.normalized_phone);
      if (matchedLead) matchReason = 'normalized_phone';
    }

    // Tier 2: Source Record ID match from the same provider
    if (!matchedLead && candidate.source_record_id) {
      matchedLead = mergedLeads.find(l => l.source_record_id === candidate.source_record_id && l.source === candidate.source) ||
                    allKnown.find(l => l.source_record_id === candidate.source_record_id && l.source === candidate.source);
      if (matchedLead) matchReason = 'source_record_id';
    }

    // Tier 3: Website or Google Maps URL match
    if (!matchedLead && candidate.website && candidate.website.length > 5) {
      const cleanWeb = candidate.website.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      matchedLead = mergedLeads.find(l => l.website && l.website.toLowerCase().includes(cleanWeb)) ||
                    allKnown.find(l => l.website && l.website.toLowerCase().includes(cleanWeb));
      if (matchedLead) matchReason = 'website';
    }

    // Tier 4: Business name similarity + same area/pincode
    if (!matchedLead && candidate.normalized_business_name && candidate.pincode) {
      for (const target of [...mergedLeads, ...allKnown]) {
        if (target.pincode === candidate.pincode) {
          const sim = getDiceSimilarity(target.normalized_business_name, candidate.normalized_business_name);
          if (sim >= 0.78) {
            matchedLead = target;
            matchReason = `fuzzy_name_sim_${Math.round(sim * 100)}`;
            break;
          }
        }
      }
    }

    if (matchedLead) {
      // If matched against allKnown and not yet in mergedLeads, add it to mergedLeads so the search returns it!
      if (!mergedLeads.includes(matchedLead)) {
        mergedLeads.push(matchedLead);
      }

      // Merge candidate into matchedLead
      const existingSources = matchedLead.sources_found || [matchedLead.source || 'Unknown'];
      const newSource = candidate.source || 'Discovery Provider';
      if (!existingSources.includes(newSource)) {
        existingSources.push(newSource);
      }
      matchedLead.sources_found = existingSources;

      // Ensure duplicate group id
      if (!matchedLead.duplicate_group_id) {
        matchedLead.duplicate_group_id = `GRP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      }

      // Enrich missing fields if candidate has better data
      if (!matchedLead.phone && candidate.phone) {
        matchedLead.phone = candidate.phone;
        matchedLead.normalized_phone = candidate.normalized_phone;
      }
      if (!matchedLead.full_address && candidate.full_address) {
        matchedLead.full_address = candidate.full_address;
      }
      if (!matchedLead.latitude && candidate.latitude) {
        matchedLead.latitude = candidate.latitude;
        matchedLead.longitude = candidate.longitude;
      }
      if (!matchedLead.google_maps_url && candidate.google_maps_url) {
        matchedLead.google_maps_url = candidate.google_maps_url;
      }
      if (!matchedLead.rating && candidate.rating) {
        matchedLead.rating = candidate.rating;
        matchedLead.review_count = candidate.review_count;
      }

      // Log deduplication to timeline
      matchedLead.timeline = matchedLead.timeline || [];
      matchedLead.timeline.push({
        timestamp: new Date().toISOString(),
        event: 'MERGED_DUPLICATE',
        description: `Merged duplicate candidate from "${newSource}" (Matched via ${matchReason})`
      });

    } else {
      // New distinct lead
      const distinctLead = {
        ...candidate,
        duplicate_group_id: `GRP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        sources_found: candidate.sources_found || [candidate.source || 'Discovery Provider']
      };
      mergedLeads.push(distinctLead);
    }
  }

  return mergedLeads;
}

module.exports = {
  deduplicateLeads,
  getDiceSimilarity
};
