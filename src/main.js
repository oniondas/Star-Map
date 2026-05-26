import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import './styles.css';

const MAX_SCENE_RADIUS = 105;
const CATALOG_STYLE = {
  gaia: { label: 'Gaia stars', baseSize: 4.8 },
  exoplanets: { label: 'Exoplanet systems', baseSize: 7.2 },
  ned: { label: 'NED galaxies/quasars', baseSize: 5.8 },
};

const canvas = document.querySelector('#universe');
const tooltip = document.querySelector('#tooltip');
const statusText = document.querySelector('#statusText');
const countText = document.querySelector('#countText');
const sourceList = document.querySelector('#sourceList');
const sizeControl = document.querySelector('#sizeControl');
const intensityControl = document.querySelector('#intensityControl');
const resetView = document.querySelector('#resetView');
const refreshData = document.querySelector('#refreshData');
const searchInput = document.querySelector('#searchInput');
const layerToggles = [...document.querySelectorAll('[data-layer]')];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.007);

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 72, 150);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.3, 0.85);
bloomPass.threshold = 0.85;
bloomPass.strength = 0.8;
bloomPass.radius = 0.3;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.035; // Heavier, more cinematic feel
controls.minDistance = 6;
controls.maxDistance = 360;
controls.target.set(0, 0, 0);
controls.autoRotateSpeed = 0.4;

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.6;
const pointer = new THREE.Vector2(-10, -10);
let pointerClient = { x: 0, y: 0 };
let lastInteractionTime = performance.now();
let isFlying = false;
let flyTargetPos = new THREE.Vector3();
let flyTargetLookAt = new THREE.Vector3();

let points = null;
let material = null;
let metadata = [];
let activeLayers = new Set(layerToggles.filter((toggle) => toggle.checked).map((toggle) => toggle.dataset.layer));

const axes = new THREE.Group();
axes.visible = false;
scene.add(axes);
addAxis('#6f8cff', new THREE.Vector3(110, 0, 0));
addAxis('#78e0c2', new THREE.Vector3(0, 0, 110));
addAxis('#ffd36d', new THREE.Vector3(0, 110, 0));

function addAxis(color, end) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.32 }));
  axes.add(line);
}



function colorToArray(hex) {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

function catalogDistanceScale(item, maxDistanceLy) {
  const compressed = Math.log10(item.distanceLy + 1) / Math.log10(maxDistanceLy + 1);
  return THREE.MathUtils.clamp(compressed * MAX_SCENE_RADIUS, 0.2, MAX_SCENE_RADIUS);
}

function sphericalToCartesian(raDeg, decDeg, distance) {
  const ra = THREE.MathUtils.degToRad(raDeg);
  const dec = THREE.MathUtils.degToRad(decDeg);
  const cosDec = Math.cos(dec);
  return [
    distance * cosDec * Math.cos(ra),
    distance * Math.sin(dec),
    distance * cosDec * Math.sin(ra),
  ];
}

function objectSize(item) {
  const base = CATALOG_STYLE[item.catalog].baseSize;
  if (item.catalog === 'gaia' && Number.isFinite(item.magnitude)) {
    return Math.max(2.4, base + (7 - item.magnitude) * 0.9);
  }
  if (item.catalog === 'exoplanets') {
    return base + Math.min(8, item.details.planets.length * 1.2);
  }
  if (item.objectType === 'Quasar') return base + 3.2;
  return base;
}

function disposeCurrentCloud() {
  if (!points) return;
  points.geometry.dispose();
  points.material.dispose();
  scene.remove(points);
  points = null;
}

function buildPointCloud(items) {
  disposeCurrentCloud();
  metadata = items;
  const maxDistanceLy = Math.max(...items.map((item) => item.distanceLy));

  const positions = new Float32Array(items.length * 3);
  const colors = new Float32Array(items.length * 3);
  const sizes = new Float32Array(items.length);
  const brightness = new Float32Array(items.length);
  const objectIndex = new Float32Array(items.length);
  const visibility = new Float32Array(items.length);

  items.forEach((item, index) => {
    const distance = catalogDistanceScale(item, maxDistanceLy);
    const [x, y, z] = sphericalToCartesian(item.ra, item.dec, distance);
    const [r, g, b] = colorToArray(item.color);
    positions.set([x, y, z], index * 3);
    colors.set([r, g, b], index * 3);
    sizes[index] = objectSize(item);
    brightness[index] = item.catalog === 'ned' ? 1.45 : 1.05;
    objectIndex[index] = index;
    visibility[index] = activeLayers.has(item.catalog) ? 1 : 0;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('brightness', new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute('objectIndex', new THREE.BufferAttribute(objectIndex, 1));
  geometry.setAttribute('visibleLayer', new THREE.BufferAttribute(visibility, 1));

  material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSizeScale: { value: Number(sizeControl.value) },
      uIntensity: { value: Number(intensityControl.value) },
      uHoverIndex: { value: -1 },
      uTime: { value: 0.0 },
    },
    vertexShader: `
      attribute float size;
      attribute float brightness;
      attribute float objectIndex;
      attribute float visibleLayer;
      varying vec3 vColor;
      varying float vBrightness;
      varying float vIndex;
      varying float vVisible;
      uniform float uPixelRatio;
      uniform float uSizeScale;

      void main() {
        vColor = color;
        vBrightness = brightness;
        vIndex = objectIndex;
        vVisible = visibleLayer;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float perspectiveScale = 150.0 / max(22.0, -mvPosition.z);
        gl_PointSize = size * uSizeScale * uPixelRatio * perspectiveScale * visibleLayer;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vBrightness;
      varying float vIndex;
      varying float vVisible;
      uniform float uIntensity;
      uniform float uHoverIndex;
      uniform float uTime;

      void main() {
        if (vVisible < 0.5) discard;
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;
        
        float core = smoothstep(0.18, 0.0, dist);
        float halo = pow(max(0.0, 1.0 - dist * 2.0), 2.2);
        
        float twinkle = 0.8 + 0.2 * sin(uTime * 2.5 + vIndex * 12.345);
        float hover = abs(vIndex - uHoverIndex) < 0.5 ? 1.0 : 0.0;
        
        // Scale the base color by uIntensity. If the user lowers the slider, 
        // the color drops below the bloom threshold (0.85) and bloom disappears smoothly.
        vec3 color = vColor * (0.4 + core * 2.5 + hover * 2.0) * twinkle * uIntensity;
        float alpha = (core * 1.5 + halo * 1.0) * vBrightness * uIntensity + hover * 1.2;
        
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  points = new THREE.Points(geometry, material);
  scene.add(points);
}

function updateLayerVisibility() {
  if (!points) return;
  const attr = points.geometry.getAttribute('visibleLayer');
  metadata.forEach((item, index) => {
    attr.array[index] = activeLayers.has(item.catalog) ? 1 : 0;
  });
  attr.needsUpdate = true;
}

function formatDistance(ly) {
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(2)} Gly`;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(2)} Mly`;
  if (ly >= 1000) return `${(ly / 1000).toFixed(1)} kly`;
  return `${ly.toFixed(1)} ly`;
}

function tooltipHtml(item) {
  let body = '';
  
  if (item.catalog === 'gaia') {
    const tempLabel = item.details.teffK
      ? `${Math.round(item.details.teffK)} K${item.details.teffEstimated ? ' (est.)' : ''}`
      : 'Unknown';
    const parallaxLabel = item.details.parallaxMas
      ? `${item.details.parallaxMas.toFixed(3)} mas`
      : 'N/A';
    const magLabel = item.magnitude !== null
      ? `${item.magnitude.toFixed(2)} G`
      : 'N/A';
      
    body = `
      <div class="tooltip-grid">
        <span class="label">Type:</span><span>${item.objectType}</span>
        <span class="label">Distance:</span><span>${formatDistance(item.distanceLy)}</span>
        <span class="label">Coordinates:</span><span>${item.ra.toFixed(4)}°, ${item.dec.toFixed(4)}°</span>
        <span class="label">Apparent Mag:</span><span>${magLabel}</span>
        <span class="label">Parallax:</span><span>${parallaxLabel}</span>
        <span class="label">Temperature:</span><span>${tempLabel}</span>
        <span class="label">Radius:</span><span>${item.details.radiusSolar ? item.details.radiusSolar.toFixed(2) + ' R☉' : 'Unknown'}</span>
      </div>
    `;
  } else if (item.catalog === 'exoplanets') {
    const tempLabel = item.details.teffK
      ? `${Math.round(item.details.teffK)} K`
      : 'Unknown';
    const magLabel = item.magnitude !== null
      ? `${item.magnitude.toFixed(2)} V`
      : 'N/A';
    const spectype = item.details.spectralType || 'Unknown';
    
    let planetsStr = 'None';
    if (item.details.planets && item.details.planets.length > 0) {
      const sortedPlanets = [...item.details.planets].sort((a, b) => a.name.localeCompare(b.name));
      planetsStr = sortedPlanets.map(p => {
        const letter = p.name.replace(item.name, '').trim();
        return `<span class="planet-badge">${letter || p.name} (${p.discoveryYear})</span>`;
      }).join(' ');
    }

    body = `
      <div class="tooltip-grid">
        <span class="label">Type:</span><span>${item.objectType}</span>
        <span class="label">Distance:</span><span>${formatDistance(item.distanceLy)}</span>
        <span class="label">Coordinates:</span><span>${item.ra.toFixed(4)}°, ${item.dec.toFixed(4)}°</span>
        <span class="label">Host Mag:</span><span>${magLabel}</span>
        <span class="label">Spectral Type:</span><span>${spectype}</span>
        <span class="label">Host Temp:</span><span>${tempLabel}</span>
        <span class="label">Host Radius:</span><span>${item.details.radiusSolar ? item.details.radiusSolar.toFixed(2) + ' R☉' : 'Unknown'}</span>
      </div>
      <div class="tooltip-planets">
        <div class="label-heading">Confirmed Planets (${item.details.planets.length}):</div>
        <div class="planets-list">${planetsStr}</div>
      </div>
    `;
  } else if (item.catalog === 'ned') {
    const redshiftLabel = `z = ${item.details.redshift.toFixed(5)}`;
    const redshiftFrame = item.details.redshiftFlag
      ? ` (${item.details.redshiftFlag})`
      : '';
    const distanceMpcLabel = item.details.distanceMpc !== null
      ? `${item.details.distanceMpc.toFixed(1)} Mpc`
      : 'N/A';

    body = `
      <div class="tooltip-grid">
        <span class="label">Type:</span><span>${item.objectType}</span>
        <span class="label">Redshift:</span><span>${redshiftLabel}${redshiftFrame}</span>
        <span class="label">Comoving Dist:</span><span>${distanceMpcLabel}</span>
        <span class="label">Light-Travel:</span><span>${formatDistance(item.distanceLy)}</span>
        <span class="label">Coordinates:</span><span>${item.ra.toFixed(4)}°, ${item.dec.toFixed(4)}°</span>
      </div>
    `;
  }

  return `
    <div class="tooltip-header">
      <div class="catalog-badge ${item.catalog}">${CATALOG_STYLE[item.catalog].label}</div>
      <strong>${item.name}</strong>
    </div>
    ${body}
  `;
}

function updateHover() {
  if (!points) return;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(points).find((entry) => activeLayers.has(metadata[entry.index]?.catalog));
  if (!hit) {
    material.uniforms.uHoverIndex.value = -1;
    tooltip.classList.remove('visible');
    return;
  }

  const item = metadata[hit.index];
  material.uniforms.uHoverIndex.value = hit.index;
  tooltip.innerHTML = tooltipHtml(item);
  tooltip.style.transform = `translate(${Math.min(pointerClient.x + 18, window.innerWidth - 270)}px, ${Math.min(pointerClient.y + 18, window.innerHeight - 150)}px)`;
  tooltip.classList.add('visible');
}

async function loadCatalogs(force = false) {
  statusText.textContent = force ? 'Refreshing scientific catalogs...' : 'Loading scientific catalogs...';
  countText.textContent = 'No synthetic objects';
  const cacheBust = force ? `&t=${Date.now()}` : '';
  const response = await fetch(`/api/catalogs?gaia=9000&exoplanets=7000&ned=3000${cacheBust}`);
  if (!response.ok) throw new Error(`Catalog API returned ${response.status}`);
  const payload = await response.json();
  buildPointCloud(payload.items);

  const total = payload.items.length.toLocaleString();
  countText.textContent = `${total} real catalog objects`;
  statusText.textContent = payload.errors.length
    ? `Loaded with ${payload.errors.length} source warning${payload.errors.length === 1 ? '' : 's'}`
    : `Loaded ${new Date(payload.generatedAt).toLocaleString()}`;
  sourceList.innerHTML = payload.sources.map((source) => {
    const count = payload.counts[source.id] || 0;
    const warning = payload.errors.find((error) => error.source === source.id);
    return `<li><a href="${source.url}" target="_blank" rel="noreferrer">${source.name}</a><span>${count.toLocaleString()}${warning ? ` | ${warning.message}` : ''}</span></li>`;
  }).join('');
}

function animate() {
  requestAnimationFrame(animate);
  
  const now = performance.now();
  if (material) material.uniforms.uTime.value = now / 1000.0;
  
  if (now - lastInteractionTime > 4000 && !isFlying) {
    controls.autoRotate = true;
  } else {
    controls.autoRotate = false;
  }

  if (isFlying) {
    camera.position.lerp(flyTargetPos, 0.035);
    controls.target.lerp(flyTargetLookAt, 0.04);
    
    if (camera.position.distanceTo(flyTargetPos) < 1.0) {
      isFlying = false;
    }
  } else {
    const parallaxX = (pointerClient.x / window.innerWidth - 0.5) * 3;
    const parallaxY = (pointerClient.y / window.innerHeight - 0.5) * 3;
    camera.position.x += (parallaxX - camera.position.x * 0.005) * 0.05;
    camera.position.y += (-parallaxY - camera.position.y * 0.005) * 0.05;
  }

  controls.update();
  updateHover();
  composer.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  if (material) material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
});

window.addEventListener('pagehide', () => {
  renderer.dispose();
});

window.addEventListener('pointerdown', () => {
  lastInteractionTime = performance.now();
  if (!points || material.uniforms.uHoverIndex.value === -1) return;
  
  const index = material.uniforms.uHoverIndex.value;
  const attr = points.geometry.getAttribute('position');
  flyTargetLookAt.set(attr.getX(index), attr.getY(index), attr.getZ(index));
  
  const offset = flyTargetLookAt.clone().normalize().multiplyScalar(12);
  if (flyTargetLookAt.length() < 1) offset.set(0, 0, 12);
  
  flyTargetPos.copy(flyTargetLookAt).add(offset);
  isFlying = true;
  tooltip.classList.remove('visible');
});

window.addEventListener('pointermove', (event) => {
  lastInteractionTime = performance.now();
  pointerClient = { x: event.clientX, y: event.clientY };
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

sizeControl.addEventListener('input', () => {
  if (material) material.uniforms.uSizeScale.value = Number(sizeControl.value);
});

intensityControl.addEventListener('input', () => {
  if (material) material.uniforms.uIntensity.value = Number(intensityControl.value);
});

layerToggles.forEach((toggle) => {
  toggle.addEventListener('change', () => {
    activeLayers = new Set(layerToggles.filter((item) => item.checked).map((item) => item.dataset.layer));
    updateLayerVisibility();
  });
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const query = searchInput.value.trim().toLowerCase();
  if (!query || !points || metadata.length === 0) return;
  
  const index = metadata.findIndex(item => item.name.toLowerCase().includes(query));
  if (index === -1) {
    statusText.textContent = `No match found for "${query}"`;
    return;
  }
  
  const item = metadata[index];
  const attr = points.geometry.getAttribute('position');
  flyTargetLookAt.set(attr.getX(index), attr.getY(index), attr.getZ(index));
  
  const radiusSolar = item.details.radiusSolar || 1.0;
  const targetDistance = 3.2 * radiusSolar;
  const offset = flyTargetLookAt.clone().normalize().multiplyScalar(targetDistance);
  if (flyTargetLookAt.length() < 1) offset.set(0, 0, targetDistance);
  
  flyTargetPos.copy(flyTargetLookAt).add(offset);
  isFlying = true;
  lastInteractionTime = performance.now();
  
  tooltip.innerHTML = `<strong>${item.name}</strong><br>${tooltipHtml(item)}`;
  tooltip.classList.add('visible');
  statusText.textContent = `Flying to ${item.name}...`;
});

resetView.addEventListener('click', () => {
  camera.position.set(0, 72, 150);
  controls.target.set(0, 0, 0);
});

refreshData.addEventListener('click', () => {
  loadCatalogs(true).catch((error) => {
    statusText.textContent = error.message;
  });
});

loadCatalogs().catch((error) => {
  statusText.textContent = error.message;
});
animate();
