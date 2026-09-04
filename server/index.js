const express = require('express');
const cors = require('cors');
const path = require('path');
const DB = require('./db');
const { isValidIndianPincode, resolvePincode } = require('./services/pincodeResolver');
const { generateQueries } = require('./services/queryGenerator');
const { normalizePhone, normalizeBusinessName, normalizeAddress } = require('./services/normalizer');
const { deduplicateLeads } = require('./services/deduplicator');
const { classifyLead } = require('./services/classifier');
const discoveryEngine = require('./services/providers');
const googleSheetsService = require('./services/googleSheets');
const { generateWhatsAppLink, recordWhatsAppAction } = require('./services/whatsappService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static assets if built
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const clientPublic = path.join(__dirname, '..', 'client');
app.use(express.static(clientDist));
app.use(express.static(clientPublic, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
  }
}));

// ==================== SEARCH APIS ====================

app.post('/api/search/start', async (req, res) => {
  const { pincode, categories = [], radius = 10, providers = [] } = req.body;

  if (!pincode || !isValidIndianPincode(pincode)) {
    return res.status(400).json({
      error: 'Invalid Indian PIN code. Must be exactly 6 digits not starting with 0.'
    });
  }

  const cleanPin = String(pincode).trim();
  const settings = DB.getSettings();

  // Create search job record
  const job = DB.createSearchJob({
    pincode: cleanPin,
    radius: radius || settings.default_radius_km
  });

  // Run resolution and discovery asynchronously
  // Note: We await here so client gets immediate results or can poll progress
  try {
    // Step 1: Resolve Pincode
    job.progress_steps.push({
      step: 'GEO_RESOLUTION',
      label: `Resolving postal geography for ${cleanPin}...`,
      status: 'RUNNING',
      timestamp: new Date().toISOString()
    });
    DB.updateSearchJob(job.job_id, { progress_steps: job.progress_steps });

    const geo = await resolvePincode(cleanPin);

    job.city = geo.city;
    job.district = geo.district;
    job.state = geo.state;
    job.latitude = geo.latitude;
    job.longitude = geo.longitude;

    job.progress_steps.push({
      step: 'GEO_RESOLVED',
      label: `Resolved to ${geo.city}, ${geo.state} (${geo.latitude?.toFixed(4)}, ${geo.longitude?.toFixed(4)})`,
      status: 'DONE',
      timestamp: new Date().toISOString()
    });

    // Step 2: Generate localized queries
    const queries = generateQueries(geo, categories, settings.max_provider_requests || 20);
    job.queries_used = queries;

    job.progress_steps.push({
      step: 'QUERY_GEN',
      label: `Generated ${queries.length} localized Hindi/English queries`,
      status: 'DONE',
      timestamp: new Date().toISOString()
    });
    DB.updateSearchJob(job.job_id, {
      city: geo.city,
      district: geo.district,
      state: geo.state,
      latitude: geo.latitude,
      longitude: geo.longitude,
      queries_used: queries,
      progress_steps: job.progress_steps
    });

    // Step 3: Run Discovery Engine
    const { candidates, providersUsed } = await discoveryEngine.runDiscovery({
      pincode: cleanPin,
      city: geo.city,
      district: geo.district,
      state: geo.state,
      latitude: geo.latitude,
      longitude: geo.longitude,
      radius: radius || settings.default_radius_km,
      queries: queries,
      offices: geo.offices || geo.post_offices || [],
      post_offices: geo.post_offices || geo.offices || [],
      local_areas: geo.local_areas || [],
      postal_circle: geo.circle || geo.state
    }, (progressUpdate) => {
      job.progress_steps.push({
        ...progressUpdate,
        timestamp: new Date().toISOString()
      });
      DB.updateSearchJob(job.job_id, { progress_steps: job.progress_steps });
    });

    job.providers_used = providersUsed;

    // Step 4: Normalization
    job.progress_steps.push({
      step: 'NORMALIZATION',
      label: `Normalizing phone numbers, addresses, and business names for ${candidates.length} candidates...`,
      status: 'RUNNING',
      timestamp: new Date().toISOString()
    });

    const normalizedCandidates = candidates.map(c => {
      const normPhone = normalizePhone(c.phone || c.raw_phone);
      const normName = normalizeBusinessName(c.business_name || c.raw_name);
      const normAddr = normalizeAddress(c.full_address || c.raw_address);

      return {
        ...c,
        business_name: normName,
        normalized_business_name: normName,
        phone: c.phone || normPhone,
        normalized_phone: normPhone,
        full_address: normAddr,
        pincode: cleanPin,
        city: geo.city || c.city,
        district: geo.district || c.district,
        state: geo.state || c.state
      };
    });

    job.progress_steps.push({
      step: 'NORMALIZATION',
      label: `Normalized ${normalizedCandidates.length} candidate records`,
      status: 'DONE',
      timestamp: new Date().toISOString()
    });

    // Step 5: Deduplication
    job.progress_steps.push({
      step: 'DEDUPLICATION',
      label: 'Clustering duplicate listings across providers...',
      status: 'RUNNING',
      timestamp: new Date().toISOString()
    });

    const existingLeads = DB.getLeads({ pincode: cleanPin });
    const distinctCandidates = deduplicateLeads(normalizedCandidates, existingLeads);

    job.progress_steps.push({
      step: 'DEDUPLICATION',
      label: `Clustered ${normalizedCandidates.length} candidates into ${distinctCandidates.length} unique businesses`,
      status: 'DONE',
      timestamp: new Date().toISOString()
    });

    // Step 6: Classification & Acquisition Scoring
    job.progress_steps.push({
      step: 'CLASSIFICATION',
      label: 'Scoring relevance and AI classifying into ScrapWell target tiers...',
      status: 'RUNNING',
      timestamp: new Date().toISOString()
    });

    let qualifiedCount = 0;
    let reviewCount = 0;
    let rejectedCount = 0;

    const savedLeads = [];
    for (const item of distinctCandidates) {
      const classificationResult = classifyLead(item);
      const leadToSave = {
        ...item,
        ...classificationResult
      };

      if (leadToSave.lead_status === 'QUALIFIED') qualifiedCount++;
      else if (leadToSave.lead_status === 'NEEDS_REVIEW') reviewCount++;
      else if (leadToSave.lead_status === 'REJECTED') rejectedCount++;

      const saved = DB.upsertLead(leadToSave);
      savedLeads.push(saved);
    }

    // Retrieve all leads stored for this pincode
    const allPincodeLeads = DB.getLeads({ pincode: cleanPin });
    const finalLeads = allPincodeLeads.length > 0 ? allPincodeLeads : savedLeads;
    
    qualifiedCount = finalLeads.filter(l => l.lead_status === 'QUALIFIED').length;
    reviewCount = finalLeads.filter(l => l.lead_status === 'NEEDS_REVIEW').length;
    rejectedCount = finalLeads.filter(l => l.lead_status === 'REJECTED').length;

    job.progress_steps.push({
      step: 'CLASSIFICATION',
      label: `Classified: ${qualifiedCount} Qualified, ${reviewCount} Needs Review, ${rejectedCount} Excluded`,
      status: 'DONE',
      timestamp: new Date().toISOString()
    });

    // Step 7: Optional Auto Google Sheets Sync
    let autoSyncResult = null;
    if (settings.auto_sheets_sync && qualifiedCount > 0) {
      if (settings.google_webhook_url && settings.google_webhook_url.startsWith('http')) {
        job.progress_steps.push({
          step: 'SHEETS_AUTO_SYNC',
          label: `Auto-syncing ${qualifiedCount} qualified leads to Google Sheets...`,
          status: 'RUNNING',
          timestamp: new Date().toISOString()
        });

        const qualifiedIds = finalLeads
          .filter(l => l.lead_status === 'QUALIFIED')
          .map(l => l.id);

        autoSyncResult = await googleSheetsService.syncLeads(qualifiedIds, {
          mode: settings.google_mode
        });

        job.progress_steps.push({
          step: 'SHEETS_AUTO_SYNC',
          label: autoSyncResult.success
            ? `Auto-synced ${autoSyncResult.synced_count} leads to Google Sheets!`
            : `Google Sheets warning: ${autoSyncResult.message}`,
          status: autoSyncResult.success ? 'DONE' : 'WARNING',
          timestamp: new Date().toISOString()
        });
      } else {
        job.progress_steps.push({
          step: 'SHEETS_AUTO_SYNC',
          label: 'Google Sheets auto-sync pending: Webhook not configured (Use "Copy for Sheets" or paste Webhook in Settings)',
          status: 'DONE',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Complete Job
    job.status = 'COMPLETED';
    job.completed_at = new Date().toISOString();
    job.total_candidates = normalizedCandidates.length || finalLeads.length;
    job.qualified_count = qualifiedCount;
    job.review_count = reviewCount;
    job.rejected_count = rejectedCount;

    DB.updateSearchJob(job.job_id, job);

    res.json({
      success: true,
      job,
      geo,
      stats: {
        total_discovered: normalizedCandidates.length || finalLeads.length,
        unique_leads: finalLeads.length,
        qualified: qualifiedCount,
        needs_review: reviewCount,
        rejected: rejectedCount
      },
      leads: finalLeads,
      auto_sync: autoSyncResult
    });

  } catch (err) {
    console.error('Search execution error:', err);
    job.status = 'FAILED';
    job.error_message = err.message;
    job.completed_at = new Date().toISOString();
    DB.updateSearchJob(job.job_id, job);

    res.status(500).json({
      error: err.message,
      job
    });
  }
});

app.get('/api/search/progress/:jobId', (req, res) => {
  const job = DB.getSearchJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Resumable search endpoint
app.post('/api/search/resume/:jobId', async (req, res) => {
  const job = DB.getSearchJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // Re-run search for the pincode to resume
  req.body = { pincode: job.pincode, radius: job.radius };
  return app._router.handle(req, res);
});

// ==================== LEADS APIS ====================

app.get('/api/leads', (req, res) => {
  const { pincode, lead_status, classification, whatsapp_status, search, sortBy, sortOrder, page = 1, limit = 50 } = req.query;

  const allLeads = DB.getLeads({
    pincode,
    lead_status,
    classification,
    whatsapp_status,
    search,
    sortBy,
    sortOrder
  });

  const pageNum = parseInt(page, 10) || 1;
  const pageSize = parseInt(limit, 10) || 50;
  const startIndex = (pageNum - 1) * pageSize;
  const paginated = allLeads.slice(startIndex, startIndex + pageSize);

  res.json({
    total: allLeads.length,
    page: pageNum,
    limit: pageSize,
    total_pages: Math.ceil(allLeads.length / pageSize),
    leads: paginated
  });
});

app.get('/api/leads/:id', (req, res) => {
  const lead = DB.getLeadById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Append generated WhatsApp links for Hindi and English
  const whatsapp_link_hi = generateWhatsAppLink(lead, 'hi');
  const whatsapp_link_en = generateWhatsAppLink(lead, 'en');

  res.json({
    ...lead,
    whatsapp_link_hi,
    whatsapp_link_en
  });
});

app.patch('/api/leads/:id', (req, res) => {
  const lead = DB.getLeadById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const updates = req.body;
  const updated = DB.updateLead(req.params.id, updates);
  res.json(updated);
});

app.delete('/api/leads/:id', (req, res) => {
  const success = DB.deleteLead(req.params.id);
  if (!success) return res.status(404).json({ error: 'Lead not found' });
  res.json({ success: true });
});

// Batch Actions (Bulk Qualify, Bulk Reject, Bulk Opt-In)
app.post('/api/leads/batch', (req, res) => {
  const { action, lead_ids = [] } = req.body;
  if (!lead_ids.length) return res.status(400).json({ error: 'No lead IDs provided' });

  let updatedCount = 0;
  for (const id of lead_ids) {
    if (action === 'QUALIFY') {
      DB.updateLead(id, {
        lead_status: 'QUALIFIED',
        new_timeline_event: { event: 'QUALIFIED', description: 'Marked qualified via bulk action' }
      });
      updatedCount++;
    } else if (action === 'REJECT') {
      DB.updateLead(id, {
        lead_status: 'REJECTED',
        new_timeline_event: { event: 'REJECTED', description: 'Rejected via bulk action' }
      });
      updatedCount++;
    } else if (action === 'OPT_IN') {
      DB.updateLead(id, {
        whatsapp_opt_in_status: 'OPTED_IN',
        lead_status: 'OPTED_IN',
        new_timeline_event: { event: 'OPTED_IN', description: 'Opt-in recorded via bulk action' }
      });
      updatedCount++;
    }
  }

  res.json({ success: true, updated_count: updatedCount });
});

// Import CSV
app.post('/api/leads/import', (req, res) => {
  const { csv_data } = req.body;
  if (!csv_data) return res.status(400).json({ error: 'No CSV data provided' });

  const importedCandidates = discoveryEngine.fileImporter.parseCsv(csv_data);
  const normalized = importedCandidates.map(c => {
    const normPhone = normalizePhone(c.phone);
    const normName = normalizeBusinessName(c.business_name);
    const normAddr = normalizeAddress(c.full_address);
    return {
      ...c,
      business_name: normName,
      normalized_business_name: normName,
      phone: c.phone || normPhone,
      normalized_phone: normPhone,
      full_address: normAddr
    };
  });

  const existing = DB.getLeads();
  const deduplicated = deduplicateLeads(normalized, existing);
  const saved = [];

  for (const item of deduplicated) {
    const classified = classifyLead(item);
    const lead = DB.upsertLead({ ...item, ...classified });
    saved.push(lead);
  }

  res.json({
    success: true,
    total_parsed: importedCandidates.length,
    leads_imported: saved.length
  });
});

// ==================== GOOGLE SHEETS APIS ====================

app.post('/api/sheets/sync', async (req, res) => {
  const { lead_ids = [], mode, spreadsheet_name, webhook_url } = req.body;
  try {
    const result = await googleSheetsService.syncLeads(lead_ids, {
      mode,
      spreadsheetName: spreadsheet_name,
      webhookUrl: webhook_url
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sheets/logs', (req, res) => {
  res.json(DB.getSyncLogs());
});

app.get('/api/sheets/export/csv', (req, res) => {
  const { pincode, lead_status } = req.query;
  const leads = DB.getLeads({ pincode, lead_status });
  const rawCsv = googleSheetsService.generateCsv(leads);
  // Add UTF-8 BOM so Microsoft Excel and Windows open Hindi/special chars perfectly
  const csv = '\uFEFF' + rawCsv;

  const cleanPin = pincode ? String(pincode).trim() : 'all';
  const filename = `scrapwell_leads_${cleanPin}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
  res.status(200).send(csv);
});

app.get('/api/sheets/export/tsv', (req, res) => {
  const { pincode, lead_status } = req.query;
  const leads = DB.getLeads({ pincode, lead_status });
  const tsv = googleSheetsService.generateTsv(leads);
  res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
  res.status(200).send(tsv);
});

app.post('/api/sheets/test-webhook', async (req, res) => {
  const { webhook_url } = req.body;
  if (!webhook_url || !webhook_url.startsWith('http')) {
    return res.status(400).json({ error: 'Please enter a valid Google Webhook URL starting with https://' });
  }
  try {
    const testPayload = {
      mode: 'TEST',
      spreadsheetName: 'ScrapWell Leads',
      headers: ['Test ID', 'Status', 'Timestamp'],
      rows: [['TEST-001', 'Connection Successful', new Date().toISOString()]],
      leads: []
    };
    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok && response.status !== 302) {
      throw new Error(`Google Webhook returned HTTP status ${response.status}`);
    }
    res.json({ success: true, message: 'Google Sheets Webhook reached and verified successfully!' });
  } catch (err) {
    res.status(500).json({ error: `Connection failed: ${err.message}` });
  }
});

// ==================== WHATSAPP APIS ====================

app.post('/api/whatsapp/action', (req, res) => {
  const { lead_id, action, notes } = req.body;
  if (!lead_id || !action) return res.status(400).json({ error: 'lead_id and action required' });

  const updated = recordWhatsAppAction(lead_id, action, notes);
  if (!updated) return res.status(404).json({ error: 'Lead not found' });
  res.json({ success: true, lead: updated });
});

// ==================== ANALYTICS APIS ====================

app.get('/api/analytics', (req, res) => {
  const leads = DB.getLeads();
  const jobs = DB.getAllSearchJobs();

  const totalDiscovered = leads.length;
  const qualified = leads.filter(l => l.lead_status === 'QUALIFIED').length;
  const needsReview = leads.filter(l => l.lead_status === 'NEEDS_REVIEW').length;
  const rejected = leads.filter(l => l.lead_status === 'REJECTED').length;
  const hasPhone = leads.filter(l => Boolean(l.normalized_phone)).length;
  const hasWebsite = leads.filter(l => Boolean(l.website)).length;
  const whatsappEligible = leads.filter(l => Boolean(l.whatsapp_possible)).length;
  const optedIn = leads.filter(l => ['OPTED_IN', 'INTERESTED', 'REGISTERED', 'ACTIVATED'].includes(l.whatsapp_opt_in_status) || l.lead_status === 'OPTED_IN').length;
  const registered = leads.filter(l => l.lead_status === 'REGISTERED' || l.whatsapp_opt_in_status === 'REGISTERED' || l.lead_status === 'ACTIVATED').length;
  const activated = leads.filter(l => l.lead_status === 'ACTIVATED' || l.whatsapp_opt_in_status === 'ACTIVATED').length;

  // Duplicate metrics
  const duplicateGroups = new Set(leads.map(l => l.duplicate_group_id).filter(Boolean));
  const multiSourceLeads = leads.filter(l => (l.sources_found || []).length > 1).length;

  // Averages
  const avgScore = leads.length > 0
    ? Math.round(leads.reduce((acc, l) => acc + (l.acquisition_score || 0), 0) / leads.length)
    : 0;

  const leadsWithDist = leads.filter(l => l.distance_km !== null && l.distance_km !== undefined);
  const avgDistance = leadsWithDist.length > 0
    ? Math.round((leadsWithDist.reduce((acc, l) => acc + l.distance_km, 0) / leadsWithDist.length) * 10) / 10
    : 0;

  // Rates
  const qualificationRate = totalDiscovered > 0 ? Math.round((qualified / totalDiscovered) * 1000) / 10 : 0;
  const phoneAvailabilityRate = totalDiscovered > 0 ? Math.round((hasPhone / totalDiscovered) * 1000) / 10 : 0;
  const optInRate = hasPhone > 0 ? Math.round((optedIn / hasPhone) * 1000) / 10 : 0;
  const activationRate = optedIn > 0 ? Math.round((activated / optedIn) * 1000) / 10 : 0;
  const duplicateRate = totalDiscovered > 0 ? Math.round((multiSourceLeads / totalDiscovered) * 1000) / 10 : 0;

  // Pincode Breakdown
  const pinMap = {};
  for (const lead of leads) {
    const pin = lead.pincode || 'Other';
    if (!pinMap[pin]) {
      pinMap[pin] = {
        pincode: pin,
        city: lead.city || 'Unknown',
        state: lead.state || '',
        discovered: 0,
        qualified: 0,
        phones: 0,
        opted_in: 0
      };
    }
    pinMap[pin].discovered++;
    if (lead.lead_status === 'QUALIFIED') pinMap[pin].qualified++;
    if (lead.normalized_phone) pinMap[pin].phones++;
    if (['OPTED_IN', 'REGISTERED', 'ACTIVATED'].includes(lead.whatsapp_opt_in_status)) pinMap[pin].opted_in++;
  }

  res.json({
    metrics: {
      total_discovered: totalDiscovered,
      qualified,
      needs_review: needsReview,
      rejected,
      phone_available: hasPhone,
      website_available: hasWebsite,
      whatsapp_eligible: whatsappEligible,
      opted_in: optedIn,
      registered,
      activated,
      active_search_jobs: jobs.filter(j => j.status === 'RUNNING').length,
      completed_search_jobs: jobs.filter(j => j.status === 'COMPLETED').length
    },
    rates: {
      qualification_rate: qualificationRate,
      phone_availability_rate: phoneAvailabilityRate,
      opt_in_rate: optInRate,
      activation_rate: activationRate,
      duplicate_rate: duplicateRate,
      avg_acquisition_score: avgScore,
      avg_distance_km: avgDistance
    },
    funnel: [
      { step: 'Discovered', count: totalDiscovered, pct: 100 },
      { step: 'Qualified', count: qualified, pct: totalDiscovered > 0 ? Math.round((qualified / totalDiscovered) * 100) : 0 },
      { step: 'Phone Verified', count: hasPhone, pct: totalDiscovered > 0 ? Math.round((hasPhone / totalDiscovered) * 100) : 0 },
      { step: 'Opted In', count: optedIn, pct: qualified > 0 ? Math.round((optedIn / qualified) * 100) : 0 },
      { step: 'Registered', count: registered, pct: optedIn > 0 ? Math.round((registered / optedIn) * 100) : 0 },
      { step: 'Activated', count: activated, pct: registered > 0 ? Math.round((activated / registered) * 100) : 0 }
    ],
    pincode_breakdown: Object.values(pinMap)
  });
});

// ==================== SEARCH HISTORY ====================

app.get('/api/history', (req, res) => {
  res.json(DB.getAllSearchJobs());
});

// ==================== SETTINGS APIS ====================

app.get('/api/settings', (req, res) => {
  res.json(DB.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = DB.updateSettings(req.body);
  res.json(updated);
});

// Root fallback for SPA (Express 5 compatible)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
  }
  next();
});

// Export Express app for Vercel Serverless Function
module.exports = app;

// Start server when running directly in local / standalone Node
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ScrapWell Kabadiwala Finder server running on port ${PORT}`);
  });
}
