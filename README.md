# Scientific Universe Map - Interactive 3D WebGL Atlas

**An entry for the Instructables Maps Contest!**

Welcome to the **Scientific Universe Map**! This project is a browser-run, interactive 3D atlas of the universe. Instead of creating fictional space scenes, this project visualizes **real scientific data** pulled from live astronomy APIs, giving you a mathematically accurate representation of nearby stars, exoplanet systems, and distant galaxies. 

Whether you're exploring the neighborhood of the Milky Way or gazing at quasars at the edge of the observable universe, this map puts real observational data right into your web browser using modern WebGL (Three.js) and Vite.

*(**GitHub Link Placeholder:** [Insert GitHub Repository Link Here] - Make sure to check out the full source code and give it a star!)*

---

## Why a Universe Map?

Maps are traditionally 2D representations of a planet's surface. But as our ability to observe the universe expands, our maps must scale into the third dimension. This project takes on the ultimate mapping challenge: charting the cosmos. 

The beauty of this project lies in its **scientific accuracy**. The renderer does not invent any stars, planets, or galaxies. Everything you see—every point of light—is drawn from real-world astronomical catalogs. It is an educational tool, a coding challenge, and a map of everything we know.

---

## Step 1: The Tech Stack & Tools

To build a universe in a browser, we need the right tools:

- **Three.js:** A powerful 3D WebGL library for JavaScript, used to render the immersive 3D cosmos.
- **Vite:** A blazing fast frontend build tool to bundle and serve our map.
- **Node.js:** Used for the local proxy server to handle API caching and avoid CORS issues.
- **Real Astronomical APIs (TAP):** The data backbone (more on this in Step 2).

---

## Step 2: Gathering the Scientific Data

A map is only as good as its data. We don't hardcode coordinates; instead, our local server proxies data from these live astrophysics databases:

1. **ESA Gaia DR3 (via Gaia TAP):** We query nearby, bright stars that have a reliable, positive parallax (distance measurement).
2. **NASA Exoplanet Archive (via TAP):** We map confirmed exoplanet host systems using their `pscomppars` table.
3. **NASA/IPAC Extragalactic Database (NED) (via TAP):** We plot galaxies and quasars with redshift data to show the large-scale structure of the universe.

**The Magic of Caching:** Querying these massive databases can be slow. Our Node.js local server intelligently proxies these APIs through `/api/catalogs`, bypassing browser CORS limitations and caching the data in a `.cache/` folder for 24 hours.

---

## Step 3: The Math - Turning Data into 3D Space

Plotting coordinates on a sphere is one thing, but mapping the universe requires some heavy lifting. To create an accurate and beautiful 3D representation, this project relies on a variety of mathematical transformations.

### 1. Distance Calculations
Different catalogs provide distance in different formats. We unify them into Light Years (ly) before rendering:
- **Stars (Gaia):** Distance is calculated using parallax. `Distance (parsecs) = 1000 / parallax (mas)`. We then multiply by 3.26156 to get Light Years.
- **Galaxies (NED):** Extragalactic objects only provide a *redshift* (z). To find their true distance, the server performs a numerical integration of the **Flat Lambda-CDM Cosmological Model** (using Ω_M = 0.315, Ω_Λ = 0.685, and H0 = 67.4). This converts redshift into a comoving distance in Megaparsecs (Mpc), which is then translated to Light Years.

### 2. Spherical to Cartesian Coordinates
Astronomical coordinates are provided in Right Ascension (RA) and Declination (Dec) degrees. To place them in our 3D WebGL scene, we convert them from spherical to Cartesian (X, Y, Z) coordinates using trigonometry:
```javascript
const raRad = RA * (Math.PI / 180);
const decRad = Dec * (Math.PI / 180);
const x = distance * Math.cos(decRad) * Math.cos(raRad);
const y = distance * Math.sin(decRad);
const z = distance * Math.cos(decRad) * Math.sin(raRad);
```

### 3. Logarithmic Distance Compression
The universe is unimaginably vast. Our closest star is ~4 ly away, but quasars are billions of light-years distant. A linear scale would mean distant galaxies disappear into the void while local stars overlap. 

To make the map visually navigable, we **logarithmically compress** the spatial scale against the farthest loaded object:
`Compressed Distance = log10(True Distance + 1) / log10(Max Distance + 1) * Scene Radius`
This adjustment keeps everything fitting nicely within the WebGL scene limits. The true underlying distances are preserved and displayed accurately in the UI tooltips!

### 4. Star Temperatures and Blackbody Colors
Not all data catalogs provide a neat color value for stars. When Gaia only provides a `bp_rp` photometric color index, the server estimates the star's effective temperature (Teff) using a polynomial approximation. We then calculate a procedural RGB hex color by treating the star as an ideal **Blackbody Radiator**, smoothly shifting from deep red (cool) to bright blue (hot) depending on the true heat of the star!

---

## Step 4: Running the Map Locally

Want to explore the map yourself or modify the code? It's incredibly easy to run.

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation & Execution
1. Clone the repository (from the [GitHub Link Placeholder]).
2. Open your terminal in the project directory.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:5173` to start exploring!

*For a production-style local run:*
```bash
npm run build
npm start
```

---

## Step 5: Future Plans & Roadmap

A map of the universe is never truly finished. Here are some exciting features planned for future updates:

- **Planetary Orbits:** Adding miniature orbital mechanics for confirmed exoplanetary systems.
- **Constellation Lines:** Drawing the classical Earth-perspective constellation lines and seeing how they distort as you travel away from our solar system.
- **Search & Navigation HUD:** A UI to type in specific catalog names (like *Kepler-186f* or *Andromeda*) and smoothly fly the camera to their exact coordinates.
- **Time/Proper Motion Simulation:** Using Gaia's proper motion data to fast-forward millions of years and see how the stars slowly drift across the map!

---

## Instructables Maps Contest

This project was built and documented with the **Instructables Maps Contest** in mind! It pushes the boundary of what a "map" can be—transitioning from earthly topography to galactic cartography. I hope this project inspires you to build your own data-driven visualizations and to never stop exploring.

**If you enjoyed this project, please consider voting for it in the Maps Contest!**
