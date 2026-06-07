<script>
	import { animate, remove } from '$lib/anime.js';

	/**
	 * Three stacked layers share one grid cell (*:[grid-area:1/1]).
	 * Exactly one is visible (translateY 0); the others sit off-screen.
	 *   layer 0 = "Loading…"   (idx 0)
	 *   layer 1 = "No Result"  (idx 1)
	 *   layer 2 = artist name  (idx 2, dynamic text)
	 *
	 * state: 'loading' | 'empty' | 'artist'
	 */
	let { phase = 'loading', artist = null, onselect } = $props();

	let loadingEl = $state(null);
	let emptyEl = $state(null);
	let nameEl = $state(null);

	// Text currently painted in the name layer (swapped at the roll midpoint).
	let shownName = $state(artist?.name ?? '');
	let shownCount = $state(artist?.genre ?? ''); // e.g. "7권" — shown muted next to the name

	// Non-reactive bookkeeping.
	let currentIdx = -1; // -1 = nothing shown yet (all layers parked above at -100%)
	let prevState;
	let prevName;
	let ready = false;

	const idxFor = (s) => (s === 'loading' ? 0 : s === 'empty' ? 1 : 2);
	const layerFor = (i) => (i === 0 ? loadingEl : i === 1 ? emptyEl : nameEl);

	function roll(targetIdx, enterName, enterCount = '', delay = 0) {
		const incoming = layerFor(targetIdx);
		const outgoing = currentIdx >= 0 ? layerFor(currentIdx) : null;
		if (!incoming) return;

		// Same artist layer, only the text changes → swap-roll within layer 2.
		if (targetIdx === 2 && currentIdx === 2) {
			remove(nameEl);
			animate(nameEl, {
				translateY: '-100%',
				duration: 400,
				onComplete: () => {
					shownName = enterName ?? '';
					shownCount = enterCount ?? '';
					animate(nameEl, { translateY: ['100%', '0%'], duration: 500 });
				}
			});
			return;
		}

		if (targetIdx === 2) {
			shownName = enterName ?? '';
			shownCount = enterCount ?? '';
		}

		// Cancel any in-flight / pending tweens on these layers so a delayed intro
		// can't snap a layer back after a newer roll has already moved it.
		remove(incoming);
		if (outgoing) remove(outgoing);

		// First reveal converges from above (-100% → 0); later rolls tick up (100% → 0).
		const from = currentIdx === -1 ? '-100%' : '100%';
		animate(incoming, { translateY: [from, '0%'], duration: 500, delay });
		if (outgoing) animate(outgoing, { translateY: '-100%', duration: 500, delay });

		currentIdx = targetIdx;
	}

	$effect(() => {
		// Track deps explicitly.
		const s = phase;
		const n = artist?.name ?? '';
		if (!ready) {
			ready = true;
			prevState = s;
			prevName = n;
			return;
		}
		if (s !== prevState || (s === 'artist' && n !== prevName)) {
			roll(idxFor(s), n, artist?.genre ?? '');
		}
		prevState = s;
		prevName = n;
	});

	export function intro(delay = 0) {
		roll(idxFor(phase), artist?.name ?? '', artist?.genre ?? '', delay);
	}
</script>

<li class="flex flex-1 justify-center will-change-transform">
	<button
		disabled={phase !== 'artist'}
		onclick={() => phase === 'artist' && onselect?.(artist)}
		class="group grid items-center justify-center overflow-clip text-center text-sm outline-none *:[grid-area:1/1]"
	>
		<div bind:this={loadingEl} aria-hidden="true" style="transform: translateY(-100%);">Loading…</div>
		<div bind:this={emptyEl} aria-hidden="true" style="transform: translateY(-100%);">No Result</div>
		<div
			bind:this={nameEl}
			class="text-balance"
			style="transform: translateY(-100%);"
		>
			<span class="group-hover:underline group-focus-visible:underline">{shownName}</span>{#if shownCount}<span
					class="ml-1.5 align-middle text-xs text-secondary/35">{shownCount}</span
				>{/if}
		</div>
	</button>
</li>
