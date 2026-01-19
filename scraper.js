const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Simple helper to fetch a URL (tries https then http) and return HTML or null
async function fetchHtmlTry(url) {
  try {
    const res = await fetch(url, { timeout: 10000, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

// Extract emails and phone numbers from HTML text
function extractContacts(text) {
  const emails = new Set();
  const phones = new Set();

  // email regex (simple)
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
  let m;
  while ((m = emailRegex.exec(text))) emails.add(m[0]);

  // phone regex (very permissive)
  const phoneRegex = /(?:\+?\d[\d\-\s().]{6,}\d)/g;
  while ((m = phoneRegex.exec(text))) {
    const p = m[0].replace(/\s+/g, ' ').trim();
    phones.add(p);
  }

  return {
    emails: Array.from(emails),
    phones: Array.from(phones)
  };
}

async function findContactPages($, baseUrl) {
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    if (href.toLowerCase().includes('contact') || text.includes('contact') || text.includes('about') || href.toLowerCase().includes('team')) {
      let full = href;
      if (href.startsWith('/')) {
        full = new URL(baseUrl).origin + href;
      } else if (!href.startsWith('http')) {
        full = new URL(href, baseUrl).href;
      }
      links.push(full);
    }
  });
  return Array.from(new Set(links)).slice(0, 8);
}

async function findJobPages($, baseUrl) {
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    if (href.toLowerCase().includes('career') || href.toLowerCase().includes('job') || href.toLowerCase().includes('vacancy') || text.includes('career') || text.includes('jobs') || text.includes('join us')) {
      let full = href;
      if (href.startsWith('/')) {
        full = new URL(baseUrl).origin + href;
      } else if (!href.startsWith('http')) {
        full = new URL(href, baseUrl).href;
      }
      links.push(full);
    }
  });
  return Array.from(new Set(links)).slice(0, 6);
}

// Keyword -> problem suggestion mapping (simple heuristics)
const KEYWORD_PROBLEMS = [
  { kws: ['manual', 'excel', 'spreadsheets', 'paper', 'copy paste'], suggestion: 'Likely uses manual processes (Excel/paper); could benefit from automation to reduce errors and save time.' },
  { kws: ['legacy', 'outdated', 'old system', 'on-prem', 'monolith'], suggestion: 'May have legacy systems; migration or automation could improve reliability and speed.' },
  { kws: ['scale', 'scalability', 'growing quickly', 'rapid growth'], suggestion: 'Scaling challenges—automation and scalable infrastructure can help manage growth.' },
  { kws: ['support', 'customer support', 'tickets', 'sla', 'helpdesk'], suggestion: 'High customer support load; automating repetitive support tasks could reduce time-to-resolution.' },
  { kws: ['marketing', 'lead', 'leads', 'conversion', 'traffic'], suggestion: 'Marketing / lead generation area may need improvement—automation can help nurture leads.' },
  { kws: ['cost', 'reduce cost', 'cut cost', 'operational cost'], suggestion: 'Cost reduction opportunities; automations can lower operational expenses.' },
  { kws: ['integrat', 'integration', 'api', 'manual integration'], suggestion: 'Integration gaps between systems—building connectors or automations can improve data flow.' },
  { kws: ['hiring', 'hiring fast', 'recruit', 'we are hiring'], suggestion: 'Active hiring may indicate growth pains; automating onboarding or HR workflows could help.' },
  { kws: ['payments', 'billing', 'invoic'], suggestion: 'Billing / payments may be a challenge—automation can streamline invoices and collections.' },
  { kws: ['inventory', 'warehouse', 'logistics', 'supply chain'], suggestion: 'Operations / supply chain area could benefit from automation and tracking improvements.' }
];

function inferProblemsFromText(text) {
  if (!text || text.length < 30) return [];
  const low = text.toLowerCase();
  const found = [];
  for (const item of KEYWORD_PROBLEMS) {
    for (const kw of item.kws) {
      if (low.includes(kw)) {
        found.push(item.suggestion);
        break;
      }
    }
  }
  // Deduplicate and limit to 3 suggestions
  return Array.from(new Set(found)).slice(0, 3);
}

module.exports = async function enrich(domain, name) {
  // If domain not provided try to make one from name (very naive)
  let base = domain;
  if (!base && name) {
    const parts = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 2);
    base = parts.join('') + '.com';
  }

  if (!base) throw new Error('No domain or name provided');

  let urlsToTry = [`https://${base}`, `http://${base}`];

  if (!base.startsWith('www.')) {
    urlsToTry.push(`https://www.${base}`, `http://www.${base}`);
  }

  let html = null;
  let usedUrl = null;
  for (const u of urlsToTry) {
    html = await fetchHtmlTry(u);
    if (html) {
      usedUrl = u;
      break;
    }
  }

  const foundEmails = new Set();
  const foundPhones = new Set();
  const foundUrls = new Set();
  const collectedTextPieces = [];

  if (html && usedUrl) {
    const { emails, phones } = extractContacts(html);
    emails.forEach(e => foundEmails.add(e));
    phones.forEach(p => foundPhones.add(p));
    foundUrls.add(usedUrl);

    const $ = cheerio.load(html);
    collectedTextPieces.push($('body').text() || '');

    const contactPages = await findContactPages($, usedUrl);
    for (const page of contactPages) {
      const h = await fetchHtmlTry(page);
      if (!h) continue;
      foundUrls.add(page);
      const c = extractContacts(h);
      c.emails.forEach(e => foundEmails.add(e));
      c.phones.forEach(p => foundPhones.add(p));
      const $p = cheerio.load(h);
      collectedTextPieces.push($p('body').text() || '');
    }

    const jobPages = await findJobPages($, usedUrl);
    for (const page of jobPages) {
      const h = await fetchHtmlTry(page);
      if (!h) continue;
      foundUrls.add(page);
      const $j = cheerio.load(h);
      collectedTextPieces.push($j('body').text() || '');
    }
  }

  const combinedText = collectedTextPieces.join('\n ').replace(/\s+/g, ' ').trim();

  // Infer problems using rule-based heuristics
  const inferredProblems = inferProblemsFromText(combinedText);
  const problemSummary = inferredProblems.length ? inferredProblems.join(' ') : 'not available';

  return {
    domain: base,
    emails: Array.from(foundEmails),
    phones: Array.from(foundPhones),
    sources: Array.from(foundUrls),
    inferredProblems,
    problemSummary
  };
};
