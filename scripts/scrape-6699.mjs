// Scrapes 6699press.kr (Tumblr JSON API, tagged=book) and MERGES into
// src/lib/data/books.json alongside the workroom catalog.
// Run after scrape-workroom.mjs:  node scripts/scrape-6699.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://6699press.kr/api/read/json?tagged=book';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) =>
	(s || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#8217;|&#8216;/g, '’')
		.replace(/\s+/g, ' ')
		.trim();

async function fetchPage(start) {
	const res = await fetch(`${API}&num=50&start=${start}`, {
		headers: { 'user-agent': 'Mozilla/5.0 BookAtlas' }
	});
	const txt = await res.text();
	return JSON.parse(txt.replace(/^var tumblr_api_read = /, '').replace(/;\s*$/, ''));
}

// pick a cover: first portrait figure's image, else first image
function pickCover(body) {
	const figs = [...body.matchAll(/<figure[^>]*data-orig-width="(\d+)"[^>]*data-orig-height="(\d+)"[^>]*>\s*<img[^>]+src="([^"]+)"/g)];
	if (figs.length) {
		const portrait = figs.find((f) => Number(f[2]) > Number(f[1]));
		return (portrait || figs[0])[3];
	}
	const m = body.match(/<img[^>]+src="([^"]+)"/);
	return m ? m[1] : null;
}

function caption(body) {
	// text lives after the figures; strip tags from the whole body
	return clean(body.replace(/<figure[\s\S]*?<\/figure>/g, ' '));
}

function main() {
	return (async () => {
		const posts = [];
		for (const start of [0, 50, 100]) {
			const j = await fetchPage(start);
			posts.push(...(j.posts || []));
			await sleep(200);
		}

		const seen = new Set();
		const books = [];
		for (const p of posts) {
			const slugBase = String(p.slug || p.id).replace(/-\d+$/, '');
			if (seen.has(slugBase)) continue; // drop duplicate posts of the same book

			// images live either in photo-url-* (photo posts) or in the body (regular posts)
			const body = p['regular-body'] || '';
			const cover = p['photo-url-1280'] || p['photo-url-500'] || pickCover(body);
			if (!cover) continue;
			seen.add(slugBase);

			const cap = p['photo-caption'] ? caption(p['photo-caption']) : caption(body);
			const yearTag = (p.tags || []).find((t) => /^(19|20)\d{2}$/.test(t));
			const title = cap.replace(/\s*(19|20)\d{2}\s*$/, '').trim() || p.slug;
			const date = p['unix-timestamp']
				? new Date(p['unix-timestamp'] * 1000).toISOString().slice(0, 10)
				: yearTag
					? `${yearTag}-01-01`
					: null;

			books.push({
				id: `sp-${p.id}`,
				title: title.slice(0, 120),
				cover,
				authors: [{ slug: '6699press', name: '6699press', role: '디자인' }],
				fields: [],
				keywords: (p.tags || []).filter((t) => !/^(books?|book|x\d+|6699press|(19|20)\d{2})$/.test(t)),
				pages: null,
				pubDate: date,
				spec: null,
				description: cap,
				url: p.url,
				publisher: '6699press'
			});
		}

		// merge into existing books.json
		const path = new URL('../src/lib/data/books.json', import.meta.url);
		const data = JSON.parse(readFileSync(path, 'utf8'));
		const existing = new Set(data.books.map((b) => String(b.id)));
		const added = books.filter((b) => !existing.has(String(b.id)));
		data.books.push(...added);

		// rebuild author index across ALL books
		const authorMap = new Map();
		for (const b of data.books) {
			for (const a of b.authors) {
				if (!authorMap.has(a.name)) authorMap.set(a.name, { slug: a.slug, name: a.name, bookIds: [] });
				authorMap.get(a.name).bookIds.push(b.id);
			}
		}
		data.authors = [...authorMap.values()].sort((x, y) => y.bookIds.length - x.bookIds.length);
		data.generatedAt = new Date().toISOString();

		writeFileSync(path, JSON.stringify(data, null, '\t'));
		console.log(
			`Added ${added.length} 6699press books (from ${posts.length} posts). ` +
				`Total: ${data.books.length} books, ${data.authors.length} authors.`
		);
	})();
}

main();
