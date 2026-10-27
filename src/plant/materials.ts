import * as THREE from 'three';

// Fine horizontal streaks, like brushed stainless steel. Generated once, no image files needed.
function brushedTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const shade = 170 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 30 + Math.random() * 120, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const brushed = brushedTexture();

export const mat = {
  steel: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, map: brushed, metalness: 0.85, roughness: 0.32 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x7d8288, map: brushed, metalness: 0.8, roughness: 0.4 }),
  steelOpen: new THREE.MeshStandardMaterial({
    color: 0xc4c8cc, map: brushed, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide,
  }),
  belt: new THREE.MeshStandardMaterial({ color: 0x2d3136, roughness: 0.85, metalness: 0.05 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.5, metalness: 0.05 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xd6dbdf, roughness: 0.9 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.95 }),
  panelWhite: new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.45, metalness: 0.1 }),
  screen: new THREE.MeshStandardMaterial({ color: 0x0d2a3a, emissive: 0x0b3d57, emissiveIntensity: 0.6, roughness: 0.2 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe3ee, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0 }),
  safetyYellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }),
  lightPanel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.9 }),
  labelRoll: new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.7 }),
};
