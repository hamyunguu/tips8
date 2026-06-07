<script>
	import { onMount } from 'svelte';
	import { createTimeline, animate, remove } from '$lib/anime.js';
	import ArtistButton from '$lib/components/ArtistButton.svelte';
	import { searchAuthors, booksByAuthor, bookDetail } from '$lib/books.js';

	// ---------- view state ----------
	let view = $state('landing'); // 'landing' | 'atlas'
	let focusedBook = $state(null);
	let subjects = $state([]);
	let currentAuthor = $state(null);

	// ---------- landing state ----------
	let slots = $state(Array.from({ length: 6 }, () => ({ state: 'blank', artist: null })));
	let query = $state('');

	let lineEl, inputEl, h1El, landingEl;
	let buttons = $state([]);

	// ---------- gl ----------
	let canvasEl;
	let atlas = null;

	const fmtDate = (iso) => {
		if (!iso) return '—';
		try {
			return new Date(iso).toLocaleDateString('ko-KR', {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return '—';
		}
	};

	// ---------- search (authors) ----------
	function applyAuthors(list) {
		for (let i = 0; i < 6; i++) {
			const a = list[i];
			slots[i] = a ? { state: 'artist', artist: a } : { state: 'empty', artist: null };
		}
	}

	function runSearch(q) {
		if (q.trim() === '') {
			for (let i = 0; i < 6; i++) slots[i] = { state: 'blank', artist: null };
			return;
		}
		applyAuthors(searchAuthors(q, 6));
	}

	let debounce;
	function onInput(e) {
		query = e.currentTarget.value;
		clearTimeout(debounce);
		debounce = setTimeout(() => runSearch(query), 220);
	}

	// ---------- landing → atlas ----------
	async function selectAuthor(author) {
		if (!author || view !== 'landing') return;
		currentAuthor = author;
		document.title = `Book Atlas® | ${author.name}`;

		remove(lineEl, inputEl, h1El);
		animate(lineEl, { scaleX: [1, 0], duration: 600, ease: 'inOutExpo' });
		animate(inputEl, { translateY: ['0%', '100%'], duration: 600, ease: 'inExpo' });
		animate(h1El, { translateY: ['0%', '-100%'], duration: 600, ease: 'inExpo' });

		view = 'atlas';

		if (!atlas) {
			const { Atlas } = await import('$lib/gl/Atlas.js');
			atlas = new Atlas(canvasEl, { aspect: 1.45 }); // book covers are portrait
			atlas.on('select', (book, item) => openBook(book, item));
			atlas.on('dismiss', () => exitBook()); // tap empty space → back to the atlas
			if (import.meta.env.DEV) window.__atlas = atlas;
		}
		animate(canvasEl.parentElement, { opacity: [0, 1], duration: 600, ease: 'outExpo' });

		const { albums } = booksByAuthor(author.id);
		atlas.setAlbums(albums ?? []);
	}

	// ---------- atlas → book ----------
	function openBook(book, item) {
		focusedBook = book;
		subjects = book.subjects ?? [];
		atlas.focus(item);
		document.title = `Book Atlas® | ${currentAuthor?.name} | ${book.name}`;
		const { album, tracks } = bookDetail(book.id);
		subjects = (tracks ?? []).map((t) => t.name);
		if (album?.description) focusedBook = { ...book, description: album.description };
	}

	function exitBook() {
		if (!focusedBook) return;
		atlas?.unfocus();
		focusedBook = null;
		subjects = [];
		document.title = `Book Atlas® | ${currentAuthor?.name}`;
	}

	// ---------- atlas → landing ----------
	function returnToLanding() {
		if (view !== 'atlas') return;
		if (focusedBook) {
			atlas?.unfocus();
			focusedBook = null;
			subjects = [];
		}
		document.title = 'Book Atlas®';
		animate(canvasEl.parentElement, { opacity: [1, 0], duration: 500, ease: 'inOutExpo' });
		// Drive the view switch off a timer (not anime's onComplete) so it can't
		// stall if the animation loop is throttled.
		setTimeout(() => {
			atlas?.clearAlbums();
			view = 'landing';
			playLandingIntro();
		}, 520);
	}

	// ---------- intro ----------
	function playLandingIntro() {
		const tl = createTimeline();
		tl.add(lineEl, { scaleX: [0, 1], duration: 900 }, 200)
			.add(inputEl, { translateY: ['100%', '0%'], duration: 800 }, 350)
			.add(h1El, { translateY: ['-100%', '0%'], duration: 800 }, 350);
		query = '';
		if (inputEl) inputEl.value = '';
	}

	onMount(() => {
		playLandingIntro();

		const onKey = (e) => {
			if (e.key === 'Escape') {
				if (focusedBook) exitBook();
				else if (view === 'atlas') returnToLanding();
			}
		};
		window.addEventListener('keydown', onKey);

		return () => {
			clearTimeout(debounce);
			window.removeEventListener('keydown', onKey);
			atlas?.dispose();
		};
	});
</script>

<!-- WebGL atlas canvas (under the UI) -->
<div
	class="fixed inset-0 size-full overflow-hidden opacity-0"
	style:pointer-events={view === 'atlas' ? 'auto' : 'none'}
>
	<canvas bind:this={canvasEl} class="block size-full" style="cursor: grab;"></canvas>
</div>

<!-- Return (atlas) -->
{#if view === 'atlas'}
	<div class="pointer-events-none fixed top-1 left-0 z-20 px-2 text-primary mix-blend-difference">
		<button
			class="pointer-events-auto outline-none hover:underline focus-visible:underline"
			onclick={() => (focusedBook ? exitBook() : returnToLanding())}
		>
			Return
		</button>
	</div>
{/if}

<!-- Book detail overlay -->
{#if focusedBook}
	<!-- metadata (top-right) -->
	<div
		class="pointer-events-none fixed top-0 right-0 z-20 w-full text-primary mix-blend-difference lg:w-[25vw]"
	>
		<ul>
			{#each [['Title', focusedBook.name], ['Author', focusedBook.author || '—'], ['Published', fmtDate(focusedBook.releaseDate)], ['Pages', focusedBook.pages ? `${focusedBook.pages}쪽` : '—'], ['Subject', focusedBook.genre || '—']] as [label, value] (label)}
				<li class="overflow-clip border-b">
					<div class="flex items-end justify-between gap-x-2 pt-2 pr-2 pb-0.5 pl-2 font-medium">
						<span class="text-xs leading-5.5">{label}</span>
						<span class="min-w-0 truncate text-right text-nowrap">{value}</span>
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<!-- subjects + description (bottom-left) -->
	<div class="fixed bottom-0 left-0 z-20 max-h-[70dvh] w-full overflow-y-auto hide-scrollbar lg:w-[28vw]">
		<ul>
			{#each subjects as subject, i (subject + i)}
				<li class="overflow-clip border-b">
					<div class="flex items-end justify-between gap-x-2 pt-2 pr-2 pb-0.5 pl-2">
						<span class="truncate text-left">{subject}</span>
						<span class="text-xs leading-5.5">{i + 1}</span>
					</div>
				</li>
			{/each}
		</ul>
		{#if focusedBook.description}
			<p class="px-2 pt-3 pb-4 text-sm leading-6 text-secondary/80">{focusedBook.description}</p>
		{/if}
	</div>
{/if}

<!-- Landing -->
<main
	bind:this={landingEl}
	class="transition-opacity"
	style:opacity={view === 'landing' ? 1 : 0}
	style:pointer-events={view === 'landing' ? 'auto' : 'none'}
>
	<div class="h-dvh">
		<span aria-hidden="true" class="pointer-events-none fixed top-0 left-0 text-primary">.</span>
		<div class="flex size-full flex-col items-center justify-center">
			<div class="flex w-full flex-1 items-center">
				<ul class="flex w-full flex-1 items-center gap-x-16 gap-y-8 px-8 max-lg:flex-col lg:px-16">
					{#each [0, 1, 2] as i (i)}
						<ArtistButton bind:this={buttons[i]} phase={slots[i].state} artist={slots[i].artist} onselect={selectAuthor} />
					{/each}
				</ul>
			</div>

			<div class="input flex w-full flex-col-reverse">
				<div class="self-center overflow-clip">
					<h1 bind:this={h1El} class="pt-2 text-center text-xs" style="transform: translateY(-100%);">
						Book Atlas®
					</h1>
				</div>
				<div bind:this={lineEl} class="line h-px bg-secondary" style="transform: scaleX(0);"></div>
				<div class="overflow-clip">
					<label for="artist" class="sr-only">Search Authors</label>
					<input
						bind:this={inputEl}
						id="artist"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder="Search Authors"
						oninput={onInput}
						class="w-full pb-1.25 text-center outline-none placeholder:text-secondary/35"
						style="transform: translateY(100%);"
					/>
				</div>
			</div>

			<div class="flex w-full flex-1 items-center">
				<ul class="flex w-full flex-1 items-center gap-x-16 gap-y-8 px-8 max-lg:flex-col lg:px-16">
					{#each [3, 4, 5] as i (i)}
						<ArtistButton bind:this={buttons[i]} phase={slots[i].state} artist={slots[i].artist} onselect={selectAuthor} />
					{/each}
				</ul>
			</div>
		</div>
	</div>
</main>
