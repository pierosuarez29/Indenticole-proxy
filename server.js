// server.js (CommonJS con node-fetch v2)
require('dotenv').config(); // si aún no lo tienes
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const IDENTI_BASE = 'https://identicole.minedu.gob.pe';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------- helper para extraer y simplificar colegios ----------
function parseColegios(raw) {
  try {
    const parts = raw.split('||');

    let total = 0;
    for (const p of parts) {
      const t = p.trim();
      if (/^\d+$/.test(t)) {
        total = Number(t);
        break;
      }
    }

    let jsonPart =
      parts
        .map((p) => p.trim())
        .find((t) => t.startsWith('[') && t.includes('"cod_mod"'));

    // 🔁 Plan B: buscar a mano el array [ { ... } ]
    if (!jsonPart) {
      const start = raw.indexOf('[{');
      const end = raw.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        jsonPart = raw.slice(start, end + 1);
      }
    }

    if (!jsonPart) {
      console.warn('No se encontró JSON en la respuesta de colegios');
      // console.log('Respuesta cruda:', raw.slice(0, 400)); // si quieres debug
      return { total: 0, resultados: [] };
    }

    const arr = JSON.parse(jsonPart);

    const resultados = arr.map((s) => ({
      codModular: s.cod_mod,
      nombre: s.cen_edu,
      direccion: s.dir_cen,
      gestion: s.d_gestion,
      pension: s.pension,
      estudiantesPorAula: s.estudiantes_x_aula,
      nivel: s.d_nivel,
      modalidad: s.d_modalidad,
      turno: s.d_turno,
      alumnado: s.d_alumnado,
      departamento: s.d_region,
      provincia: s.d_prov,
      distrito: s.d_dist,
      lat: s.nlat_ie,
      lng: s.nlong_ie,
    }));

    return { total, resultados };
  } catch (e) {
    console.error('Error parseando colegios:', e);
    return { total: 0, resultados: [] };
  }
}



// =============== NIVELES ==================
app.post('/BuscaNivel', async (req, res) => {
  try {
    const modalidad = req.query.modalidad;

    if (!modalidad) {
      return res.status(400).json({ error: 'Falta parámetro modalidad' });
    }

    const targetUrl =
      IDENTI_BASE + '/BuscaNivel?modalidad=' + encodeURIComponent(modalidad);

    console.log('→ Proxy:', 'POST', targetUrl);

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Referer: IDENTI_BASE + '/',
        Origin: IDENTI_BASE,
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error('Error en proxy (niveles):', err);
    res
      .status(500)
      .json({ error: 'Error en el proxy de niveles', detail: err.message });
  }
});

// =============== PROVINCIAS / DISTRITOS ==================
app.use('/api', async (req, res) => {
  try {
    const targetUrl = IDENTI_BASE + '/api' + req.url;

    console.log('→ Proxy:', req.method, targetUrl);

    const isBodyMethod = req.method !== 'GET' && req.method !== 'HEAD';

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Referer: IDENTI_BASE + '/',
        Origin: IDENTI_BASE,
        Accept: 'application/json, text/plain, */*',
      },
      body: isBodyMethod ? JSON.stringify(req.body || {}) : undefined,
    });

    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error('Error en proxy /api:', err);
    res.status(500).json({ error: 'Error en el proxy', detail: err.message });
  }
});

// =============== COLEGIOS ==================
// =============== COLEGIOS ==================
app.post('/colegios', async (req, res) => {
  try {
    const {
      coddpto,
      codprov,
      coddist,
      modalidad,
      nivel,
      page = 0,        // 0 = primera página
      pageSize = 12,   // Identicole usa 12 por página
      texto = '',      // nombre colegio (txt_cen_edu)
      lat,
      lng,
      ubicacionTexto,  // "TRUJILLO, TRUJILLO, LA LIBERTAD, Perú"
    } = req.body;

    const offset = page * pageSize;
    const basePath = '/colegio/busqueda_colegios_detalle';
    const identiUrl =
      offset > 0
        ? `${IDENTI_BASE}${basePath}/${offset}`  // /12, /24, /36...
        : `${IDENTI_BASE}${basePath}`;           // primera página

    // 1️⃣ Determinar lat / lng finales
    let latFinal = lat != null ? String(lat) : null;
    let lngFinal = lng != null ? String(lng) : null;

    // Si no vienen pero tenemos un texto de ubicación → geocodificamos
    if ((!latFinal || !lngFinal) && ubicacionTexto) {
      try {
        const coords = await geocodeUbicacion(ubicacionTexto);
        if (coords) {
          latFinal = String(coords.lat);
          lngFinal = String(coords.lng);
        }
      } catch (e) {
        console.warn('Fallo geocoding maps.co, usando fallback:', e.message);
      }
    }

    // Fallback por si todo falla (puedes poner Lima o lo que quieras)
    if (!latFinal || !lngFinal) {
      latFinal = '-12.0464'; // Lima centro
      lngFinal = '-77.0428';
    }

    // 2️⃣ Enviar como formulario, igual que Identicole
    const form = new URLSearchParams();

    form.append('lat', latFinal);
    form.append('lng', lngFinal);
    form.append('accion', 'ubicacion');

    form.append('s_departament_geo', coddpto);
    form.append('s_province_geo', codprov);
    form.append('s_district_geo', coddist);

    form.append('txt_cen_edu', texto || '');
    form.append('modalidad', modalidad || '');
    form.append('s_nivel', nivel || '');

    form.append('vacante', '3');    // todos
    form.append('participa', '3');  // todos
    form.append('dot-amount', '2'); // ~2km de radio
    form.append('genero', '');

    console.log(
      '→ Proxy: POST',
      identiUrl,
      Object.fromEntries(form.entries())
    );

    const identiResp = await fetch(identiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Referer: IDENTI_BASE + '/',
        Origin: IDENTI_BASE,
        Accept: 'text/html,application/json, text/plain, */*',
      },
      body: form.toString(),
    });

    const text = await identiResp.text();

    if (!identiResp.ok) {
      console.error('Error Identicole:', identiResp.status, text.slice(0, 300));
      return res.status(identiResp.status).send(text);
    }

    const { total, resultados } = parseColegios(text);

    return res.json({
      total,
      page,
      pageSize: resultados.length, // por si la última página trae menos
      resultados,
    });
  } catch (err) {
    console.error('Error en proxy colegios:', err);
    res.status(500).json({
      message: 'Error en proxy de colegios',
      detail: err.message,
    });
  }
});

// =============== GEOCODIFICACIÓN (Google Maps) ==================

const GEOCODE_MAPS_KEY = process.env.GEOCODE_MAPS_KEY;

// 🔍 Geocodificar texto de ubicación usando geocode.maps.co
async function geocodeUbicacion(textoUbicacion) {
  if (!GEOCODE_MAPS_KEY || !textoUbicacion) {
    console.warn('Sin GEOCODE_MAPS_KEY o textoUbicacion vacío');
    return null;
  }

  const params = new URLSearchParams({
    q: textoUbicacion,
    api_key: GEOCODE_MAPS_KEY,
  });

  const url = `https://geocode.maps.co/search?${params.toString()}`;
  console.log('→ Geocode maps.co:', url);

  const resp = await fetch(url);
  if (!resp.ok) {
    console.error('Error geocoding maps.co:', resp.status);
    return null;
  }

  const data = await resp.json();
  if (!Array.isArray(data) || !data.length) {
    console.warn('Geocode sin resultados para:', textoUbicacion);
    return null;
  }

  const { lat, lon } = data[0];
  return {
    lat: parseFloat(lat),
    lng: parseFloat(lon),
  };
}



app.listen(PORT, () => {
  console.log(`✅ Proxy Identicole corriendo en http://localhost:${PORT}`);
});
