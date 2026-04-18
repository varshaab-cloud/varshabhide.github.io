const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const { marked } = require('marked');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         max-width: 860px; margin: 0 auto; padding: 40px 24px;
         color: #37352f; line-height: 1.75; background: #fff; }
  h1 { font-size: 2.4rem; font-weight: 700; margin-bottom: 8px; }
  h2 { font-size: 1.5rem; font-weight: 600; margin: 32px 0 12px; }
  h3 { font-size: 1.2rem; font-weight: 600; margin: 24px 0 8px; }
  p  { margin-bottom: 14px; }
  a  { color: #0070f3; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; border-radius: 10px; margin: 16px 0; }
  ul, ol { padding-left: 24px; margin-bottom: 14px; }
  li { margin-bottom: 6px; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 32px 0; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  blockquote { border-left: 4px solid #e0e0e0; padding-left: 16px; color: #666; margin: 16px 0; }
  nav { margin-bottom: 40px; padding: 16px 0; border-bottom: 1px solid #e0e0e0; }
  nav a { color: #555; margin-right: 20px; font-size: 0.95rem; font-weight: 500; }
  nav a:hover { color: #0070f3; }
  .back { display: inline-block; margin-bottom: 24px; font-size: 0.9rem; color: #888; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; margin: 20px 0; }
  .card { border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; transition: box-shadow 0.2s; }
  .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
  .card img { width: 100%; height: 160px; object-fit: cover; }
  .card-body { padding: 14px; }
  .card-title { font-weight: 600; font-size: 0.95rem; }
  .card a { text-decoration: none; color: inherit; }
`;

function buildPage(title, bodyHtml, navLinks = '', isRoot = true) {
  const backLink = isRoot ? '' : `<a class="back" href="index.html">← Back to home</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  ${backLink}
  ${navLinks}
  <h1>${title}</h1>
  ${bodyHtml}
</body>
</html>`;
}

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function getTitle(pageId) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const titleProp = Object.values(page.properties || {}).find(p => p.type === 'title');
  return titleProp?.title?.[0]?.plain_text || page.child_page?.title || 'Untitled';
}

async function convertPage(pageId) {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const md = n2m.toMarkdownString(mdBlocks);
  return marked(md.parent || '');
}

async function getDatabaseItems(databaseId) {
  const res = await notion.databases.query({ database_id: databaseId });
  return res.results;
}

async function renderDatabase(databaseId, dbTitle) {
  let items;
  try {
    items = await getDatabaseItems(databaseId);
  } catch (e) {
    return `<p><em>(Could not load "${dbTitle}" — make sure it's shared with the integration)</em></p>`;
  }

  const cards = await Promise.all(items.map(async (item) => {
    const titleProp = Object.values(item.properties || {}).find(p => p.type === 'title');
    const itemTitle = titleProp?.title?.[0]?.plain_text || 'Untitled';
    const slug = slugify(itemTitle);
    const cover = item.cover?.external?.url || item.cover?.file?.url || '';

    // Save each database item as its own page
    try {
      const itemHtml = await convertPage(item.id);
      fs.writeFileSync(`${slug}.html`, buildPage(itemTitle, itemHtml, '', false));
      console.log(`  ✅ ${slug}.html — ${itemTitle}`);
    } catch (e) {
      console.log(`  ⚠️ Skipped ${itemTitle} — not shared with integration`);
    }

    return `
      <div class="card">
        <a href="${slug}.html">
          ${cover ? `<img src="${cover}" alt="${itemTitle}"/>` : ''}
          <div class="card-body">
            <div class="card-title">${itemTitle}</div>
          </div>
        </a>
      </div>`;
  }));

  return `<h2>${dbTitle}</h2><div class="card-grid">${cards.join('')}</div>`;
}

async function getPageBlocks(pageId) {
  const res = await notion.blocks.children.list({ block_id: pageId });
  return res.results;
}

(async () => {
  const rootId = process.env.NOTION_PAGE_ID;
  const rootTitle = await getTitle(rootId);
  const blocks = await getPageBlocks(rootId);

  const childPages = blocks.filter(b => b.type === 'child_page');
  const childDatabases = blocks.filter(b => b.type === 'child_database');

  // Build nav from child pages only
  const navLinks = childPages.length
    ? `<nav>${childPages.map(p => {
        const slug = slugify(p.child_page.title);
        return `<a href="${slug}.html">${p.child_page.title}</a>`;
      }).join('')}</nav>`
    : '';

  // Build index page — main content + embedded databases as card grids
  let rootHtml = await convertPage(rootId);

  // Render each database inline on the homepage
  for (const db of childDatabases) {
    const dbTitle = db.child_database?.title || 'Projects';
    console.log(`📦 Rendering database: ${dbTitle}`);
    const dbHtml = await renderDatabase(db.id, dbTitle);
    rootHtml += dbHtml;
  }

  fs.writeFileSync('index.html', buildPage(rootTitle, rootHtml, navLinks, true));
  console.log(`✅ index.html — ${rootTitle}`);

  // Build each child page
  for (const block of childPages) {
    const subTitle = block.child_page.title;
    const slug = slugify(subTitle);
    console.log(`📄 Rendering page: ${subTitle}`);
    const subHtml = await convertPage(block.id);
    fs.writeFileSync(`${slug}.html`, buildPage(subTitle, subHtml, '', false));
    console.log(`✅ ${slug}.html — ${subTitle}`);
  }

  console.log('🚀 All pages synced!');
})();
