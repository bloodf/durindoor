/** Storybook gate: ray-marched 3D doorway with a static CSS fallback. */
import { readBackdropPalette } from '../../login/durinDoorBackdrop.js';

export function gateMotionMode({ reducedMotion = false, hidden = false, paused = false, webgl = true } = {}) {
  return { renderer: webgl ? 'webgl' : 'css', animated: webgl && !reducedMotion && !hidden && !paused };
}

const vertex = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
const fragment = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform vec3 stone;
uniform vec3 accent;
float box(vec3 p, vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
vec2 scene(vec3 p){
 float floorD=p.y+1.8;
 float pillars=min(box(p-vec3(-1.05,0.,0.),vec3(.18,1.8,.25)),box(p-vec3(1.05,0.,0.),vec3(.18,1.8,.25)));
 vec3 arch=p-vec3(0.,.85,0.);float rim=length(arch.xy)-1.05;
 float crown=max(abs(rim)-.17,abs(p.z)-.25);crown=max(crown,.85-p.y);
 float frame=min(pillars,crown);
 vec3 leaf=p-vec3(.85,-.4,0.);leaf.xz=turn(-.78-.46*sin(time*.65))*leaf.xz;
 float door=box(leaf-vec3(-.72,0.,0.),vec3(.72,1.4,.045));
 float star=length(p-vec3(0.,1.9,0.))-.09;
 float interior=p.y>.85?length(p.xy-vec2(0.,.85))-.84:abs(p.x)-.84;
 float portal=max(abs(p.z+.42)-.015,max(interior,-1.6-p.y));
 float d=min(floorD,min(portal,min(frame,min(door,star))));
 return vec2(d,d==star?3.:d==portal?4.:d==door?2.:d==frame?1.:0.);
}
vec3 normal(vec3 p){vec2 e=vec2(.002,0.);return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));}
void main(){
 vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
 vec3 camera=vec3(2.7+.25*sin(time*.16),1.6,5.5);
 vec3 forward=normalize(vec3(0.,.15,0.)-camera);vec3 right=normalize(cross(forward,vec3(0.,1.,0.)));vec3 up=cross(right,forward);
 vec3 ray=normalize(forward+uv.x*right*1.6+uv.y*up*1.6);
 float travel=0.;vec2 hit=vec2(0.);
 for(int i=0;i<76;i++){hit=scene(camera+ray*travel);if(hit.x<.002||travel>16.)break;travel+=hit.x*.8;}
 vec3 col=stone;
 if(travel<16.){vec3 p=camera+ray*travel;vec3 n=normal(p);vec3 light=normalize(vec3(-2.+1.2*sin(time*.65),5.,4.)-p);float diffuse=max(dot(n,light),0.);
 vec3 surface=hit.y==1.?mix(stone,accent,.46):hit.y==2.?mix(stone,accent,.20):stone;
 col=surface*(.85+diffuse*1.15);float spec=pow(max(dot(reflect(-light,n),-ray),0.),30.);col+=accent*spec*.9;
 if(hit.y==3.)col=accent*1.6;
 if(hit.y==4.){float offset=p.x-.45*sin(time*.65);float beam=exp(-offset*offset*12.);col=accent*(.35+.30*beam+.06*sin(p.y*3.-time*1.3));}
 float opening=exp(-abs(p.x)*2.2)*exp(-abs(p.y)*.7);if(hit.y==0.)col+=accent*opening*(.25+.10*sin(time*.65));
 col=mix(col,stone,1.-exp(-travel*.045));}
 float shaft=exp(-abs(uv.x+.05)*12.)*exp(-abs(uv.y)*2.);col+=accent*shaft*(.035+.015*sin(time*.7));
 gl_FragColor=vec4(col,1.);
}`;

/** Owns buffers, bounded DPR, theme, resize, motion preference and visibility. */
export function startGateScene(canvas, { fallback = false, paused = false, onMode = () => {} } = {}) {
  if (fallback) { onMode('css'); return { destroy() {}, setPaused() {} }; }
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) { onMode('css'); return { destroy() {}, setPaused() {} }; }
  const shaders = [];
  const compile = (type, source) => {
    const shader = gl.createShader(type); shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const v = compile(gl.VERTEX_SHADER, vertex), f = compile(gl.FRAGMENT_SHADER, fragment);
  if (!v || !f) { shaders.forEach((shader) => gl.deleteShader(shader)); onMode('css'); return { destroy() {}, setPaused() {} }; }
  const program = gl.createProgram(); gl.attachShader(program, v); gl.attachShader(program, f); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { shaders.forEach((shader) => gl.deleteShader(shader)); gl.deleteProgram(program); onMode('css'); return { destroy() {}, setPaused() {} }; }
  gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['resolution','time','stone','accent'].map((key) => [key, gl.getUniformLocation(program, key)]));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, stopped = false, manuallyPaused = paused, elapsed = 0, last = 0;
  const draw = (now = 0) => {
    if (stopped) return;
    const bounds = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(1, Math.round(bounds.width*dpr)), height = Math.max(1, Math.round(bounds.height*dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width=width; canvas.height=height; }
    gl.viewport(0,0,width,height);
    const palette = readBackdropPalette(getComputedStyle(document.documentElement));
    if (last && now) elapsed += Math.min(now-last,50)/1000; last=now;
    gl.uniform2f(uniforms.resolution,width,height); gl.uniform1f(uniforms.time,elapsed);
    gl.uniform3fv(uniforms.stone,palette.stone); gl.uniform3fv(uniforms.accent,palette.glow); gl.drawArrays(gl.TRIANGLES,0,6);
    frame=0;
    if (gateMotionMode({ reducedMotion: motion.matches, hidden: document.hidden, paused: manuallyPaused }).animated) frame=requestAnimationFrame(draw);
  };
  const refresh = () => { if(frame) cancelAnimationFrame(frame); frame=0; last=0; draw(); };
  const resize = new ResizeObserver(refresh); resize.observe(canvas);
  const theme = new MutationObserver(refresh); theme.observe(document.documentElement,{ attributes:true, attributeFilter:['class','data-theme','data-v5-review'] });
  document.addEventListener('visibilitychange',refresh); motion.addEventListener('change',refresh);
  const contextLost = (event) => { event.preventDefault(); if(frame)cancelAnimationFrame(frame); frame=0; onMode('css'); };
  canvas.addEventListener('webglcontextlost',contextLost);
  onMode('webgl'); refresh();
  return { setPaused(value) { manuallyPaused=value; refresh(); }, destroy() { stopped=true; if(frame)cancelAnimationFrame(frame); resize.disconnect(); theme.disconnect(); document.removeEventListener('visibilitychange',refresh); motion.removeEventListener('change',refresh); canvas.removeEventListener('webglcontextlost',contextLost); gl.deleteBuffer(buffer); shaders.forEach((shader)=>gl.deleteShader(shader)); gl.deleteProgram(program); } };
}
