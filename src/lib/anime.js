import { engine } from 'animejs';

// Match the original Album Atlas defaults (anime.js v4):
//   defaults.duration = 500ms, defaults.ease = 'outExpo'.
// anime's built-in main loop drives DOM animations (landing UI). The WebGL
// atlas does its own tweening inside its render loop, so it doesn't depend on
// this engine at all.
engine.defaults.duration = 500;
engine.defaults.ease = 'outExpo';

export { animate, createTimeline, stagger, utils, engine, remove } from 'animejs';
