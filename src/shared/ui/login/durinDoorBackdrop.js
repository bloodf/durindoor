/**
 * Doors of Durin login backdrop.
 *
 * Full-viewport procedural background for /login: a dark stone wall with a
 * glowing emerald door outline that slowly shimmers. Rendered with WebGL when
 * available, a Canvas 2D fallback otherwise, and a single static frame when
 * the user prefers reduced motion. The animation loop pauses while the
 * document is hidden.
 *
 * Palette is never hardcoded: colors are parsed from the Durin DS custom
 * properties (--dd-bg / --dd-surface-2 / --dd-accent) via getComputedStyle at
 * init and re-read whenever the theme class flips on <html>. The float-array
 * fallbacks below only cover a stylesheet that failed to load.
 *
 * Everything is code-drawn; no external assets or dependencies.
 *
 * @module src/shared/ui/login/durinDoorBackdrop
 */

import { isFunction, isString } from "@/shared/utils/typeChecks.js";

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

// Stone wall: brick grid + value noise. Door: signed distance to a Durin-style
// outline (two jambs + semicircular arch), drawn as a bright core line with an
// exponential glow halo; a second, smaller outline echoes the frame. The
// shimmer term modulates glow intensity along the outline over time.
const FRAG = `
precision mediump float;
uniform vec2 uRes;uniform float uTime;
uniform vec3 uStone;uniform vec3 uMortar;uniform vec3 uGlow;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;
float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float door(vec2 p,float s){p/=s;float w=.20,base=-.62,top=.08;
float d=min(sdSeg(p,vec2(-w,base),vec2(-w,top)),sdSeg(p,vec2(w,base),vec2(w,top)));
float arc=abs(length(p-vec2(0.,top))-w);if(p.y<top)arc=1.;return min(d,arc)*s;}
void main(){
vec2 uv=gl_FragCoord.xy/uRes;
vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
vec2 g=uv*vec2(7.,9.);g.x+=mod(floor(g.y),2.)*.5;
vec2 f=fract(g);
float edge=min(min(f.x,1.-f.x)*7.,min(f.y,1.-f.y)*9.);
float stone=noise(floor(g)*3.7)*.55+noise(uv*26.)*.2;
vec3 col=mix(uStone,uMortar,stone*.4);
col=mix(col,uStone*.65,smoothstep(.5,.0,edge));
float shimmer=.72+.28*sin(uTime*1.3+p.y*7.+noise(p*4.)*3.);
float d1=door(p,1.);float d2=door(p,.78);
col+=uGlow*(exp(-d1*20.)*.30*shimmer+smoothstep(.014,.0,d1)*.85*shimmer);
col+=uGlow*(exp(-d2*26.)*.16*shimmer+smoothstep(.010,.0,d2)*.45*shimmer);
float rune=step(.985,noise(floor(p*vec2(28.,36.))+floor(uTime*.5)));
col+=uGlow*rune*exp(-d1*3.)*.25*shimmer;
col*=1.-.45*dot(p,p);
gl_FragColor=vec4(col,1.);}`;

/** Parse `#rgb` / `#rrggbb` / `rgb(...)` / `rgba(...)` into [r,g,b] floats, or null. */
export function parseCssColor(value) {
  if (!isString(value)) return null;
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return null;
}

/** Read the backdrop palette from a getComputedStyle result (theme-aware). */
export function readBackdropPalette(style) {
  const read = (name, fallback) => {
    const raw = isFunction(style?.getPropertyValue) ? style.getPropertyValue(name) : "";
    return parseCssColor(raw) ?? fallback;
  };
  return {
    stone: read("--dd-bg", [0.055, 0.051, 0.043]),
    mortar: read("--dd-surface-2", [0.13, 0.125, 0.11]),
    glow: read("--dd-accent", [0.063, 0.91, 0.51]),
  };
}

/**
 * Fallback decision, kept pure for unit tests:
 * WebGL first, Canvas 2D when WebGL is unavailable, nothing otherwise;
 * reduced motion always renders one static frame (no animation loop).
 */
export function resolveBackdropMode(webglSupported, canvas2dSupported, reducedMotion) {
  const renderer = webglSupported ? "webgl" : canvas2dSupported ? "canvas2d" : "none";
  return { renderer, animated: renderer !== "none" && !reducedMotion };
}

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/**
 * Start the backdrop on a canvas. Returns a controller with destroy().
 * Never throws: any WebGL failure degrades to Canvas 2D or a blank canvas.
 */
export function startDurinDoorBackdrop(canvas) {
  if (!canvas || !isFunction(canvas.getContext)) return { destroy() {} };
  const doc = canvas.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return { destroy() {} };
  const reduced = isFunction(win?.matchMedia) && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = null;
  try { gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); } catch { gl = null; }
  const ctx2d = gl ? null : canvas.getContext("2d");
  const mode = resolveBackdropMode(Boolean(gl), Boolean(ctx2d), reduced);
  let palette = readBackdropPalette(win?.getComputedStyle(doc.documentElement));
  let raf = 0;
  let program = null;
  let uLoc = {};

  if (mode.renderer === "webgl") {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = vs && fs ? gl.createProgram() : null;
    if (program) {
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) program = null;
    }
    if (program) {
      gl.useProgram(program);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(program, "a");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      for (const n of ["uRes", "uTime", "uStone", "uMortar", "uGlow"]) uLoc[n] = gl.getUniformLocation(program, n);
    } else mode.renderer = ctx2d ? "canvas2d" : "none";
  }

  function resize() {
    const dpr = win?.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function paint(time) {
    resize();
    if (mode.renderer === "webgl") {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uLoc.uRes, canvas.width, canvas.height);
      gl.uniform1f(uLoc.uTime, time);
      gl.uniform3fv(uLoc.uStone, palette.stone);
      gl.uniform3fv(uLoc.uMortar, palette.mortar);
      gl.uniform3fv(uLoc.uGlow, palette.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (mode.renderer === "canvas2d") {
      const { width: w, height: h } = canvas;
      const [sr, sg, sb] = palette.stone.map((v) => Math.round(v * 255));
      const [gr, gg, gb] = palette.glow.map((v) => Math.round(v * 255));
      ctx2d.fillStyle = `rgb(${sr},${sg},${sb})`;
      ctx2d.fillRect(0, 0, w, h);
      const shimmer = 0.72 + 0.28 * Math.sin(time * 1.3);
      const cx = w / 2, dw = Math.min(h * 0.2, w * 0.16), top = h * 0.42, base = h * 0.9;
      ctx2d.save();
      ctx2d.strokeStyle = `rgba(${gr},${gg},${gb},${0.85 * shimmer})`;
      ctx2d.shadowColor = `rgb(${gr},${gg},${gb})`;
      ctx2d.shadowBlur = 26 * shimmer;
      ctx2d.lineWidth = Math.max(2, h * 0.004);
      ctx2d.beginPath();
      ctx2d.moveTo(cx - dw, base); ctx2d.lineTo(cx - dw, top);
      ctx2d.arc(cx, top, dw, Math.PI, 0);
      ctx2d.lineTo(cx + dw, base);
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  function frame(now) {
    raf = 0;
    paint(now / 1000);
    if (mode.animated && !doc.hidden) raf = win.requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && mode.renderer !== "none") {
      if (mode.animated && !doc.hidden) raf = win.requestAnimationFrame(frame);
      else paint(0);
    }
  }
  const onVisibility = () => { if (!doc.hidden) kick(); };
  const onTheme = () => {
    palette = readBackdropPalette(win.getComputedStyle(doc.documentElement));
    if (!mode.animated) paint(0);
  };
  const observer = isFunction(win?.MutationObserver)
    ? new win.MutationObserver(onTheme)
    : null;
  observer?.observe(doc.documentElement, { attributes: true, attributeFilter: ["class"] });
  doc.addEventListener("visibilitychange", onVisibility);
  kick();

  return {
    destroy() {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      doc.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    },
  };
}
