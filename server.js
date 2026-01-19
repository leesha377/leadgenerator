const express = require('express');
const path = require('path');
const fs = require('fs');
const enrich = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load sample companies (small dataset for demo)
const companies = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'companies.json')));

// Simple search endpoint
app.post('/api/search', (req, res) => {
  const { flow, filters = {}, manualText = '', limit = 10 } = req.body;

  let results = companies.slice();

  if (flow === 'structured') {
    // Apply basic structured filters: industry, companyName (contains), employeeRange (min,max), location
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
    // Very simple keyword match against industry, description, and name
    const q = manualText.toLowerCase().split(/\s+/).filter(Boolean);
    results = results.filter(c => {
      const hay = (c.name + ' ' + c.industry + ' ' + (c.description || '')).toLowerCase();
      return q.every(token => hay.includes(token));
    });
  }

  results = results.slice(0, Math.max(1, Math.min(limit, 100)));

  // For each result, attach placeholder fields for contact that may be filled later by /api/enrich
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

// Enrich endpoint: given domain or company name, try to fetch website and scrape emails/phones
app.post('/api/enrich', async (req, res) => {
  const { domain, name } = req.body;

  if (!domain && !name) {
    return res.status(400).json({ ok: false, error: 'Provide domain or name' });
  }

  try {
    const data = await enrich(domain, name);
    // If nothing found, make sure we return "not available"
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
