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
    // keep short normalized versions
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
        // relative
        full = new URL(href, baseUrl).href;
      }
      links.push(full);
    }
  });
  // return deduped
  return Array.from(new Set(links)).slice(0, 8);
}

module.exports = async function enrich(domain, name) {
  // If domain not provided try to make one from name (very naive)
  let base = domain;
  if (!base && name) {
    // make domain candidate: take first two words, join, add .com
    const parts = name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 2);
    base = parts.join('') + '.com';
  }

  if (!base) throw new Error('No domain or name provided');

  let urlsToTry = [`https://${base}`, `http://${base}`];

  // try root, then also try www
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

  if (html && usedUrl) {
    const { emails, phones } = extractContacts(html);
    emails.forEach(e => foundEmails.add(e));
    phones.forEach(p => foundPhones.add(p));
    foundUrls.add(usedUrl);

    // parse HTML to get contact/about pages
    const $ = cheerio.load(html);
    const contactPages = await findContactPages($, usedUrl);

    for (const page of contactPages) {
      const h = await fetchHtmlTry(page);
      if (!h) continue;
      foundUrls.add(page);
      const c = extractContacts(h);
      c.emails.forEach(e => foundEmails.add(e));
      c.phones.forEach(p => foundPhones.add(p));
    }
  }

  return {
    domain: base,
    emails: Array.from(foundEmails),
    phones: Array.from(foundPhones),
    sources: Array.from(foundUrls)
  };
};
