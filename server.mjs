import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 5173);
const cacheDir = join(__dirname, '.cache');
const cacheTtlMs = Number(process.env.CATALOG_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

const sources = [
  {
    id: 'gaia',
    name: 'Gaia DR3',
    url: 'https://gea.esac.esa.int/archive/',
    description: 'Nearby bright stars with positive parallax and high parallax signal-to-noise.',
  },
  {
    id: 'exoplanets',
    name: 'NASA Exoplanet Archive',
    url: 'https://exoplanetarchive.ipac.caltech.edu/',
    description: 'Confirmed exoplanet host systems from PSCompPars.',
  },
  {
    id: 'ned',
    name: 'NASA/IPAC Extragalactic Database',
    url: 'https://ned.ipac.caltech.edu/',
    description: 'Galaxies and quasars with redshift from the NED Object Directory.',
  },
];

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function tapUrl(baseUrl, query, format = 'json') {
  const params = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: format,
    QUERY: query,
  });
  return `${baseUrl}?${params.toString()}`;
}

function exoplanetTapUrl(query) {
  const params = new URLSearchParams({
    query,
    format: 'json',
  });
  return `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?${params.toString()}`;
}

async function fetchCached(key, url) {
  await mkdir(cacheDir, { recursive: true });
  const cacheName = `${key}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.json`;
  const cachePath = join(cacheDir, cacheName);

  try {
    const info = await stat(cachePath);
    if (Date.now() - info.mtimeMs < cacheTtlMs) {
      return JSON.parse(await readFile(cachePath, 'utf8'));
    }
  } catch {
    // Cache miss.
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'universe-map-browser/1.0 (+local educational visualization)',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const json = JSON.parse(text);
  await writeFile(cachePath, JSON.stringify(json));
  return json;
}

function tableRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload?.metadata || !payload?.data) return [];
  const columns = payload.metadata.map((column) => column.name);
  return payload.data.map((row) => Object.fromEntries(row.map((value, index) => [columns[index], value])));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function redshiftToComovingMpc(z) {
  const omegaM = 0.315;
  const omegaLambda = 0.685;
  const cKmS = 299792.458;
  const h0 = 67.4;
  const steps = 96;
  let sum = 0;

  for (let i = 0; i <= steps; i += 1) {
    const zi = (z * i) / steps;
    const ez = Math.sqrt(omegaM * Math.pow(1 + zi, 3) + omegaLambda);
    const weight = i === 0 || i === steps ? 1 : i % 2 === 0 ? 2 : 4;
    sum += weight / ez;
  }

  return (cKmS / h0) * (z / (3 * steps)) * sum;
}

function bpRpToTeff(bpRp) {
  if (bpRp === null || bpRp === undefined || !Number.isFinite(bpRp)) return null;
  const x = Math.max(-0.5, Math.min(3.0, bpRp));
  const theta = 0.524 + 0.655 * x - 0.155 * Math.pow(x, 2) + 0.038 * Math.pow(x, 3);
  return 5040 / theta;
}

function blackbodyColor(teff) {
  if (!Number.isFinite(teff) || teff <= 0) return '#fff4d0';
  const temp = Math.max(1000, Math.min(40000, teff)) / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
  } else {
    r = temp - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
  }

  if (temp <= 66) {
    g = temp;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  } else {
    g = temp - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }

  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = temp - 10;
    b = 138.5177312231 * Math.log(b) - 305.0447927307;
  }

  const clamp = (val) => Math.max(0, Math.min(255, Math.round(val)));
  const hex = (val) => clamp(val).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function gaiaColor(bpRp, teff) {
  let finalTeff = teff;
  if (!Number.isFinite(finalTeff) && Number.isFinite(bpRp)) {
    finalTeff = bpRpToTeff(bpRp);
  }
  return blackbodyColor(finalTeff);
}

async function fetchGaia(limit) {
  const query = `
    SELECT TOP ${limit}
      source_id, ra, dec, parallax, phot_g_mean_mag, bp_rp, teff_gspphot, radius_val
    FROM gaiadr3.gaia_source
    WHERE parallax > 5
      AND parallax_over_error > 10
      AND phot_g_mean_mag IS NOT NULL
      AND ra IS NOT NULL
      AND dec IS NOT NULL
    ORDER BY phot_g_mean_mag ASC
  `;
  const url = tapUrl('https://gea.esac.esa.int/tap-server/tap/sync', query);
  const rows = tableRows(await fetchCached('gaia', url));

  return rows.map((row) => {
    const parallax = numberOrNull(row.parallax);
    const distancePc = parallax ? 1000 / parallax : null;
    const teffValue = numberOrNull(row.teff_gspphot);
    let teff = teffValue && teffValue > 0 ? teffValue : null;
    let teffEstimated = false;
    const bpRp = numberOrNull(row.bp_rp);
    if (teff === null && bpRp !== null) {
      teff = bpRpToTeff(bpRp);
      teffEstimated = true;
    }
    return {
      catalog: 'gaia',
      name: `Gaia DR3 ${row.source_id}`,
      objectType: 'Star',
      ra: numberOrNull(row.ra),
      dec: numberOrNull(row.dec),
      distanceLy: distancePc ? distancePc * 3.26156 : null,
      magnitude: numberOrNull(row.phot_g_mean_mag),
      color: gaiaColor(bpRp, teff),
      details: {
        sourceId: String(row.source_id),
        parallaxMas: parallax,
        bpRp,
        teffK: teff,
        teffEstimated: teff !== null ? teffEstimated : null,
        radiusSolar: numberOrNull(row.radius_val),
      },
    };
  }).filter((item) => item.ra !== null && item.dec !== null && item.distanceLy !== null);
}

async function fetchExoplanets(limit) {
  const query = `
    SELECT TOP ${limit}
      pl_name, hostname, ra, dec, sy_dist, sy_vmag, st_teff, st_spectype, st_rad, disc_year
    FROM pscomppars
    WHERE sy_dist IS NOT NULL
      AND ra IS NOT NULL
      AND dec IS NOT NULL
    ORDER BY sy_dist ASC
  `;
  const rows = tableRows(await fetchCached('exoplanets', exoplanetTapUrl(query)));
  const hosts = new Map();

  for (const row of rows) {
    const host = row.hostname || row.pl_name;
    if (!hosts.has(host)) {
      const distancePc = numberOrNull(row.sy_dist);
      const teffValue = numberOrNull(row.st_teff);
      hosts.set(host, {
        catalog: 'exoplanets',
        name: host,
        objectType: 'Exoplanet host system',
        ra: numberOrNull(row.ra),
        dec: numberOrNull(row.dec),
        distanceLy: distancePc ? distancePc * 3.26156 : null,
        magnitude: numberOrNull(row.sy_vmag),
        color: gaiaColor(null, teffValue && teffValue > 0 ? teffValue : null),
        details: {
          planets: [],
          spectralType: row.st_spectype || null,
          teffK: teffValue && teffValue > 0 ? teffValue : null,
          radiusSolar: numberOrNull(row.st_rad),
        },
      });
    }

    const record = hosts.get(host);
    record.details.planets.push({
      name: row.pl_name,
      discoveryYear: numberOrNull(row.disc_year),
    });
  }

  return [...hosts.values()].filter((item) => item.ra !== null && item.dec !== null && item.distanceLy !== null);
}

async function fetchNed(limit) {
  const query = `
    SELECT TOP ${limit}
      prefname, ra, dec, z, zflag, pretype
    FROM objdir
    WHERE z IS NOT NULL
      AND z > 0.0005
      AND z < 0.08
      AND ra IS NOT NULL
      AND dec IS NOT NULL
      AND pretype IN ('G', 'QSO')
    ORDER BY z
  `;
  const url = `${tapUrl('https://ned.ipac.caltech.edu/tap/sync', query)}&MAXREC=${limit}`;
  const rows = tableRows(await fetchCached('ned', url));

  return rows.map((row) => {
    const z = numberOrNull(row.z);
    const distanceMpc = z ? redshiftToComovingMpc(z) : null;
    const rawPretype = row.pretype ? String(row.pretype).trim() : '';
    const zflag = row.zflag ? String(row.zflag).trim() : null;
    return {
      catalog: 'ned',
      name: String(row.prefname || '').trim() || 'NED object',
      objectType: rawPretype === 'QSO' ? 'Quasar' : 'Galaxy',
      ra: numberOrNull(row.ra),
      dec: numberOrNull(row.dec),
      distanceLy: distanceMpc ? distanceMpc * 3.26156e6 : null,
      magnitude: null,
      color: rawPretype === 'QSO' ? '#b99cff' : '#78e0c2',
      details: {
        redshift: z,
        redshiftFlag: zflag,
        distanceMpc,
      },
    };
  }).filter((item) => item.ra !== null && item.dec !== null && item.distanceLy !== null);
}

async function catalogPayload(url) {
  const params = url.searchParams;
  const gaiaLimit = clampInt(params.get('gaia'), 8000, 100, 20000);
  const exoplanetLimit = clampInt(params.get('exoplanets'), 6000, 100, 15000);
  const nedLimit = clampInt(params.get('ned'), 2500, 100, 10000);

  const jobs = await Promise.allSettled([
    fetchGaia(gaiaLimit),
    fetchExoplanets(exoplanetLimit),
    fetchNed(nedLimit),
  ]);

  const errors = [];
  const items = [];

  for (const [index, job] of jobs.entries()) {
    if (job.status === 'fulfilled') items.push(...job.value);
    else errors.push({ source: sources[index].id, message: job.reason.message });
  }

  return {
    generatedAt: new Date().toISOString(),
    sources,
    counts: items.reduce((acc, item) => {
      acc[item.catalog] = (acc[item.catalog] || 0) + 1;
      return acc;
    }, {}),
    errors,
    items,
  };
}

async function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function serveStatic(request, response) {
  const publicPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const filePath = publicPath === '/'
    ? join(__dirname, 'dist', 'index.html')
    : resolve(join(__dirname, 'dist', publicPath));
  const distRoot = resolve(join(__dirname, 'dist'));
  const safePath = filePath.startsWith(distRoot) ? filePath : join(distRoot, 'index.html');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
  }[extname(safePath)] || 'application/octet-stream';

  try {
    response.writeHead(200, { 'content-type': mime });
    createReadStream(safePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

async function createHandler(vite) {
  return async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/api/catalogs') {
      try {
        await sendJson(response, 200, await catalogPayload(url));
      } catch (error) {
        await sendJson(response, 500, { error: error.message });
      }
      return;
    }

    if (vite) {
      vite.middlewares(request, response);
      return;
    }

    await serveStatic(request, response);
  };
}

let vite = null;
if (isDev) {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
}

const server = createHttpServer(await createHandler(vite));
server.listen(port, () => {
  console.log(`Universe map running at http://localhost:${port}`);
});
