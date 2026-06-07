// Client-side book data layer (runs in the browser so the app can be a fully
// static site — no server). Reads the scraped catalog (src/lib/data/books.json).
//   author ↔ artist, book ↔ album, subjects ↔ "tracks".
import data from '$lib/data/books.json';

const BOOKS = data.books;
const AUTHORS = data.authors;
const byId = new Map(BOOKS.map((b) => [String(b.id), b]));

const authorLine = (b) =>
	b.authors.map((a) => (a.role ? `${a.name} ${a.role}` : a.name)).join(', ');

function toAlbum(b) {
	return {
		id: b.id,
		name: b.title,
		artwork: b.cover,
		thumb: b.cover,
		releaseDate: b.pubDate,
		genre: (b.fields || []).join(', ') || null,
		author: authorLine(b),
		pages: b.pages,
		subjects: [...(b.fields || []), ...(b.keywords || [])],
		description: b.description || ''
	};
}

/** Author search → [{ id, name, genre }] (id = author name, genre = "N권"). */
export function searchAuthors(term, limit = 6) {
	const q = (term || '').trim().toLowerCase();
	if (!q) return [];
	const scored = AUTHORS.map((a) => {
		const name = a.name.toLowerCase();
		let score = -1;
		if (name === q) score = 3;
		else if (name.startsWith(q)) score = 2;
		else if (name.includes(q)) score = 1;
		return { a, score };
	})
		.filter((x) => x.score >= 0)
		.sort((x, y) => y.score - x.score || y.a.bookIds.length - x.a.bookIds.length);

	return scored.slice(0, limit).map(({ a }) => ({
		id: a.name,
		name: a.name,
		genre: `${a.bookIds.length}권`
	}));
}

/** Books by an author (name) → { artistName, albums }. */
export function booksByAuthor(authorName) {
	const name = (authorName || '').trim();
	const author = AUTHORS.find((a) => a.name === name);
	const ids = author ? author.bookIds : [];
	const albums = ids.map((id) => byId.get(String(id))).filter(Boolean).map(toAlbum);
	return { artistName: name, albums };
}

/** Book detail → { album, tracks } where tracks = subject rows. */
export function bookDetail(id) {
	const b = byId.get(String(id));
	if (!b) return { album: null, tracks: [] };
	const album = toAlbum(b);
	const tracks = album.subjects.map((s, i) => ({ number: i + 1, name: s, previewUrl: null }));
	return { album, tracks };
}
