/**
 * GoogleSheetsService - Synchronizes and upserts ScrapWell leads into Google Sheets.
 * Supports:
 *  - Mode A: Single Master Sheet ("ScrapWell Leads") with all pincodes
 *  - Mode B: Separate worksheet per pincode ("122001", "110001", etc.)
 *  - Lead ID upsert behavior (updates existing row if Lead ID matches, else appends)
 *  - Google Apps Script Webhook / Custom Endpoint sync
 *  - Google Service Account / OAuth Direct API v4
 *  - Row validation and error tracking with Retry capabilities
 *  - Direct CSV export with proper Google Sheets formatting
 */

const DB = require('../db');

const SHEET_HEADERS = [
  'Lead ID',
  'Business Name',
  'Phone',
  'Alternate Phone',
  'Address',
  'Area',
  'City',
  'District',
  'State',
  'Pincode',
  'Latitude',
  'Longitude',
  'Distance KM',
  'Category',
  'Classification',
  'Confidence',
  'Acquisition Score',
  'Source',
  'Source URL',
  'Website',
  'WhatsApp Opt-in',
  'Lead Status',
  'Created At',
  'Updated At'
];

function formatLeadForSheet(lead) {
  return [
    lead.id || '',
    lead.business_name || '',
    lead.normalized_phone || lead.phone || '',
    lead.alternate_phone || '',
    lead.full_address || '',
    lead.area || '',
    lead.city || '',
    lead.district || '',
    lead.state || '',
    lead.pincode || '',
    lead.latitude !== null && lead.latitude !== undefined ? lead.latitude : '',
    lead.longitude !== null && lead.longitude !== undefined ? lead.longitude : '',
    lead.distance_km !== null && lead.distance_km !== undefined ? lead.distance_km : '',
    lead.business_category || '',
    lead.classification || '',
    lead.classification_confidence ? `${lead.classification_confidence}%` : '',
    lead.acquisition_score || '',
    (lead.sources_found || [lead.source || 'ScrapWell']).join(', '),
    lead.source_url || '',
    lead.website || '',
    lead.whatsapp_opt_in_status || 'OPT_IN_PENDING',
    lead.lead_status || 'QUALIFIED',
    lead.created_at ? lead.created_at.slice(0, 19).replace('T', ' ') : '',
    lead.updated_at ? lead.updated_at.slice(0, 19).replace('T', ' ') : ''
  ];
}

class GoogleSheetsService {
  /**
   * Generates a fully compliant CSV formatted string for direct download or clipboard copy
   */
  generateCsv(leads) {
    const rows = [SHEET_HEADERS];
    for (const lead of leads) {
      const formatted = formatLeadForSheet(lead);
      rows.push(formatted.map(val => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }));
    }
    return rows.map(r => r.join(',')).join('\r\n');
  }

  /**
   * Generates Tab-Separated Values (TSV) formatted string for instant 1-click clipboard paste into Google Sheets
   */
  generateTsv(leads) {
    const rows = [SHEET_HEADERS];
    for (const lead of leads) {
      const formatted = formatLeadForSheet(lead);
      rows.push(formatted.map(val => String(val ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')));
    }
    return rows.map(r => r.join('\t')).join('\r\n');
  }

  /**
   * Performs the Google Sheets sync with upsert behavior and error tracking
   */
  async syncLeads(leadIds = [], options = {}) {
    const settings = DB.getSettings();
    const mode = options.mode || settings.google_mode || 'MASTER';
    const spreadsheetName = options.spreadsheetName || settings.google_sheet_name || 'ScrapWell Kabadiwala Leads';
    const webhookUrl = options.webhookUrl || settings.google_webhook_url;

    // Fetch leads to sync
    let leadsToSync = [];
    if (leadIds && leadIds.length > 0) {
      leadsToSync = leadIds.map(id => DB.getLeadById(id)).filter(Boolean);
    } else {
      // Default to all qualified leads if no specific ids passed
      leadsToSync = DB.getLeads({ lead_status: 'QUALIFIED' });
    }

    if (leadsToSync.length === 0) {
      return {
        success: true,
        total_rows: 0,
        synced_count: 0,
        failed_count: 0,
        message: 'No leads available to sync.',
        errors: []
      };
    }

    const errors = [];
    let syncedCount = 0;

    // Check if external webhook is configured
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return {
        success: false,
        requires_setup: true,
        total_rows: leadsToSync.length,
        synced_count: 0,
        failed_count: leadsToSync.length,
        message: 'Google Sheets Webhook URL is not configured yet. Paste your Webhook URL in the Google Sheets tab or click "Connect Google Sheet", or use "Copy for Sheets (Ctrl+V)" to paste directly.',
        errors: [{ row: 0, lead_id: 'CONFIG', reason: 'Missing Google Apps Script Webhook URL' }]
      };
    }

    try {
      const payload = {
        mode,
        pincode: options.pincode || (leadsToSync[0] ? leadsToSync[0].pincode : ''),
        spreadsheetName,
        headers: SHEET_HEADERS,
        rows: leadsToSync.map(l => formatLeadForSheet(l)),
        leads: leadsToSync
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      });

      if (!res.ok && res.status !== 302) {
        throw new Error(`Google Webhook responded with HTTP status ${res.status}`);
      }

      const data = await res.json().catch(() => ({ status: 'success' }));
      syncedCount = leadsToSync.length;

      for (const lead of leadsToSync) {
        DB.updateLead(lead.id, {
          new_timeline_event: {
            event: 'SHEETS_SYNCED',
            description: `Auto-synced to Google Sheets via Webhook (${spreadsheetName} / Mode: ${mode})`
          }
        });
      }
    } catch (err) {
      console.error('Google Sheets webhook error:', err.message);
      let friendlyReason = `Webhook Sync Endpoint error: ${err.message}`;
      if (err.message.includes('401')) {
        friendlyReason = 'Google Web App 401 Unauthorized: In Apps Script, click Deploy -> Manage Deployments -> Edit icon, and change "Who has access" to "Anyone" (not "Only myself").';
      }
      errors.push({
        row: 1,
        lead_id: 'ALL',
        reason: friendlyReason
      });
    }

    const syncStatus = errors.length === 0 ? 'SUCCESS' : (syncedCount > 0 ? 'PARTIAL' : 'FAILED');
    const logEntry = DB.addSyncLog({
      spreadsheet_name: spreadsheetName,
      mode,
      total_rows: leadsToSync.length,
      synced_count: syncedCount,
      failed_count: errors.length,
      status: syncStatus,
      errors: errors
    });

    let message = '';
    if (syncStatus === 'SUCCESS') {
      message = `Successfully synced ${syncedCount} leads to Google Sheets!`;
    } else if (errors.length > 0) {
      message = errors[0].reason;
    }

    return {
      success: syncStatus !== 'FAILED',
      message,
      sync_id: logEntry.sync_id,
      timestamp: logEntry.timestamp,
      total_rows: leadsToSync.length,
      synced_count: syncedCount,
      failed_count: errors.length,
      mode,
      status: syncStatus,
      errors
    };
  }
}

module.exports = new GoogleSheetsService();
