import * as THREE from 'three';
import { albumVertex, albumFragment, frameFragment } from './shaders.js';

// Deterministic PRNG so a given artist always scatters the same way.
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Frame-rate independent exponential smoothing toward a target.
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

export class Atlas {
	constructor(canvas, options = {}) {
		this.canvas = canvas;
		this.aspectHint = options.aspect ?? 1; // height/width hint for portrait covers
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(0x000000, 0);

		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
		this.camera.position.z = 10;

		this.world = new THREE.Group();
		this.scene.add(this.world);

		this.albums = [];
		this.items = [];
		this.focused = null;
		this.frame = null;

		// pan state (pixels)
		this.pan = new THREE.Vector2(0, 0);
		this.target = new THREE.Vector2(0, 0);
		this.last = new THREE.Vector2(0, 0);
		this.velocity = new THREE.Vector2(0, 0);
		this.dragVel = new THREE.Vector2(0, 0);
		this.dragging = false;
		this.bounds = { x: 0, y: 0 };

		this._listeners = { select: [] };
		this.size = 1;
		this.cell = 1;
		this._now = performance.now();

		this.raycaster = new THREE.Raycaster();
		this._ndc = new THREE.Vector2();

		this._bind();
		this.resize();
		this._loop = this._loop.bind(this);
		this._raf = requestAnimationFrame(this._loop);
	}

	on(evt, cb) {
		(this._listeners[evt] ||= []).push(cb);
		return this;
	}
	_emit(evt, ...a) {
		(this._listeners[evt] || []).forEach((cb) => cb(...a));
	}

	_bind() {
		this._onResize = () => this.resize();
		window.addEventListener('resize', this._onResize);

		const c = this.canvas;
		this._onDown = (e) => this._pointerDown(e);
		this._onMove = (e) => this._pointerMove(e);
		this._onUp = (e) => this._pointerUp(e);
		this._onWheel = (e) => this._wheel(e);
		c.addEventListener('pointerdown', this._onDown);
		window.addEventListener('pointermove', this._onMove);
		window.addEventListener('pointerup', this._onUp);
		c.addEventListener('wheel', this._onWheel, { passive: false });
	}

	resize() {
		const w = this.canvas.clientWidth || window.innerWidth;
		const h = this.canvas.clientHeight || window.innerHeight;
		this.w = w;
		this.h = h;
		this.renderer.setSize(w, h, false);
		this.camera.left = -w / 2;
		this.camera.right = w / 2;
		this.camera.top = h / 2;
		this.camera.bottom = -h / 2;
		this.camera.updateProjectionMatrix();

		const newSize = Math.round(Math.min(w, h) * (this.aspectHint > 1 ? 0.11 : 0.135));
		this.size = newSize;
		this.cell = newSize * 1.26;
		this.cellX = newSize * 1.26;
		this.cellY = newSize * (this.aspectHint > 1 ? this.aspectHint * 1.08 : 1.26);
		this.items.forEach((it) => {
			it.mesh.geometry.dispose();
			it.mesh.geometry = new THREE.PlaneGeometry(this.size, this.size, 16, 16);
			it.mat.uniforms.uSize.value = this.size;
		});
	}

	setAlbums(albums) {
		this.clearAlbums();
		this.albums = albums;
		const n = albums.length;
		if (!n) return;

		const seed = albums.reduce((s, a) => (s + (a.id || 0)) | 0, 7);
		const rand = mulberry32(seed);

		const density = 0.34;
		const totalCells = Math.max(n, Math.ceil(n / density));
		const cols = Math.max(3, Math.round(Math.sqrt(totalCells * (this.w / this.h))));
		const rows = Math.ceil(totalCells / cols);

		const cells = [];
		for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r });
		for (let i = cells.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[cells[i], cells[j]] = [cells[j], cells[i]];
		}

		const gridW = (cols - 1) * this.cellX;
		const gridH = (rows - 1) * this.cellY;

		albums.forEach((album, i) => {
			const { c, r } = cells[i];
			const baseX = c * this.cellX - gridW / 2;
			const baseY = -(r * this.cellY - gridH / 2);
			this._makeItem(album, baseX, baseY, i);
		});

		this.bounds.x = Math.max(0, gridW / 2 - this.w / 2 + this.cellX);
		this.bounds.y = Math.max(0, gridH / 2 - this.h / 2 + this.cellY);
	}

	_makeItem(album, baseX, baseY, i) {
		const geo = new THREE.PlaneGeometry(this.size, this.size, 16, 16);
		const mat = new THREE.ShaderMaterial({
			uniforms: {
				uMap: { value: null },
				uSize: { value: this.size },
				uVel: { value: this.dragVel },
				uOpacity: { value: 1 }
			},
			vertexShader: albumVertex,
			fragmentShader: albumFragment,
			transparent: true
		});
		const mesh = new THREE.Mesh(geo, mat);
		mesh.position.set(baseX, baseY, 0);
		mesh.scale.setScalar(0);
		mesh.visible = false;
		this.world.add(mesh);

		const item = {
			mesh,
			mat,
			album,
			baseX,
			baseY,
			scale: 0,
			tScale: 0, // entrance handled once texture + delay land
			tx: baseX,
			ty: baseY,
			opacity: 1,
			tOpacity: 1,
			enterAt: Infinity,
			aspect: this.aspectHint // height/width; refined once the texture loads
		};
		this.items.push(item);

		const url = album.artwork || album.thumb;
		loader.load(
			url,
			(tex) => {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.generateMipmaps = true;
				tex.minFilter = THREE.LinearMipmapLinearFilter;
				tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
				mat.uniforms.uMap.value = tex;
				if (tex.image?.width) item.aspect = tex.image.height / tex.image.width;
				mesh.visible = true;
				item.enterAt = performance.now() + 60 + (i % 24) * 45;
			},
			undefined,
			() => {}
		);
	}

	clearAlbums() {
		this.items.forEach((it) => {
			this.world.remove(it.mesh);
			it.mesh.geometry.dispose();
			it.mat.dispose();
			it.mat.uniforms.uMap.value?.dispose();
		});
		this._removeFrame();
		this.items = [];
		this.albums = [];
		this.focused = null;
		this.pan.set(0, 0);
		this.target.set(0, 0);
		this.velocity.set(0, 0);
	}

	// ---- interaction ----
	_pointerDown(e) {
		// Always record the press so a focused tap can be detected as a dismiss.
		this._downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
		if (this.focused) return; // no panning while a book is focused
		this.dragging = true;
		this.last.set(e.clientX, e.clientY);
		this.velocity.set(0, 0);
		try {
			this.canvas.setPointerCapture(e.pointerId);
		} catch {
			/* synthetic pointer */
		}
		this.canvas.style.cursor = 'grabbing';
	}
	_pointerMove(e) {
		if (!this.dragging) return;
		const dx = e.clientX - this.last.x;
		const dy = e.clientY - this.last.y;
		this.last.set(e.clientX, e.clientY);
		this.target.x += dx;
		this.target.y -= dy;
		this.velocity.set(dx, -dy);
	}
	_pointerUp(e) {
		const moved =
			this._downAt &&
			Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) < 6 &&
			performance.now() - this._downAt.t < 400;

		// A tap while a book is focused → dismiss back to the atlas.
		if (this.focused) {
			if (moved) this._emit('dismiss');
			return;
		}

		if (!this.dragging) return;
		this.dragging = false;
		this.canvas.style.cursor = 'grab';
		if (moved) this._pick(e.clientX, e.clientY);
	}
	_wheel(e) {
		if (this.focused) return;
		e.preventDefault();
		this.target.x -= e.deltaX;
		this.target.y += e.deltaY;
		this.velocity.set(-e.deltaX * 0.4, e.deltaY * 0.4);
	}
	_pick(cx, cy) {
		const rect = this.canvas.getBoundingClientRect();
		this._ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
		this._ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
		this.raycaster.setFromCamera(this._ndc, this.camera);
		const hits = this.raycaster.intersectObjects(this.items.filter((i) => i.mesh.visible).map((i) => i.mesh));
		if (hits.length) {
			const it = this.items.find((i) => i.mesh === hits[0].object);
			if (it) this._emit('select', it.album, it);
		}
	}

	// ---- focus / detail ----
	focus(item) {
		if (!item) return;
		this.focused = item;
		this.dragging = false;
		this.velocity.set(0, 0);
		this.target.copy(this.pan);

		// Centre the focused book and size it to fit the central column, capping
		// BOTH width and height so it never collides with the side panels
		// (metadata ~25vw right, subjects/description ~28vw left) — works for
		// portrait and near-square covers alike.
		const maxW = this.w * 0.4;
		const maxH = this.h * 0.68;
		item.tScale = Math.min(maxW / this.size, maxH / (this.size * item.aspect));
		item.tx = -this.pan.x; // horizontal centre
		item.ty = -this.pan.y; // vertical centre

		this._makeFrame(item);

		this.items.forEach((it) => {
			if (it !== item) it.tOpacity = 0;
		});
	}

	unfocus() {
		const item = this.focused;
		if (!item) return;
		this.focused = null;
		this._removeFrame();
		item.tScale = 1;
		item.tx = item.baseX;
		item.ty = item.baseY;
		this.items.forEach((it) => (it.tOpacity = 1));
	}

	_makeFrame(item) {
		this._removeFrame();
		const geo = new THREE.PlaneGeometry(this.size * 1.1, this.size * 1.1, 16, 16);
		const mat = new THREE.ShaderMaterial({
			uniforms: { uSize: { value: this.size }, uVel: { value: this.dragVel } },
			vertexShader: albumVertex,
			fragmentShader: frameFragment,
			transparent: true
		});
		const frame = new THREE.Mesh(geo, mat);
		frame.renderOrder = -1;
		this.frame = frame;
		this._frameFor = item;
		this.world.add(frame);
	}
	_removeFrame() {
		if (this.frame) {
			this.world.remove(this.frame);
			this.frame.geometry.dispose();
			this.frame.material.dispose();
			this.frame = null;
			this._frameFor = null;
		}
	}

	_clamp() {
		const bx = this.bounds.x;
		const by = this.bounds.y;
		this.target.x = Math.max(-bx, Math.min(bx, this.target.x));
		this.target.y = Math.max(-by, Math.min(by, this.target.y));
	}

	_loop() {
		this._raf = requestAnimationFrame(this._loop);
		const now = performance.now();
		const dt = Math.min(0.05, (now - this._now) / 1000);
		this._now = now;

		if (!this.focused) {
			if (!this.dragging) {
				this.target.x += this.velocity.x;
				this.target.y += this.velocity.y;
				this.velocity.multiplyScalar(0.9);
				if (this.velocity.lengthSq() < 0.01) this.velocity.set(0, 0);
			}
			this._clamp();
		}

		const prevX = this.pan.x;
		const prevY = this.pan.y;
		this.pan.x = damp(this.pan.x, this.target.x, 14, dt);
		this.pan.y = damp(this.pan.y, this.target.y, 14, dt);
		this.world.position.set(this.pan.x, this.pan.y, 0);

		// drag velocity → shader warp, relaxing to 0
		const moveX = this.pan.x - prevX;
		const moveY = this.pan.y - prevY;
		const targetVelX = -moveX * 0.02;
		const targetVelY = -moveY * 0.02;
		this.dragVel.x = damp(this.dragVel.x, targetVelX, 18, dt);
		this.dragVel.y = damp(this.dragVel.y, targetVelY, 18, dt);
		const max = 0.4;
		this.dragVel.x = Math.max(-max, Math.min(max, this.dragVel.x));
		this.dragVel.y = Math.max(-max, Math.min(max, this.dragVel.y));

		// per-item tweens
		for (const it of this.items) {
			if (it.enterAt !== Infinity && now >= it.enterAt && it.tScale === 0) it.tScale = 1;
			it.scale = damp(it.scale, it.tScale, 9, dt);
			it.mesh.scale.set(it.scale, it.scale * it.aspect, 1);
			it.mesh.position.x = damp(it.mesh.position.x, it.tx, 9, dt);
			it.mesh.position.y = damp(it.mesh.position.y, it.ty, 9, dt);
			it.opacity = damp(it.opacity, it.tOpacity, 10, dt);
			it.mat.uniforms.uOpacity.value = it.opacity;
		}

		if (this.frame && this._frameFor) {
			this.frame.position.copy(this._frameFor.mesh.position);
			this.frame.scale.copy(this._frameFor.mesh.scale);
		}

		this.renderer.render(this.scene, this.camera);
	}

	dispose() {
		cancelAnimationFrame(this._raf);
		window.removeEventListener('resize', this._onResize);
		window.removeEventListener('pointermove', this._onMove);
		window.removeEventListener('pointerup', this._onUp);
		this.canvas.removeEventListener('pointerdown', this._onDown);
		this.canvas.removeEventListener('wheel', this._onWheel);
		this.clearAlbums();
		this.renderer.dispose();
	}
}
