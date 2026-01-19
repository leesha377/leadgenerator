const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');

async function fetchHtmlTry(url) {
  try {
    const res = await fetch(url, { timeout: 12000, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

function extractContacts(text) {
  const emails = new Set();
  const phones = new Set();

  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
  let m;
  while ((m = emailRegex.exec(text))) emails.add(m[0]);

  const phoneRegex = /(?:\+?\d[\d\-\s().]{6,}\d)/g;
  while ((m = phoneRegex.exec(text))) {
    const p = m[0].replace(/\s+/g, ' ').trim();
    phones.add(p);
  }

  return { emails: Array.from(emails), phones: Array.from(phones) };
}

async function findContactPages($, baseUrl) {
  const links = [];
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    if (href.toLowerCase().includes('contact') || text.includes('contact') || text.includes('about') || href.toLowerCase().includes('team')) {
      let full = href;
      try {
        if (href.startsWith('/')) full = new URL(baseUrl).origin + href;
        else if (!href.startsWith('http')) full = new URL(href, baseUrl).href;
      } catch (e) {
        full = href;
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
      try {
        if (href.startsWith('/')) full = new URL(baseUrl).origin + href;
        else if (!href.startsWith('http')) full = new URL(href, baseUrl).href;
      } catch (e) {
        full = href;
      }
      links.push(full);
    }
  });
  return Array.from(new Set(links)).slice(0, 6);
}

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
      if (low.includes(kw)) { found.push(item.suggestion); break; }
    }
  }
  return Array.from(new Set(found)).slice(0, 3);
}

function hostnameFromUrl(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

async function duckDuckGoSearch(query) {
  try {
    const url = 'https://html.duckduckgo.com/html?q=' + encodeURIComponent(query);
    const html = await fetchHtmlTry(url);
    if (!html) return null;
    const $ = cheerio.load(html);
    const anchors = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (href && href.startsWith('http') && !href.includes('duckduckgo.com') && !href.includes('facebook.com') && !href.includes('twitter.com')) {
        anchors.push(href);
      }
    });
    return anchors.length ? anchors[0] : null;
  } catch (e) { return null; }
}

async function tryTldPermutations(name) {
  const tlds = ['.com', '.in', '.co.in', '.net', '.org', '.io'];
  const clean = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0,3).join('');
  for (const t of tlds) {
    const candidate = clean + t;
    const urls = [`https://${candidate}`, `http://${candidate}`, `https://www.${candidate}`, `http://www.${candidate}`];
    for (const u of urls) {
      const html = await fetchHtmlTry(u);
      if (html) return { url:u, domain: hostnameFromUrl(u), html };
    }
  }
  return null;
}

module.exports = async function enrich(domain, name) {
  let base = domain;
  if (!base && name) base = undefined; // we'll try permutations and search

  let foundEmails = new Set();
  let foundPhones = new Set();
  let foundUrls = new Set();
  let collectedTextPieces = [];

  // 1) If domain provided, try root URL
  if (base) {
    const urlsToTry = [`https://$\{base}` ,`http://$\{base}`];
    if (!base.startsWith('www.')) { urlsToTry.push(`https://www.$\{base}`, `http://www.$\{base}`); }
    for (const u of urlsToTry) {
      const html = await fetchHtmlTry(u);
      if (html) {
        foundUrls.add(u);
        const { emails, phones } = extractContacts(html);
        emails.forEach(e => foundEmails.add(e)); phones.forEach(p => foundPhones.add(p));
        const $ = cheerio.load(html); collectedTextPieces.push($('body').text() || '');
        const contactPages = await findContactPages($, u);
        for (const page of contactPages) {
          const h = await fetchHtmlTry(page); if (!h) continue; foundUrls.add(page); const c = extractContacts(h); c.emails.forEach(e=>foundEmails.add(e)); c.phones.forEach(p=>foundPhones.add(p)); collectedTextPieces.push(cheerio.load(h)('body').text()||'');
        }
      }
    }
  }

  // 2) If nothing yet, try TLD permutations from name
  if ((!foundUrls.size) && name) {
    const perm = await tryTldPermutations(name);
    if (perm) {
      foundUrls.add(perm.url);
      const { emails, phones } = extractContacts(perm.html);
      emails.forEach(e => foundEmails.add(e)); phones.forEach(p => foundPhones.add(p));
      collectedTextPieces.push(cheerio.load(perm.html)('body').text() || '');
    }
  }

  // 3) DuckDuckGo fallback to find likely website
  if ((!foundUrls.size) && name) {
    const dd = await duckDuckGoSearch(name + ' company');
    if (dd) {
      const html = await fetchHtmlTry(dd);
      if (html) {
        foundUrls.add(dd);
        const { emails, phones } = extractContacts(html);
        emails.forEach(e => foundEmails.add(e)); phones.forEach(p => foundPhones.add(p));
        collectedTextPieces.push(cheerio.load(html)('body').text() || '');
        const $ = cheerio.load(html);
        const contactPages = await findContactPages($, dd);
        for (const page of contactPages) {
          const h = await fetchHtmlTry(page); if (!h) continue; foundUrls.add(page); const c = extractContacts(h); c.emails.forEach(e=>foundEmails.add(e)); c.phones.forEach(p=>foundPhones.add(p)); collectedTextPieces.push(cheerio.load(h)('body').text()||'');
        }
      }
    }
  }

  // 4) As a last attempt, try searching name + "contact" on DuckDuckGo
  if ((!foundUrls.size) && name) {
    const dd2 = await duckDuckGoSearch(name + ' contact');
    if (dd2) {
      const html = await fetchHtmlTry(dd2);
      if (html) {
        foundUrls.add(dd2);
        const { emails, phones } = extractContacts(html);
        emails.forEach(e => foundEmails.add(e)); phones.forEach(p => foundPhones.add(p));
        collectedTextPieces.push(cheerio.load(html)('body').text() || '');
      }
    }
  }

  const combinedText = collectedTextPieces.join('\n ').replace(/\s+/g, ' ').trim();
  const inferredProblems = inferProblemsFromText(combinedText);
  const problemSummary = inferredProblems.length ? inferredProblems.join(' ') : 'not available';

  return {
    domain: Array.from(foundUrls)[0] ? hostnameFromUrl(Array.from(foundUrls)[0]) : (domain || 'not available'),
    emails: Array.from(foundEmails),
    phones: Array.from(foundPhones),
    sources: Array.from(foundUrls),
    inferredProblems,
    problemSummary
  };
};