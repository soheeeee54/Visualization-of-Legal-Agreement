// sync-notion-to-csv.js
// Pulls all rows from a Notion database and writes them to data.csv
// in the format the legal-dashboard.html expects: 상태,구분,제목,담당자,마감일
//
// Requires Node 18+ (built-in fetch). Run with:
//   NOTION_TOKEN=xxx NOTION_DATABASE_ID=xxx node sync-notion-to-csv.js

const fs = require('fs');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'data.csv';

// The exact Notion property names to read from. Rename the right side
// if your Notion database uses different column names.
const PROPERTY_MAP = {
  '상태': '상태',
  '구분': '구분',
  '제목': '제목',
  '담당자': '담당자',
  '마감일': '마감일'
};

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID environment variables are required.');
  process.exit(1);
}

async function fetchAllPages(){
  const pages = [];
  let cursor = undefined;

  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
    });

    if (!res.ok){
      const body = await res.text();
      throw new Error(`Notion API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

// Extracts a plain-text value out of a Notion property object,
// regardless of its underlying type (title, rich_text, select,
// status, multi_select, people, date, ...).
function propertyToText(prop){
  if (!prop) return '';
  switch (prop.type){
    case 'title':
      return prop.title.map(t => t.plain_text).join('');
    case 'rich_text':
      return prop.rich_text.map(t => t.plain_text).join('');
    case 'select':
      return prop.select ? prop.select.name : '';
    case 'status':
      return prop.status ? prop.status.name : '';
    case 'multi_select':
      return prop.multi_select.map(o => o.name).join(',');
    case 'people':
      return prop.people.map(p => p.name || '').filter(Boolean).join(',');
    case 'date':
      return prop.date ? prop.date.start : '';
    case 'checkbox':
      return prop.checkbox ? 'TRUE' : 'FALSE';
    case 'number':
      return prop.number != null ? String(prop.number) : '';
    default:
      return '';
  }
}

function csvEscape(value){
  const str = String(value ?? '');
  if (/[",\n]/.test(str)){
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(rows){
  const headers = Object.keys(PROPERTY_MAP);
  const lines = [headers.join(',')];
  for (const row of rows){
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

async function main(){
  console.log('Fetching Notion database...');
  const pages = await fetchAllPages();
  console.log(`Fetched ${pages.length} rows.`);

  const rows = pages.map(page => {
    const row = {};
    for (const outputCol of Object.keys(PROPERTY_MAP)){
      const notionCol = PROPERTY_MAP[outputCol];
      row[outputCol] = propertyToText(page.properties[notionCol]);
    }
    return row;
  });

  const csv = toCSV(rows);
  fs.writeFileSync(OUTPUT_FILE, csv, 'utf8');
  console.log(`Wrote ${rows.length} rows to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
