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
  nav { margin-bottom: 40px; font-size: 0.9rem; color: #888; }
  nav a { color: #555; margin-right: 16px; }
  .back { display: inline-block; margin-bottom: 24px; font-size: 0.9rem; color: #888; }
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

async function getTitle(pageId) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const titleProp = Object.values(page.properties || {}).find(p => p.type === 'title');
  return titleProp?.title?.[0]?.plain_text || 'Untitled';
}

async function convertPage(pageId) {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const md = n2m.toMarkdownString(mdBlocks);
  return marked(md.parent || '');
}

async function getSubpages(pageId) {
  const blocks = await notion.blocks.children.list({ block_id: pageId });
  return blocks.results.filter(b => b.type === 'child_page');
}

(async () => {
  const rootId = process.env.NOTION_PAGE_ID;
  const rootTitle = await getTitle(rootId);
  const subpages = await getSubpages(rootId);

  // Build nav links from subpages
  const navLinks = subpages.length
    ? `<nav>${subpages.map(p => {
        const slug = p.child_page.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        return `<a href="${slug}.html">${p.child_page.title}</a>`;
      }).join('')}</nav>`
    : '';

  // Build index.html
  const rootHtml = await convertPage(rootId);
  fs.writeFileSync('index.html', buildPage(rootTitle, rootHtml, navLinks, true));
  console.log(`✅ index.html — ${rootTitle}`);

  // Build each subpage
  for (const block of subpages) {
    const subTitle = block.child_page.title;
    const slug = subTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const subHtml = await convertPage(block.id);
    fs.writeFileSync(`${slug}.html`, buildPage(subTitle, subHtml, '', false));
    console.log(`✅ ${slug}.html — ${subTitle}`);
  }

  console.log('🚀 All pages synced!');
})();
