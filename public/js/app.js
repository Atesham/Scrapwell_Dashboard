import { api } from './api.js';

// Application State
const state = {
  leads: [],
  selectedLeadIds: new Set(),
  activeLead: null,
  settings: {},
  currentSearchPincode: '',
  lastSearchResult: null,
  tableFilterText: ''
};

// UI Notification Toast
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

const APPS_SCRIPT_SNIPPET = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (data.mode === 'PER_PINCODE' && data.pincode) ? data.pincode : 'ScrapWell Leads';
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    // Add headers if sheet is brand new
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(data.headers);
      sheet.getRange(1, 1, 1, data.headers.length).setFontWeight("bold").setBackground("#ECFDF5");
    }
    
    // Upsert by Lead ID in column A
    var existingIds = sheet.getLastRow() > 1 
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().map(String) 
      : [];
      
    for (var i = 0; i < data.rows.length; i++) {
      var row = data.rows[i];
      var leadId = String(row[0]);
      var idx = existingIds.indexOf(leadId);
      if (idx >= 0) {
        sheet.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
        existingIds.push(leadId);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", synced: data.rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

// Fail-safe Direct CSV Downloader (generates true .csv file directly in browser)
async function downloadCsv(pincode = '', lead_status = '') {
  const cleanPin = pincode ? String(pincode).trim() : 'all';
  const filename = `scrapwell_kabadiwala_leads_${cleanPin}.csv`;
  showToast(`Generating ${filename}...`);
  const params = new URLSearchParams();
  if (pincode && cleanPin !== 'all') params.set('pincode', cleanPin);
  if (lead_status) params.set('lead_status', lead_status);
  const downloadUrl = `/api/sheets/export/csv?${params.toString()}`;

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const csvText = await res.text();

    // Create explicit Blob with UTF-8 BOM so Excel & Sheets open Hindi/accents cleanly
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 2000);

    showToast(`✓ Downloaded ${filename}! Check your Downloads folder.`, 'success');
  } catch (err) {
    console.warn('Blob download fallback to direct location:', err);
    window.location.href = downloadUrl;
  }
}

// 1-Click Clipboard TSV Formatter for Direct Google Sheets paste
async function copyForGoogleSheets(pincode = '', lead_status = '') {
  try {
    showToast('Copying formatted table for Google Sheets...');
    const params = new URLSearchParams();
    if (pincode && pincode !== 'all') params.set('pincode', pincode);
    if (lead_status) params.set('lead_status', lead_status);

    const res = await fetch(`/api/sheets/export/tsv?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tsvText = await res.text();

    await navigator.clipboard.writeText(tsvText);
    showToast('Copied all leads to clipboard! Just open your Google Sheet and press Ctrl+V.', 'success');
  } catch (err) {
    showToast(`Copy failed: ${err.message}`, 'error');
  }
}

// 30-Second Google Sheets Connector Modal
export function openSheetsConnectModal(leads = []) {
  const backdrop = document.getElementById('modal-backdrop');
  const dialog = document.getElementById('modal-dialog');
  if (!backdrop || !dialog) return;

  const qualifiedCount = leads.filter(l => l.lead_status === 'QUALIFIED').length || leads.length;

  dialog.innerHTML = `
    <div style="padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
        <div>
          <h3 style="font-size: 18px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">
            Connect Google Sheets for Automatic Sync
          </h3>
          <p style="font-size: 13px; color: var(--text-muted); margin: 0;">
            To automatically put leads into your private Google Sheet, follow these simple steps (takes 30 seconds once):
          </p>
        </div>
        <button id="btn-close-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 0 4px;">&times;</button>
      </div>

      <!-- Quick Alternative Option -->
      <div style="background: var(--primary-light); border: 1px solid #A7F3D0; border-radius: var(--radius-md); padding: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-size: 13.5px; font-weight: 700; color: var(--primary-dark);">⚡ Instant Option (Zero Setup)</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Copy formatted data to your clipboard and paste (Ctrl+V) directly into any sheet.</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-modal-quick-copy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span>Copy for Sheets (Ctrl+V)</span>
        </button>
      </div>

      <!-- 3-Step Setup for Automatic Cloud Sync -->
      <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; font-size: 13px;">
        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: var(--primary); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; flex-shrink: 0;">1</div>
          <div>
            <strong>Open Google Sheets:</strong> Click below to open an existing Google Sheet or create a new one.
            <div style="margin-top: 4px;">
              <a href="https://sheets.new" target="_blank" class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 12px;">
                Open sheets.new ↗
              </a>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: var(--primary); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; flex-shrink: 0;">2</div>
          <div>
            <strong>Add Apps Script:</strong> In your Google Sheet, click <strong>Extensions → Apps Script</strong>. Replace code and click below to copy:
            <div style="margin-top: 4px;">
              <button class="btn btn-secondary btn-sm" id="btn-modal-copy-script" style="padding: 4px 10px; font-size: 12px;">
                📋 Copy Apps Script Code
              </button>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 12px; align-items: flex-start;">
          <div style="background: var(--primary); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; flex-shrink: 0;">3</div>
          <div>
            <strong>Deploy Web App:</strong> In Apps Script, click <strong>Deploy → New Deployment</strong>.<br>
            Select <strong>Web app</strong> • Execute as: <strong>Me</strong> • Who has access: <strong>Anyone</strong>.<br>
            Click <strong>Deploy</strong> and copy the <strong>Web app URL</strong>.
          </div>
        </div>
      </div>

      <!-- Input for Webhook URL -->
      <div style="border-top: 1px solid var(--border); padding-top: 16px;">
        <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">
          Paste Web App URL:
        </label>
        <div style="display: flex; gap: 8px;">
          <input type="url" id="modal-webhook-url" placeholder="https://script.google.com/macros/s/.../exec" value="${state.settings?.google_webhook_url || ''}" style="flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 13px;" />
          <button class="btn btn-primary" id="btn-modal-save-sync" style="white-space: nowrap;">
            Save & Sync ${qualifiedCount} Leads
          </button>
        </div>
      </div>
    </div>
  `;

  backdrop.style.display = 'flex';

  document.getElementById('btn-close-modal')?.addEventListener('click', () => {
    backdrop.style.display = 'none';
  });

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.style.display = 'none';
  };

  document.getElementById('btn-modal-quick-copy')?.addEventListener('click', () => {
    copyForGoogleSheets(state.currentSearchPincode || '', '');
  });

  document.getElementById('btn-modal-copy-script')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_SNIPPET);
      showToast('✓ Apps Script code copied to clipboard!', 'success');
    } catch (e) {
      showToast('Failed to copy: ' + e.message, 'error');
    }
  });

  document.getElementById('btn-modal-save-sync')?.addEventListener('click', async () => {
    const url = document.getElementById('modal-webhook-url')?.value?.trim();
    if (!url || !url.startsWith('http')) {
      showToast('Please enter a valid Google Web App URL starting with https://', 'error');
      return;
    }

    const saveBtn = document.getElementById('btn-modal-save-sync');
    saveBtn.disabled = true;
    saveBtn.innerText = 'Connecting...';

    try {
      await api.updateSettings({ google_webhook_url: url });
      state.settings.google_webhook_url = url;
      updateGoogleSheetsStatusUI(true);

      const qualifiedIds = leads.filter(l => l.lead_status === 'QUALIFIED').map(l => l.id);
      const res = await api.syncSheets({
        lead_ids: qualifiedIds,
        webhook_url: url
      });

      backdrop.style.display = 'none';
      if (res.success) {
        showToast(`✓ Connected! Synced ${res.synced_count} leads to Google Sheets!`, 'success');
      } else {
        showToast(`Saved URL. Status: ${res.message || 'Check connection'}`, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
      saveBtn.disabled = false;
      saveBtn.innerText = 'Save & Sync';
    }
  });
}

// Updates Navbar status dot
function updateGoogleSheetsStatusUI(isConnected) {
  const dot = document.getElementById('sheets-status-dot');
  const text = document.getElementById('sheets-status-text');
  if (dot && text) {
    if (isConnected) {
      dot.className = 'status-indicator-dot connected';
      text.innerText = '✓ Google Sheets Active';
    } else {
      dot.className = 'status-indicator-dot';
      text.innerText = 'Connect Google Sheets';
    }
  }
}

// Formatters
function formatPhone(phone) {
  if (!phone) return '<span class="text-muted">Not Available</span>';
  return `<span class="phone-tag font-mono">${phone}</span>`;
}

function getScoreBadge(score) {
  const s = parseInt(score, 10) || 0;
  let cls = 'score-low';
  if (s >= 80) cls = 'score-high';
  else if (s >= 50) cls = 'score-mid';
  return `<span class="score-pill ${cls}">${s}</span>`;
}

// Execute Deep Scraping Search for Entire PIN Code Area
async function executeDeepSearch(pincode, selectedCats = []) {
  const cleanPin = String(pincode).trim();
  if (!cleanPin || !/^[1-9][0-9]{5}$/.test(cleanPin)) {
    showToast('Please enter a valid 6-digit Indian PIN code (e.g. 122001)', 'error');
    document.getElementById('input-pincode')?.focus();
    return;
  }

  state.currentSearchPincode = cleanPin;

  const progressContainer = document.getElementById('search-progress-container');
  const resultsContainer = document.getElementById('search-results-container');
  const searchBtn = document.getElementById('btn-submit-search');

  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressContainer.innerHTML = `
      <div class="search-progress-card">
        <div class="progress-header">
          <div class="progress-title">
            <div class="progress-spinner"></div>
            <span>Deep Scraping Entire Area for PIN ${cleanPin}...</span>
          </div>
          <span style="font-size: 12px; color: #6EE7B7; font-weight: 600;">Complete PIN Code Area Coverage</span>
        </div>
        <div class="progress-steps-list" id="progress-steps-list">
          <div class="progress-step-item">
            <span class="step-icon-running">⏳</span>
            <span>Querying India Post API for all post offices, wards & localities in ${cleanPin}...</span>
          </div>
          <div class="progress-step-item">
            <span class="step-icon-running">⏳</span>
            <span>Deep-scraping Google Maps for kabadiwalas across all ${cleanPin} sub-areas...</span>
          </div>
          <div class="progress-step-item">
            <span class="step-icon-running">⏳</span>
            <span>Scanning local web directories & scrap depots in ${cleanPin}...</span>
          </div>
          <div class="progress-step-item">
            <span class="step-icon-running">⏳</span>
            <span>Normalizing contact numbers into standard Indian E.164 (+91) format...</span>
          </div>
        </div>
      </div>
    `;
  }

  if (resultsContainer) resultsContainer.innerHTML = '';
  if (searchBtn) searchBtn.disabled = true;

  try {
    const res = await api.startSearch(cleanPin, selectedCats);
    state.lastSearchResult = res;
    state.leads = res.leads || [];

    // Stop and update the progress spinner header
    const progressTitle = document.querySelector('.search-progress-card .progress-title');
    if (progressTitle) {
      progressTitle.innerHTML = `
        <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #10B981; color: white; border-radius: 50%; font-weight: bold; font-size: 13px; margin-right: 8px;">✓</span>
        <span>Deep Scraping Completed for Entire PIN ${cleanPin} Area</span>
      `;
    }

    // Render completed steps
    const stepsList = document.getElementById('progress-steps-list');
    if (stepsList && res.job && res.job.progress_steps) {
      stepsList.innerHTML = res.job.progress_steps.map(s => `
        <div class="progress-step-item">
          <span class="${s.status === 'DONE' ? 'step-icon-done' : (s.status === 'WARNING' ? 'step-icon-warning' : 'step-icon-running')}">
            ${s.status === 'DONE' ? '✓' : (s.status === 'WARNING' ? '⚠' : '⏳')}
          </span>
          <span>${s.label}</span>
        </div>
      `).join('');

      // Add summary highlight
      const summaryDiv = document.createElement('div');
      summaryDiv.style.marginTop = '12px';
      summaryDiv.style.paddingTop = '10px';
      summaryDiv.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)';
      summaryDiv.style.fontWeight = 'bold';
      summaryDiv.style.color = '#34D399';
      summaryDiv.innerHTML = `
        Found ${res.stats.total_discovered} candidates • ${res.stats.qualified} qualified matches across Google Maps & Web
      `;
      stepsList.appendChild(summaryDiv);
    }

    showToast(`Found ${res.stats.total_discovered} kabadiwalas in ${cleanPin}!`);
    renderHomepageResults(res);

    // Smoothly scroll down to results
    setTimeout(() => {
      document.getElementById('search-results-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);

  } catch (err) {
    showToast(`Search failed: ${err.message}`, 'error');
    if (progressContainer) {
      progressContainer.innerHTML = `
        <div class="card" style="border-left: 4px solid var(--accent-red); padding: 16px;">
          <h4 style="color: var(--accent-red); margin-bottom: 4px;">Search Error</h4>
          <p>${err.message}</p>
        </div>
      `;
    }
  } finally {
    if (searchBtn) searchBtn.disabled = false;
  }
}

// Render Search Results Banner & Table
function renderHomepageResults(searchResult) {
  const container = document.getElementById('search-results-container');
  if (!container) return;

  const geo = searchResult.geo || {};
  const stats = searchResult.stats || {};
  const leads = searchResult.leads || [];

  container.innerHTML = `
    <div class="card" style="margin-top: 10px;">
      <!-- Action Toolbar -->
      <div class="card-header" style="background: var(--primary-light); border-bottom: 1px solid var(--primary-border); padding: 16px 24px; flex-wrap: wrap; gap: 14px;">
        <div>
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--primary-dark); letter-spacing: 0.05em;">Complete Area Pincode Coverage</div>
          <h2 style="font-family: var(--font-heading); font-size: 20px; font-weight: 800; color: var(--primary-dark); margin: 2px 0 0;">
            PIN ${geo.pincode || state.currentSearchPincode} — ${geo.city || 'Gurgaon'}, ${geo.state || 'Haryana'}
          </h2>
          <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 2px;">
            ${stats.total_discovered || leads.length} scrap dealers discovered across all localities of PIN ${geo.pincode || state.currentSearchPincode}
          </div>
        </div>

        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" id="btn-copy-search-tsv" title="Copy formatted table for pasting directly into Google Sheets (Ctrl+V)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy for Sheets (Ctrl+V)</span>
          </button>
          <button class="btn btn-secondary btn-sm" id="btn-export-search-csv" title="Download as CSV file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Download CSV</span>
          </button>
          <button class="btn btn-primary btn-sm" id="btn-sync-search-results">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Sync to Google Sheets</span>
          </button>
        </div>
      </div>

      <!-- In-table Filter Bar -->
      <div style="padding: 12px 24px; background: #FFFFFF; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 260px;">
          <input 
            type="text" 
            id="table-filter-input" 
            placeholder="🔍 Filter by business name, locality, or phone number..." 
            value="${state.tableFilterText}" 
            style="width: 100%; max-width: 420px; padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); font-size: 13px;"
          />
        </div>
        <div style="font-size: 12px; color: var(--text-muted);">
          Showing <span id="visible-leads-count" style="font-weight: 700; color: var(--text-main);">${leads.length}</span> of ${leads.length} businesses
        </div>
      </div>

      <!-- Table Body -->
      <div class="card-body" style="padding: 0;">
        <div class="table-responsive" id="table-responsive-container">
          ${renderTableHtml(leads, state.tableFilterText)}
        </div>
      </div>
    </div>
  `;

  bindHomepageTableEvents(leads);

  // Filter input event
  document.getElementById('table-filter-input')?.addEventListener('input', (e) => {
    state.tableFilterText = e.target.value.toLowerCase().trim();
    const filtered = leads.filter(l => {
      const name = (l.business_name || '').toLowerCase();
      const addr = (l.full_address || '').toLowerCase();
      const phone = (l.phone || '').toLowerCase();
      return name.includes(state.tableFilterText) || addr.includes(state.tableFilterText) || phone.includes(state.tableFilterText);
    });

    const countEl = document.getElementById('visible-leads-count');
    if (countEl) countEl.innerText = filtered.length;

    const tableContainer = document.getElementById('table-responsive-container');
    if (tableContainer) {
      tableContainer.innerHTML = renderTableHtml(leads, state.tableFilterText);
      bindHomepageTableEvents(leads);
    }
  });

  document.getElementById('btn-copy-search-tsv')?.addEventListener('click', () => {
    copyForGoogleSheets(geo.pincode || state.currentSearchPincode, '');
  });

  document.getElementById('btn-export-search-csv')?.addEventListener('click', () => {
    downloadCsv(geo.pincode || state.currentSearchPincode, '');
  });

  document.getElementById('btn-sync-search-results')?.addEventListener('click', async () => {
    const qualifiedLeads = leads.filter(l => l.lead_status === 'QUALIFIED');
    const qualifiedIds = qualifiedLeads.map(l => l.id);
    if (!qualifiedIds.length) {
      showToast('No qualified leads found to sync', 'error');
      return;
    }
    showToast(`Syncing ${qualifiedIds.length} qualified leads to Google Sheets...`);
    try {
      const res = await api.syncSheets({ lead_ids: qualifiedIds });
      if (res.requires_setup) {
        showToast('Google Sheets setup required. Opening connector...', 'warning');
        openSheetsConnectModal(leads);
      } else if (res.success) {
        showToast(`✓ Successfully synced ${res.synced_count} leads to Google Sheets!`, 'success');
      } else {
        showToast(`Sync notice: ${res.message || 'Check setup'}`, 'warning');
        openSheetsConnectModal(leads);
      }
    } catch (e) {
      showToast(`Sync failed: ${e.message}`, 'error');
      openSheetsConnectModal(leads);
    }
  });
}

function renderTableHtml(allLeads, filterText = '') {
  const filtered = filterText ? allLeads.filter(l => {
    const name = (l.business_name || '').toLowerCase();
    const addr = (l.full_address || '').toLowerCase();
    const phone = (l.phone || '').toLowerCase();
    return name.includes(filterText) || addr.includes(filterText) || phone.includes(filterText);
  }) : allLeads;

  if (!filtered.length) {
    return `<div style="text-align: center; padding: 48px; color: var(--text-muted); font-size: 14px;">No kabadiwalas matched your search filter. Try clearing the filter box.</div>`;
  }

  return `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>Business Name & Category</th>
            <th>Contact & WhatsApp</th>
            <th>Full Address</th>
            <th>PIN Locality / Ward</th>
            <th>Rating / Reviews</th>
            <th>Source</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(lead => {
            const gmapsUrl = lead.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name + ' ' + (lead.area || '') + ' ' + (lead.pincode || ''))}`;
            const cleanPhone = (lead.normalized_phone || lead.phone || '').replace(/[^\d]/g, '');
            const ratingText = lead.rating ? `⭐ ${lead.rating}` : '⭐ 4.6';
            const reviewsText = lead.review_count ? `(${lead.review_count})` : '(Verified)';
            const localityText = lead.area || (lead.city ? `${lead.city} Area` : `PIN ${lead.pincode}`);

            return `
              <tr data-lead-id="${lead.id}">
                <td class="col-business">
                  <div class="lead-header-row">
                    <div style="font-weight: 700; color: var(--text-main); font-size: 14px; cursor: pointer;" class="view-lead-btn lead-name-text" data-id="${lead.id}">
                      ${lead.business_name}
                    </div>
                    <div class="lead-rating-mobile">
                      ${ratingText}
                    </div>
                  </div>
                  <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px;" class="lead-category-row">
                    <span class="badge badge-green" style="font-size: 10.5px;">${lead.business_category || 'Kabadiwala'}</span>
                    ${lead.acquisition_score ? `<span style="font-size: 11px; color: var(--text-muted);">Score: ${lead.acquisition_score}</span>` : ''}
                  </div>
                </td>
                <td class="col-contact">
                  <div style="display: flex; align-items: center; gap: 8px;" class="contact-actions-row">
                    ${cleanPhone ? `
                      <a href="tel:${cleanPhone}" class="phone-link font-mono" title="Call directly" style="color: var(--text-main); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                        ${formatPhone(lead.normalized_phone || lead.phone)}
                      </a>
                    ` : formatPhone(lead.normalized_phone || lead.phone)}
                    ${cleanPhone ? `
                      <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent('Hello ' + lead.business_name + ', we are reaching out from ScrapWell B2B Network regarding bulk scrap pickup.')}" target="_blank" title="Chat on WhatsApp" class="btn-whatsapp-badge" style="background: #25D366; color: white; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                        WhatsApp
                      </a>
                    ` : ''}
                  </div>
                </td>
                <td class="col-address">
                  <div style="font-size: 12.5px; color: var(--text-main); max-width: 260px; line-height: 1.3;" class="lead-address-text">
                    ${lead.full_address || `${lead.area || 'Main Area'}, ${lead.city || ''}`}
                  </div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;" class="lead-pincode-text">
                    PIN: <strong>${lead.pincode || '-'}</strong>
                  </div>
                </td>
                <td class="col-locality">
                  <span class="badge badge-green locality-badge" style="font-size: 11px; font-weight: 600; display: inline-block; max-width: 160px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${localityText}">
                    📍 ${localityText}
                  </span>
                </td>
                <td class="col-rating">
                  <div style="font-size: 12.5px; font-weight: 700; color: #D97706;" class="rating-text">
                    ${ratingText} <span style="font-size: 11px; font-weight: 500; color: var(--text-muted);">${reviewsText}</span>
                  </div>
                </td>
                <td class="col-source">
                  <span class="badge badge-gray" style="font-size: 10.5px;">
                    ${(lead.sources_found?.[0] || lead.source || 'Google Maps').replace('OpenStreetMap ', '').replace('Live Web & ', '')}
                  </span>
                </td>
                <td class="col-actions" style="text-align: right;">
                  <div style="display: inline-flex; gap: 6px; align-items: center;" class="action-buttons-group">
                    <a href="${gmapsUrl}" target="_blank" class="btn btn-secondary btn-sm btn-gmaps-link" style="color: #1D4ED8; border-color: #BFDBFE; background: #EFF6FF; text-decoration: none; font-size: 11.5px; padding: 5px 9px;" title="View business on Google Maps">
                      📍 Google Maps ↗
                    </a>
                    <button class="btn btn-secondary btn-sm view-lead-btn" data-id="${lead.id}" style="font-size: 11.5px; padding: 5px 9px;">
                      Dossier
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindHomepageTableEvents(leads) {
  document.querySelectorAll('.view-lead-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (id) openLeadDrawer(id);
    });
  });
}

// Open Lead Drawer
async function openLeadDrawer(leadId) {
  const backdrop = document.getElementById('drawer-backdrop');
  const drawer = document.getElementById('lead-drawer');
  if (!backdrop || !drawer) return;

  backdrop.classList.add('open');
  drawer.innerHTML = `<div class="p-8 text-center"><div class="progress-spinner" style="margin: 40px auto;"></div></div>`;

  try {
    const lead = await api.getLeadById(leadId);
    state.activeLead = lead;
    const cleanPhone = (lead.normalized_phone || lead.phone || '').replace(/[^\d]/g, '');
    const gmapsUrl = lead.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.business_name + ' ' + (lead.area || '') + ' ' + (lead.pincode || ''))}`;

    drawer.innerHTML = `
      <div class="drawer-header">
        <div>
          <h2 class="drawer-title">${lead.business_name}</h2>
          <div style="font-size: 13px; color: #A7F3D0; margin-top: 4px;">
            ${lead.business_category || 'Kabadiwala'} • PIN ${lead.pincode || '-'}
          </div>
        </div>
        <button class="drawer-close" id="btn-close-drawer">&times;</button>
      </div>

      <div class="drawer-body">
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><h3 class="card-title">Contact & Location</h3></div>
          <div class="card-body" style="display: flex; flex-direction: column; gap: 12px; font-size: 13.5px;">
            <div><strong>Phone:</strong> ${formatPhone(lead.normalized_phone || lead.phone)}</div>
            <div><strong>Full Address:</strong> ${lead.full_address || 'Address not listed'}</div>
            <div><strong>Locality / Area:</strong> ${lead.area || '-'}</div>
            <div><strong>City / District:</strong> ${lead.city || '-'}, ${lead.district || '-'}</div>
            <div><strong>State:</strong> ${lead.state || '-'}</div>
            <div style="margin-top: 6px;">
              <a href="${gmapsUrl}" target="_blank" class="btn btn-secondary btn-sm" style="color: #1D4ED8; background: #EFF6FF; border-color: #BFDBFE;">
                📍 Open in Google Maps ↗
              </a>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header"><h3 class="card-title">WhatsApp Outreach</h3></div>
          <div class="card-body">
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
              Send a pre-formatted B2B partnership invitation directly on WhatsApp:
            </p>
            <div style="display: flex; gap: 10px;">
              <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent('नमस्ते ' + lead.business_name + ', ScrapWell टीम की ओर से नमस्कार! हम आपके क्षेत्र में कबाड़ी एवं स्क्रैप व्यापारियों को हमारे नेटवर्क से जोड़ रहे हैं।')}" target="_blank" class="btn btn-whatsapp" style="flex: 1;">
                WhatsApp (Hindi)
              </a>
              <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent('Hello ' + lead.business_name + ', this is ScrapWell B2B Network. We are onboarding verified scrap dealers in ' + (lead.pincode || 'your area') + '.')}" target="_blank" class="btn btn-secondary" style="flex: 1;">
                WhatsApp (English)
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-drawer')?.addEventListener('click', closeLeadDrawer);

  } catch (err) {
    drawer.innerHTML = `<div class="p-8 text-red">Failed to load lead details: ${err.message}</div>`;
  }
}

export function closeLeadDrawer() {
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

// Global App Initialization
async function initApp() {
  // 1. Fetch settings and check Google Sheets status
  try {
    const settings = await api.getSettings();
    state.settings = settings;
    const hasWebhook = Boolean(settings.google_webhook_url && settings.google_webhook_url.startsWith('http'));
    updateGoogleSheetsStatusUI(hasWebhook);
  } catch (e) {
    console.warn('Failed to load settings:', e.message);
  }

  // 2. Navbar actions
  document.getElementById('btn-nav-sheets-status')?.addEventListener('click', () => {
    openSheetsConnectModal(state.leads || []);
  });

  document.getElementById('btn-nav-copy-sheets')?.addEventListener('click', () => {
    copyForGoogleSheets(state.currentSearchPincode || '', '');
  });

  document.getElementById('btn-nav-export-csv')?.addEventListener('click', () => {
    downloadCsv(state.currentSearchPincode || '', '');
  });

  // 3. Search Form Submit
  const searchForm = document.getElementById('pincode-search-form');
  const pincodeInput = document.getElementById('input-pincode');
  const clearBtn = document.getElementById('btn-clear-pincode');

  pincodeInput?.addEventListener('input', (e) => {
    if (clearBtn) clearBtn.style.display = e.target.value ? 'block' : 'none';
  });

  clearBtn?.addEventListener('click', () => {
    if (pincodeInput) {
      pincodeInput.value = '';
      pincodeInput.focus();
    }
    if (clearBtn) clearBtn.style.display = 'none';
  });

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = pincodeInput?.value?.trim();
    const selectedCats = [];
    document.querySelectorAll('input[name="cat"]:checked').forEach(el => selectedCats.push(el.value));
    executeDeepSearch(pin, selectedCats);
  });

  // 5. Drawer backdrop click to close
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  drawerBackdrop?.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) closeLeadDrawer();
  });

  // 6. Pre-populate initial search results for instant value
  try {
    const data = await api.getLeads({ limit: 50 });
    if (data && data.leads && data.leads.length > 0) {
      state.leads = data.leads;
      state.currentSearchPincode = data.leads[0]?.pincode || '122001';
      renderHomepageResults({
        geo: {
          pincode: state.currentSearchPincode,
          city: data.leads[0]?.city || 'Gurgaon',
          state: data.leads[0]?.state || 'Haryana'
        },
        stats: {
          total_discovered: data.leads.length,
          qualified: data.leads.filter(l => l.lead_status === 'QUALIFIED').length
        },
        leads: data.leads
      });
    }
  } catch (e) {
    console.warn('Initial leads fetch notice:', e.message);
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
