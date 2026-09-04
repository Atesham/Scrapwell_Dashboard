/**
 * WhatsAppService - Generates direct WhatsApp acquisition links, handles campaign templates,
 * and manages opt-in lifecycle events.
 */

const DB = require('../db');

function renderTemplate(template, lead) {
  let text = template || '';
  text = text.replace(/\{\{business_name\}\}/g, lead.business_name || 'Partner');
  text = text.replace(/\{\{pincode\}\}/g, lead.pincode || '');
  text = text.replace(/\{\{city\}\}/g, lead.city || 'your area');
  return text;
}

function generateWhatsAppLink(lead, lang = 'hi') {
  const phone = lead.normalized_phone || lead.phone;
  if (!phone) return null;

  // Clean phone digits for wa.me link (must have country code without plus or leading zero)
  const cleanDigits = phone.replace(/[^\d]/g, '');

  const settings = DB.getSettings();
  const template = lang === 'en' ? settings.whatsapp_template_en : settings.whatsapp_template_hi;
  const message = renderTemplate(template, lead);

  return `https://wa.me/${cleanDigits}?text=${encodeURIComponent(message)}`;
}

function recordWhatsAppAction(leadId, action, notes = '') {
  const lead = DB.getLeadById(leadId);
  if (!lead) return null;

  let newStatus = lead.whatsapp_opt_in_status;
  let newLeadStatus = lead.lead_status;

  if (action === 'SENT') {
    newStatus = 'WHATSAPP_SENT';
    if (newLeadStatus === 'QUALIFIED' || newLeadStatus === 'DISCOVERED') {
      newLeadStatus = 'CONTACT_PENDING';
    }
  } else if (action === 'OPTED_IN') {
    newStatus = 'OPTED_IN';
    newLeadStatus = 'OPTED_IN';
  } else if (action === 'INTERESTED') {
    newStatus = 'INTERESTED';
    newLeadStatus = 'INTERESTED';
  } else if (action === 'REGISTERED') {
    newStatus = 'REGISTERED';
    newLeadStatus = 'REGISTERED';
  } else if (action === 'ACTIVATED') {
    newStatus = 'ACTIVATED';
    newLeadStatus = 'ACTIVATED';
  } else if (action === 'DO_NOT_CONTACT') {
    newStatus = 'DO_NOT_CONTACT';
    newLeadStatus = 'DO_NOT_CONTACT';
  }

  const updated = DB.updateLead(leadId, {
    whatsapp_opt_in_status: newStatus,
    lead_status: newLeadStatus,
    opt_in_timestamp: action === 'OPTED_IN' ? new Date().toISOString() : lead.opt_in_timestamp,
    new_timeline_event: {
      event: `WHATSAPP_${action}`,
      description: notes || `WhatsApp status updated to ${newStatus}`
    }
  });

  return updated;
}

module.exports = {
  renderTemplate,
  generateWhatsAppLink,
  recordWhatsAppAction
};
