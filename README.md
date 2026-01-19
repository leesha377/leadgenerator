# Lead Gen Mini Example (no paid APIs)

This is a tiny demo app that shows:
- Two flows: "structured" and "manual" search (working against a small local dataset).
- Enrichment/scrape of a company website for emails and phone numbers (free scraping).
- Results shown in a table and can be exported to CSV (then paste into Google Sheets manually).

Requirements:
- Node.js 16+ installed on your computer.

How to run locally:
1. Download or clone repository.
2. In repository folder run:
   - `npm install`
   - `npm start`
3. Open http://localhost:3000 in your browser.

Notes:
- This is a demo only. Scraping public websites is allowed if the site permits it; respect robots.txt and site terms. Do not use this for mass scraping.
- The contact extraction uses simple regexes — it will find many emails and phones but also may miss or find false positives. For production you would use provider APIs and verification.
- To get results into Google Sheets: after exporting CSV you can open Google Sheets and do File → Import → Upload CSV.
