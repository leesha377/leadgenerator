const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const enrich = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load sample companies (small dataset for demo)
const companies = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'companies.json')));

// Simple search endpoint (existing demo search)
app.post('/api/search', (req, res) => {
  const { flow, filters = {}, manualText = '', limit = 10 } = req.body;

  let results = companies.slice();

  if (flow === 'structured') {
    if (filters.companyName) {
      const q = filters.companyName.toLowerCase();
      results = results.filter(c => c.name.toLowerCase().includes(q));
    }
    if (filters.industry) {
      const q = filters.industry.toLowerCase();
      results = results.filter(c => c.industry.toLowerCase().includes(q));
    }
    if (filters.location) {
      const q = filters.location.toLowerCase();
      results = results.filter(c => c.location.toLowerCase().includes(q));
    }
    if (filters.minEmployees) {
      results = results.filter(c => Number(c.employeeCount) >= Number(filters.minEmployees));
    }
    if (filters.maxEmployees) {
      results = results.filter(c => Number(c.employeeCount) <= Number(filters.maxEmployees));
    }
  } else if (flow === 'manual') {
    const q = manualText.toLowerCase().split(/\s+/).filter(Boolean);
    results = results.filter(c => {
      const hay = (c.name + ' ' + c.industry + ' ' + (c.description || '')).toLowerCase();
      return q.every(token => hay.includes(token));
    });
  }

  results = results.slice(0, Math.max(1, Math.min(limit, 100)));

  const out = results.map(r => ({
    name: r.name,
    domain: r.domain || 'not available',
    industry: r.industry || 'not available',
    employeeCount: r.employeeCount || 'not available',
    location: r.location || 'not available',
    description: r.description || 'not available',
    emails: r.emails || [],
    phones: r.phones || [],
    emailStatus: 'not checked'
  }));

  res.json({ ok: true, results: out });
});

// Discover endpoint: search OpenCorporates for companies in India (free, public API)
app.post('/api/discover', async (req, res) => {
  // Accepts: { keyword, location, limit }
  const { keyword = '', location = '', limit = 10 } = req.body;
  try {
    // Build query q param: include keyword and location if provided
    let q = keyword || location || '';
    q = q.trim();

    // OpenCorporates search endpoint (jurisdiction_code=in for India)
    // per_page requests up to limit (cap to 50)
    const per_page = Math.min(Math.max(1, Number(limit) || 10), 50);
    const encodedQ = encodeURIComponent(q);
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodedQ}&jurisdiction_code=in&per_page=${per_page}`;

    const r = await fetch(url, { timeout: 15000 });
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: 'OpenCorporates search failed' });
    }
    const j = await r.json();

    // j.results.companies is expected
    const companiesFound = (j.results && j.results.companies) ? j.results.companies.map(item => item.company) : [];

    // Map to our result format (domain unknown at this stage)
    const results = companiesFound.map(c => ({
      name: c.name || 'not available',
      domain: 'not available', // domain may not be in registry; user can click Enrich to try scraping/inference
      industry: (c.industry_codes && c.industry_codes.length) ? c.industry_codes.map(ic=>ic.code).join('; ') : 'not available',
      employeeCount: 'not available',
      location: c.registered_address || c.registered_address_in_full || c.jurisdiction_code || 'not available',
      description: `Company number: ${c.company_number || 'n/a'}; status: ${c.current_status || 'n/a'}${c.incorporation_date ? '; incorporated: ' + c.incorporation_date : ''}`,
      extra: {
        company_number: c.company_number || '',
        current_status: c.current_status || '',
        incorporation_date: c.incorporation_date || '',
        registered_address: c.registered_address || c.registered_address_in_full || ''
      },
      emails: [],
      phones: []
    }));

    res.json({ ok: true, results });
  } catch (err) {
    console.error('discover error', err);
    res.status(500).json({ ok: false, error: 'Discovery failed' });
  }
});

// Enrich endpoint (scrape website / try domain inference)
app.post('/api/enrich', async (req, res) => {
  const { domain, name } = req.body;

  if (!domain && !name) {
    return res.status(400).json({ ok: false, error: 'Provide domain or name' });
  }

  try {
    const data = await enrich(domain, name);
    if (!data.emails || data.emails.length === 0) data.emails = ['not available'];
    if (!data.phones || data.phones.length === 0) data.phones = ['not available'];
    res.json({ ok: true, data });
  } catch (err) {
    console.error('enrich error', err);
    res.status(500).json({ ok: false, error: 'Enrichment failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Lead-gen mini app running: http://localhost:${PORT}`);
});
