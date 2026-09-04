/**
 * Classifier - AI & Heuristic Classification Layer for ScrapWell leads.
 * Classifies businesses into ScrapWell target categories, calculates classification confidence,
 * relevance score, and B2B acquisition score.
 */

const CLASSIFICATION_RULES = [
  {
    type: 'KABADIWALA',
    keywords: ['kabadiwala', 'kabadi wala', 'kabadi', 'raddi wala', 'raddi dealer', 'old newspaper buyer', 'bhangar wala', 'bhangar'],
    baseScore: 95
  },
  {
    type: 'SCRAP_DEALER',
    keywords: ['scrap dealer', 'scrap merchant', 'scrap traders', 'scrap buyer', 'scrap mart', 'scrap shop'],
    baseScore: 92
  },
  {
    type: 'METAL_SCRAP_DEALER',
    keywords: ['metal scrap', 'iron scrap', 'copper scrap', 'brass scrap', 'aluminum scrap', 'lohe ka kabadi', 'steel scrap'],
    baseScore: 90
  },
  {
    type: 'SCRAP_COLLECTOR',
    keywords: ['scrap collector', 'doorstep scrap', 'free pickup scrap', 'scrap collection', 'junk removal'],
    baseScore: 88
  },
  {
    type: 'WASTE_RECYCLER',
    keywords: ['waste recycler', 'plastic waste', 'e-waste', 'ewaste', 'recycler', 'scrap processing', 'polymer recycling'],
    baseScore: 86
  },
  {
    type: 'RECYCLING_CENTER',
    keywords: ['recycling center', 'recycling facility', 'mrf', 'material recovery', 'waste transfer station'],
    baseScore: 84
  }
];

const EXCLUSION_KEYWORDS = [
  'antique shop', 'second hand clothes', 'pawn shop', 'car rental', 'jewelry showroom',
  'gold buyer only', 'furniture rental', 'book store only'
];

function classifyLead(lead) {
  const textCorpus = [
    lead.business_name || '',
    lead.description || '',
    lead.business_category || '',
    (lead.detected_categories || []).join(' '),
    lead.full_address || '',
    lead.source_url || ''
  ].join(' ').toLowerCase();

  // Check exclusion keywords
  for (const ex of EXCLUSION_KEYWORDS) {
    if (textCorpus.includes(ex)) {
      return {
        classification: 'NOT_RELEVANT',
        classification_confidence: 85,
        relevance_score: 20,
        acquisition_score: 15,
        lead_status: 'REJECTED',
        detected_categories: ['Irrelevant Commercial']
      };
    }
  }

  let bestClassification = 'NEEDS_REVIEW';
  let bestConfidence = 50;
  let detected = [];

  for (const rule of CLASSIFICATION_RULES) {
    let matchCount = 0;
    for (const kw of rule.keywords) {
      if (textCorpus.includes(kw)) {
        matchCount++;
        detected.push(kw);
      }
    }

    if (matchCount > 0) {
      const confidence = Math.min(98, 65 + matchCount * 12);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestClassification = rule.type;
      }
    }
  }

  // If no specific category matched, check for generic "scrap" or "waste"
  if (bestClassification === 'NEEDS_REVIEW') {
    if (textCorpus.includes('scrap') || textCorpus.includes('waste') || textCorpus.includes('recycling')) {
      bestClassification = 'RELATED';
      bestConfidence = 68;
    }
  }

  // Calculate Relevance Score (0-100)
  let relevanceScore = bestConfidence;
  if (lead.pincode) relevanceScore += 5;
  if (lead.distance_km !== null && lead.distance_km !== undefined) {
    if (lead.distance_km <= 3) relevanceScore += 10;
    else if (lead.distance_km <= 7) relevanceScore += 5;
    else if (lead.distance_km > 20) relevanceScore -= 15;
  }
  relevanceScore = Math.max(10, Math.min(99, relevanceScore));

  // Calculate B2B Acquisition Score (0-100)
  // Higher if verified phone exists, nearby, high confidence, and direct kabadiwala
  let acquisitionScore = 40;
  const hasPhone = Boolean(lead.normalized_phone);
  const isWhatsAppPossible = hasPhone && lead.normalized_phone.startsWith('+91');

  if (hasPhone) acquisitionScore += 30;
  if (['KABADIWALA', 'SCRAP_DEALER', 'METAL_SCRAP_DEALER'].includes(bestClassification)) {
    acquisitionScore += 20;
  } else if (['SCRAP_COLLECTOR', 'WASTE_RECYCLER', 'RECYCLING_CENTER'].includes(bestClassification)) {
    acquisitionScore += 14;
  }

  if (bestConfidence >= 80) acquisitionScore += 10;
  if (lead.rating && lead.rating >= 4.0) acquisitionScore += 5;
  if (lead.distance_km !== null && lead.distance_km <= 5) acquisitionScore += 5;

  acquisitionScore = Math.max(10, Math.min(99, acquisitionScore));

  // Determine Lead Status
  let leadStatus = 'DISCOVERED';
  if (bestClassification === 'NOT_RELEVANT') {
    leadStatus = 'REJECTED';
  } else if (acquisitionScore >= 75 && hasPhone) {
    leadStatus = 'QUALIFIED';
  } else if (acquisitionScore >= 50) {
    leadStatus = 'NEEDS_REVIEW';
  } else {
    leadStatus = 'DISCOVERED';
  }

  return {
    classification: bestClassification,
    classification_confidence: bestConfidence,
    relevance_score: relevanceScore,
    acquisition_score: acquisitionScore,
    lead_status: leadStatus,
    whatsapp_possible: isWhatsAppPossible,
    whatsapp_opt_in_status: isWhatsAppPossible ? 'OPT_IN_PENDING' : 'NOT_ELIGIBLE',
    detected_categories: Array.from(new Set(detected))
  };
}

module.exports = {
  classifyLead,
  CLASSIFICATION_RULES
};
