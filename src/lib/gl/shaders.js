// Shaders reproduced from the original Album Atlas WebGL material.
// The album plane bends toward the drag-velocity direction (corners trail),
// and the texture is sampled with a velocity-driven RGB chromatic aberration.

export const albumVertex = /* glsl */ `
	uniform float uSize;
	uniform vec2 uVel;
	varying vec2 vUv;

	void main() {
		vUv = uv;
		vec3 pos = position;

		vec2 normalizedPos = pos.xy / uSize;
		float distSq = dot(normalizedPos, normalizedPos);
		float strength = 6.0;

		pos.x += uVel.x * distSq * strength;
		pos.y += uVel.y * distSq * strength;
		pos.z += length(uVel) * distSq * strength;

		gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
	}
`;

export const albumFragment = /* glsl */ `
	uniform sampler2D uMap;
	uniform vec2 uVel;
	uniform float uOpacity;
	varying vec2 vUv;

	void main() {
		vec2 abberationOffset = uVel * 0.15;

		float r = texture2D(uMap, vUv + abberationOffset).r;
		float g = texture2D(uMap, vUv).g;
		float b = texture2D(uMap, vUv - abberationOffset).b;

		gl_FragColor = vec4(r, g, b, uOpacity);

		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	}
`;

// Thin frame drawn behind the focused album (plane scaled to 1.1×).
// Discards the inner 98% so only a 1% border ring remains.
export const frameFragment = /* glsl */ `
	varying vec2 vUv;

	void main() {
		if (vUv.x > 0.01 && vUv.x < 0.99 &&
			vUv.y > 0.01 && vUv.y < 0.99) {
			discard;
		}

		gl_FragColor = vec4(0.039, 0.039, 0.039, 1.0);
	}
`;
