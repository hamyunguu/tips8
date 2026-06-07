import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// BASE_PATH is set to "/book-atlas" by the GitHub Pages build (project page lives
// at https://<user>.github.io/book-atlas). Empty for local dev / root hosting.
const base = process.env.BASE_PATH || '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		paths: { base }
	}
};

export default config;
