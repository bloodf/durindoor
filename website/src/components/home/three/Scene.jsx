"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { DoubleSide } from "three";
import { gateOpening } from "./gateOpening.js";

const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const aperture = `
  float doorway(vec2 px){
    float cap=pow((px.x-1265.)/275.,2.)+pow((px.y-400.)/270.,2.);
    return step(995.,px.x)*step(px.x,1540.)*step(px.y,905.)*max(step(400.,px.y),1.-step(1.,cap));
  }
`;
const background = `varying vec2 vUv; uniform sampler2D uGate; uniform float uTime; uniform float uOpen;
${aperture}
void main(){
 vec2 px=vec2(vUv.x*1920.,(1.-vUv.y)*1080.);
 vec3 color=pow(texture2D(uGate,vUv).rgb,vec3(2.2));
 vec2 q=(px-vec2(1265.,560.))/vec2(275.,345.);
 float light=exp(-length(q*vec2(1.,.6))*2.8);
 float vault=pow(max(0.,cos(length(q*vec2(1.,.7))*24.)),24.)*.025;
 vec3 tunnel=vec3(.005,.015,.011)+vec3(.025,.22,.12)*light+vec3(.02,.07,.04)*vault;
 for(int i=1;i<6;i++){
   float depth=float(i);vec2 a=q*pow(1.48,depth);
   float arch=max(abs(a.x),length(vec2(a.x,max(0.,-a.y-.25))));
   float stone=exp(-abs(arch-.9)*65.);
   tunnel+=vec3(.10,.15,.12)*stone/(depth*.65);
 }
 float floorLine=exp(-abs(q.y-(.9-abs(q.x)*.12))*100.);
 tunnel+=vec3(.12,.3,.21)*floorLine;
 tunnel*=.38;
 color=mix(color,tunnel,doorway(px));
 float mist=sin(vUv.x*22.+uTime*.25)*sin(vUv.y*18.-uTime*.12)*.5+.5;
 color+=vec3(.01,.035,.022)*mist*pow(1.-vUv.y,4.);
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
const leaf = `varying vec2 vUv; uniform sampler2D uGate; uniform float uStart; uniform float uWidth;
${aperture}
void main(){
 vec2 px=vec2(uStart+vUv.x*uWidth,905.-vUv.y*775.);
 if(doorway(px)<.5)discard;
 vec3 color=pow(texture2D(uGate,vec2(px.x/1920.,1.-px.y/1080.)).rgb,vec3(2.2));
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
function Gate({ progress, opened }) {
  const texture = useTexture("/brand/durindoor-gateway.webp");
  const left = useRef(null),
    right = useRef(null);
  const { camera, size } = useThree();
  const uniforms = useMemo(
    () => ({
      uGate: { value: texture },
      uTime: { value: 0 },
      uOpen: { value: 0 },
    }),
    [texture],
  );
  const leaves = useMemo(
    () =>
      [-1, 1].map((side) => ({
        ...uniforms,
        uStart: { value: side < 0 ? 995 : 1265 },
        uWidth: { value: side < 0 ? 270 : 275 },
      })),
    [uniforms],
  );
  useEffect(() => {
    camera.zoom = size.height / 6;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  useFrame((state, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05);
    const target = gateOpening(progress?.get() ?? 0, opened);
    uniforms.uOpen.value +=
      (target - uniforms.uOpen.value) *
      (1 - Math.exp(-Math.min(delta, 0.05) * 2.5));
    left.current.rotation.y = uniforms.uOpen.value * 1.32;
    right.current.rotation.y = -uniforms.uOpen.value * 1.32;
  });
  const x = (px) => (px / 1920 - 0.5) * 10.6667;
  const y = (0.5 - 517.5 / 1080) * 6;
  return (
    <group position={[-1.15, 0, 0]}>
      <mesh position={[0, 0, -0.1]}>
        <planeGeometry args={[10.6667, 6]} />
        <shaderMaterial
          vertexShader={vertex}
          fragmentShader={background}
          uniforms={uniforms}
        />
      </mesh>
      {[-1, 1].map((side, i) => (
        <group
          key={side}
          ref={side < 0 ? left : right}
          position={[x(side < 0 ? 995 : 1540), y, 0]}
        >
          <mesh position={[side < 0 ? 0.75 : -0.7639, 0, 0]}>
            <planeGeometry args={[side < 0 ? 1.5 : 1.5278, 4.3056]} />
            <shaderMaterial
              vertexShader={vertex}
              fragmentShader={leaf}
              uniforms={leaves[i]}
              side={DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
/** Two real hinged meshes carry the engraved door texture; the frame stays fixed. */
export default function Scene({ progress, opened, onFailure }) {
  const ref = useRef(null);
  const [active, setActive] = useState(true);
  useEffect(() => {
    let visible = true;
    const sync = () => setActive(visible && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(ref.current);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return (
    <div ref={ref} className="gateway-webgl">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10], near: 0.1, far: 30 }}
        dpr={[1, 1.5]}
        frameloop={active ? "always" : "never"}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        onCreated={({ gl }) =>
          gl.domElement.addEventListener("webglcontextlost", onFailure, {
            once: true,
          })
        }
      >
        <Suspense fallback={null}>
          <Gate progress={progress} opened={opened} />
        </Suspense>
      </Canvas>
    </div>
  );
}
