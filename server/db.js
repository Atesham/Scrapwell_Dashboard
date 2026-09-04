const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const SEED_FILE = path.join(__dirname, '..', 'data', 'scrapwell_db.json');
const DATA_DIR = isServerless ? '/tmp' : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'scrapwell_db.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Ignore in read-only environment
}

const DEFAULT_SETTINGS = {
  default_radius_km: 12,
  max_provider_requests: 20,
  ai_confidence_threshold: 70,
  max_leads_per_search: 100,
  auto_sheets_sync: true,
  google_mode: 'MASTER', // 'MASTER' or 'PER_PINCODE'
  google_sheet_name: 'ScrapWell Kabadiwala Leads',
  google_sheet_id: '',
  google_webhook_url: '',
  google_service_account_json: '',
  whatsapp_template_hi: 'नमस्ते {{business_name}}, ScrapWell टीम की ओर से नमस्कार! हम {{pincode}} क्षेत्र में कबाड़ी एवं स्क्रैप व्यापारियों को हमारे सत्यापित नेटवर्क से जोड़ रहे हैं। भारी मात्रा में बिक्री और तुरंत डिजिटल भुगतान के लिए क्या आप हमसे जुड़ना चाहेंगे?',
  whatsapp_template_en: 'Hello {{business_name}}, this is ScrapWell B2B Network. We are onboarding verified scrap dealers and kabadiwalas in {{pincode}} for guaranteed corporate bulk scrap buying with same-day digital payments. Are you interested in partnering with us?',
  follow_up_count: 3,
  follow_up_interval_days: 2
};

let db = {
  leads: [],
  search_jobs: [],
  sync_logs: [],
  settings: { ...DEFAULT_SETTINGS }
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db.leads = Array.isArray(parsed.leads) ? parsed.leads : [];
      db.search_jobs = Array.isArray(parsed.search_jobs) ? parsed.search_jobs : [];
      db.sync_logs = Array.isArray(parsed.sync_logs) ? parsed.sync_logs : [];
      db.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    } else if (fs.existsSync(SEED_FILE)) {
      const raw = fs.readFileSync(SEED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db.leads = Array.isArray(parsed.leads) ? parsed.leads : [];
      db.search_jobs = Array.isArray(parsed.search_jobs) ? parsed.search_jobs : [];
      db.sync_logs = Array.isArray(parsed.sync_logs) ? parsed.sync_logs : [];
      db.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
      saveDatabase();
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.warn('Database load notice:', err.message);
  }
}

function saveDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.warn('Database save notice (serverless in-memory mode):', err.message);
  }
}

loadDatabase();

const DB = {
  // Leads
  getLeads(filter = {}) {
    let result = [...db.leads];

    if (filter.pincode) {
      result = result.filter(l => l.pincode === String(filter.pincode).trim());
    }
    if (filter.lead_status) {
      result = result.filter(l => l.lead_status === filter.lead_status);
    }
    if (filter.classification) {
      result = result.filter(l => l.classification === filter.classification);
    }
    if (filter.whatsapp_status) {
      result = result.filter(l => l.whatsapp_opt_in_status === filter.whatsapp_status);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(l =>
        (l.business_name && l.business_name.toLowerCase().includes(q)) ||
        (l.normalized_phone && l.normalized_phone.includes(q)) ||
        (l.full_address && l.full_address.toLowerCase().includes(q)) ||
        (l.area && l.area.toLowerCase().includes(q)) ||
        (l.city && l.city.toLowerCase().includes(q))
      );
    }

    // Sort
    const sortBy = filter.sortBy || 'acquisition_score';
    const sortOrder = filter.sortOrder === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      const valA = a[sortBy] ?? 0;
      const valB = b[sortBy] ?? 0;
      if (typeof valA === 'string') {
        return sortOrder * valA.localeCompare(String(valB));
      }
      return sortOrder * (valA - valB);
    });

    return result;
  },

  getLeadById(id) {
    return db.leads.find(l => l.id === id);
  },

  upsertLead(leadData) {
    const now = new Date().toISOString();
    let existingIndex = -1;

    if (leadData.id) {
      existingIndex = db.leads.findIndex(l => l.id === leadData.id);
    }
    if (existingIndex === -1 && leadData.normalized_phone) {
      existingIndex = db.leads.findIndex(l => l.normalized_phone === leadData.normalized_phone);
    }

    if (existingIndex >= 0) {
      const existing = db.leads[existingIndex];
      const mergedSources = Array.from(new Set([...(existing.sources_found || []), ...(leadData.sources_found || [])]));
      const updated = {
        ...existing,
        ...leadData,
        sources_found: mergedSources,
        timeline: [
          ...(existing.timeline || []),
          ...(leadData.new_timeline_event ? [leadData.new_timeline_event] : [])
        ],
        last_seen_at: now,
        updated_at: now
      };
      delete updated.new_timeline_event;
      db.leads[existingIndex] = updated;
      saveDatabase();
      return updated;
    } else {
      const newId = leadData.id || `SW-LEAD-${leadData.pincode || 'GEN'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const newLead = {
        ...leadData,
        id: newId,
        sources_found: leadData.sources_found || [leadData.source || 'Direct Discovery'],
        timeline: leadData.timeline || [
          {
            timestamp: now,
            event: 'DISCOVERED',
            description: `Discovered via ${leadData.source || 'ScrapWell Engine'} in Pincode ${leadData.pincode || 'N/A'}`
          }
        ],
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now
      };
      db.leads.push(newLead);
      saveDatabase();
      return newLead;
    }
  },

  updateLead(id, updates) {
    const idx = db.leads.findIndex(l => l.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    const existing = db.leads[idx];

    let timeline = [...(existing.timeline || [])];
    if (updates.new_timeline_event) {
      timeline.push({
        timestamp: now,
        ...updates.new_timeline_event
      });
      delete updates.new_timeline_event;
    }

    const updated = {
      ...existing,
      ...updates,
      timeline,
      updated_at: now
    };
    db.leads[idx] = updated;
    saveDatabase();
    return updated;
  },

  deleteLead(id) {
    const idx = db.leads.findIndex(l => l.id === id);
    if (idx >= 0) {
      db.leads.splice(idx, 1);
      saveDatabase();
      return true;
    }
    return false;
  },

  // Search Jobs
  createSearchJob(jobData) {
    const now = new Date().toISOString();
    const job = {
      job_id: jobData.job_id || `JOB-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      pincode: jobData.pincode,
      city: jobData.city || '',
      state: jobData.state || '',
      district: jobData.district || '',
      latitude: jobData.latitude || null,
      longitude: jobData.longitude || null,
      radius: jobData.radius || 10,
      queries_used: jobData.queries_used || [],
      providers_used: jobData.providers_used || [],
      total_candidates: 0,
      qualified_count: 0,
      review_count: 0,
      rejected_count: 0,
      started_at: now,
      completed_at: null,
      status: 'RUNNING',
      error_message: null,
      progress_steps: [
        { step: 'VALIDATION', label: `Validating Pincode ${jobData.pincode}`, status: 'DONE', timestamp: now }
      ]
    };
    db.search_jobs.unshift(job);
    saveDatabase();
    return job;
  },

  updateSearchJob(jobId, updates) {
    const job = db.search_jobs.find(j => j.job_id === jobId);
    if (!job) return null;
    Object.assign(job, updates);
    saveDatabase();
    return job;
  },

  getSearchJob(jobId) {
    return db.search_jobs.find(j => j.job_id === jobId);
  },

  getAllSearchJobs() {
    return [...db.search_jobs];
  },

  // Sync Logs
  addSyncLog(logData) {
    const log = {
      sync_id: `SYNC-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...logData
    };
    db.sync_logs.unshift(log);
    if (db.sync_logs.length > 100) db.sync_logs.pop();
    saveDatabase();
    return log;
  },

  getSyncLogs() {
    return [...db.sync_logs];
  },

  // Settings
  getSettings() {
    return { ...db.settings };
  },

  updateSettings(newSettings) {
    db.settings = { ...db.settings, ...newSettings };
    saveDatabase();
    return { ...db.settings };
  }
};

module.exports = DB;
