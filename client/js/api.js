/**
 * ScrapWell API Client
 */

const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(errorData.error || `HTTP error ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Search
  startSearch(pincode, categories = [], radius = 10) {
    return request('/search/start', {
      method: 'POST',
      body: { pincode, categories, radius }
    });
  },

  getSearchProgress(jobId) {
    return request(`/search/progress/${jobId}`);
  },

  resumeSearch(jobId) {
    return request(`/search/resume/${jobId}`, {
      method: 'POST'
    });
  },

  // Leads
  getLeads(params = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        query.set(k, v);
      }
    }
    return request(`/leads?${query.toString()}`);
  },

  getLeadById(id) {
    return request(`/leads/${id}`);
  },

  updateLead(id, updates) {
    return request(`/leads/${id}`, {
      method: 'PATCH',
      body: updates
    });
  },

  batchAction(action, lead_ids) {
    return request('/leads/batch', {
      method: 'POST',
      body: { action, lead_ids }
    });
  },

  importCsv(csv_data) {
    return request('/leads/import', {
      method: 'POST',
      body: { csv_data }
    });
  },

  // Google Sheets
  syncSheets(payload = {}) {
    return request('/sheets/sync', {
      method: 'POST',
      body: payload
    });
  },

  testSheetsWebhook(webhook_url) {
    return request('/sheets/test-webhook', {
      method: 'POST',
      body: { webhook_url }
    });
  },

  getSyncLogs() {
    return request('/sheets/logs');
  },

  // WhatsApp
  recordWhatsApp(lead_id, action, notes) {
    return request('/whatsapp/action', {
      method: 'POST',
      body: { lead_id, action, notes }
    });
  },

  // Analytics
  getAnalytics() {
    return request('/analytics');
  },

  // History
  getHistory() {
    return request('/history');
  },

  // Settings
  getSettings() {
    return request('/settings');
  },

  updateSettings(settings) {
    return request('/settings', {
      method: 'POST',
      body: settings
    });
  }
};
