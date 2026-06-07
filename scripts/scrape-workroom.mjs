// One-time scraper for workroompress.kr book catalog → src/lib/data/books.json
// Run: node scripts/scrape-workroom.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://workroompress.kr';
const LIST = `${BASE}/product-category/book/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) =>
	(s || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#8217;|&#8216;/g, '’')
		.replace(/&#8220;|&#8221;/g, '”')
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, ' ')
		.trim();

async function get(url) {
	const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 BookAtlas' } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.text();
}

async function collectProductIds() {
	const ids = new Set();
	for (let page = 1; page <= 6; page++) {
		const url = page === 1 ? LIST : `${LIST}page/${page}/`;
		let html;
		try {
			html = await get(url);
		} catch {
			break;
		}
		const before = ids.size;
		for (const m of html.matchAll(/\/product\/(\d+)\//g)) ids.add(m[1]);
		if (ids.size === before) break; // no new products → end of pagination
		await sleep(150);
	}
	return [...ids];
}

function extractJsonLdProduct(html) {
	for (const m of html.matchAll(
		/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
	)) {
		let data;
		try {
			data = JSON.parse(m[1]);
		} catch {
			continue;
		}
		const nodes = data['@graph'] || (Array.isArray(data) ? data : [data]);
		for (const n of nodes) {
			if (n && n['@type'] === 'Product') return n;
		}
	}
	return null;
}

// taxonomy values may be bare (`>text<`) or span-wrapped (`><span>text</span>`)
function taxonomy(html, key) {
	const out = [];
	const re = new RegExp(`data-key='${key}'[^>]*>\\s*(?:<span>)?([^<]+)`, 'g');
	for (const m of html.matchAll(re)) {
		const v = clean(m[1]);
		if (v && !out.includes(v)) out.push(v);
	}
	return out;
}
// <li class='author' data-slug='..' data-key='_book_author'><span>NAME</span> ROLE</li>
function authors(html) {
	const out = [];
	const re = /data-slug='([^']+)'[^>]*data-key='_book_author'>\s*<span>([^<]+)<\/span>\s*([^<]*?)<\/li>/g;
	for (const m of html.matchAll(re)) {
		const name = clean(m[2]);
		const role = clean(m[3]) || null;
		if (name && !out.find((a) => a.name === name)) out.push({ slug: m[1], name, role });
	}
	return out;
}

function spec(html) {
	const m = html.match(/class='description'>([\s\S]*?)<\/div>/);
	const text = clean(m ? m[1] : '');
	const pages = (text.match(/(\d+)\s*쪽/) || [])[1] || null;
	const dm = text.match(/(\d{4})년\s*(\d+)월\s*(\d+)일/);
	const pubDate = dm ? `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}` : null;
	return { pages: pages ? Number(pages) : null, pubDate, spec: text || null };
}

function description(html) {
	const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
		.map((m) => clean(m[1]))
		.filter((t) => t.length > 50 && !/^https?:/.test(t));
	ps.sort((a, b) => b.length - a.length);
	return ps[0] || '';
}

function title(html, ld) {
	const h1 = (html.match(/<h1 class='wk-title'>([\s\S]*?)<\/h1>/) || [])[1];
	return clean(h1 || ld?.name || '');
}

function cover(ld) {
	const img = ld?.image;
	if (!img) return null;
	return Array.isArray(img) ? img[0] : typeof img === 'object' ? img.url : img;
}

async function scrapeProduct(id) {
	const html = await get(`${BASE}/product/${id}/`);
	const ld = extractJsonLdProduct(html);
	return {
		id,
		title: title(html, ld),
		cover: cover(ld),
		authors: authors(html),
		fields: taxonomy(html, '_book_field'),
		keywords: taxonomy(html, '_book_keyword'),
		...spec(html),
		description: description(html),
		url: `${BASE}/product/${id}/`,
		publisher: 'workroom'
	};
}

async function main() {
	console.log('Collecting product ids…');
	const ids = await collectProductIds();
	console.log(`Found ${ids.length} products. Scraping…`);

	const books = [];
	for (let i = 0; i < ids.length; i++) {
		try {
			const b = await scrapeProduct(ids[i]);
			if (b.title && b.cover) books.push(b);
			process.stdout.write(`\r${i + 1}/${ids.length} ${b.title?.slice(0, 24) || ''}`.padEnd(60));
		} catch (e) {
			process.stdout.write(`\r${i + 1}/${ids.length} ERR ${ids[i]}`.padEnd(60));
		}
		await sleep(120);
	}
	console.log(`\nScraped ${books.length} books.`);

	// build author index
	const authorMap = new Map();
	for (const b of books) {
		for (const a of b.authors) {
			const key = a.name; // group by name (slugs differ across roles)
			if (!authorMap.has(key)) authorMap.set(key, { slug: a.slug, name: a.name, bookIds: [] });
			authorMap.get(key).bookIds.push(b.id);
		}
	}
	const authorsList = [...authorMap.values()].sort((x, y) => y.bookIds.length - x.bookIds.length);

	mkdirSync(new URL('../src/lib/data/', import.meta.url), { recursive: true });
	const out = { generatedAt: new Date().toISOString(), books, authors: authorsList };
	writeFileSync(new URL('../src/lib/data/books.json', import.meta.url), JSON.stringify(out, null, '\t'));
	console.log(`Wrote ${books.length} books, ${authorsList.length} authors → src/lib/data/books.json`);
}

main();
