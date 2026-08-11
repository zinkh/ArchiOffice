// Phase 7 extraction — moved out of the unmarked block of server.ts between
// the "CardDAV sync" and "Activity Feed" sections. Every route here is a
// stateless proxy onto a French government geo API (IGN, data.gouv.fr,
// Géoportail de l'Urbanisme, data.culture.gouv.fr) or Open-Meteo — none of
// them touch supabaseAdmin or a tenant, so unlike every other extracted
// module this one takes no deps object at all.
//
// Five more routes (rnb-buildings, georisques, urbanisme, bdnb-geocode,
// bdnb) joined in a later lot — module-level proxies of the exact same
// shape, left off this module's original extraction and every bilan since
// by oversight, not deliberate scoping (same class of gap as the
// "suivi de chantier" cluster). getPlu (used only by /api/urbanisme) and
// its GPU-response interfaces moved here with it since nothing else in
// server.ts referenced them.
import type { Express } from 'express';
import axios from 'axios';
import { fetchWithTimeout } from '../fetchWithTimeout';

interface GeoJSONGeometry {
  type: string;
  coordinates: any;
}

interface ZoneUrbaProperties {
  gid: number;
  partition: string;
  libelle: string;
  libelong: string;
  typezone: string;
  destdomi: string | null;
  nomfic: string;
  urlfic: string | null;
  insee: string;
  datappro: string;
  datvalid: string;
  idurba: string;
}

interface DocumentProperties {
  libelle: string;
  typedoc: string;
}

interface ApicartoPluResponse<T> {
  type: string;
  features: Array<{
    type: string;
    geometry: GeoJSONGeometry;
    properties: T;
  }>;
}

interface PluResult {
  libelle: string;
  libelong: string;
  typezone: string;
  destdomi: string | null;
  urlfic: string | null;
  datappro: string | null;
  insee: string;
  partition: string;
  document: {
    nom: string | null;
    typedoc: string | null;
  } | null;
}

/**
 * Fetch PLU data from APICARTO IGN GPU API
 */
async function getPlu(geometry: GeoJSONGeometry): Promise<PluResult> {
  try {
    const zoneUrbaUrl = "https://apicarto.ign.fr/api/gpu/zone-urba";
    console.log(`[GPU] Calling zone-urba API with geometry: ${JSON.stringify(geometry)}`);

    const response = await axios.get<ApicartoPluResponse<ZoneUrbaProperties>>(zoneUrbaUrl, {
      params: { geom: JSON.stringify(geometry) },
      timeout: 10000
    });

    if (!response.data.features || response.data.features.length === 0) {
      const error: any = new Error("Aucune zone PLU trouvée pour cette adresse");
      error.status = 404;
      throw error;
    }

    const props = response.data.features[0].properties;

    // Convert AAAAMMJJ to ISO string
    let datapproIso: string | null = null;
    if (props.datappro && props.datappro.length === 8) {
      const year = props.datappro.substring(0, 4);
      const month = props.datappro.substring(4, 6);
      const day = props.datappro.substring(6, 8);
      datapproIso = new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString();
    }

    const result: PluResult = {
      libelle: props.libelle,
      libelong: props.libelong,
      typezone: props.typezone,
      destdomi: props.destdomi,
      urlfic: props.urlfic,
      datappro: datapproIso,
      insee: props.insee,
      partition: props.partition,
      document: null
    };

    // Optional second call for document info (non-blocking)
    try {
      const docUrl = "https://apicarto.ign.fr/api/gpu/document";
      const docResponse = await axios.get<ApicartoPluResponse<DocumentProperties>>(docUrl, {
        params: { geom: JSON.stringify(geometry) },
        timeout: 5000
      });

      if (docResponse.data.features && docResponse.data.features.length > 0) {
        const docProps = docResponse.data.features[0].properties;
        result.document = {
          nom: docProps.libelle,
          typedoc: docProps.typedoc
        };
      }
    } catch (docErr: any) {
      console.warn("[GPU] Optional document lookup failed:", docErr.message);
    }

    return result;
  } catch (error: any) {
    if (error.status === 404) throw error;
    console.error("[GPU] getPlu Error:", error.message);
    const apiError: any = new Error("Service Urbanisme (GPU) temporairement indisponible");
    apiError.status = 503;
    throw apiError;
  }
}

// Georisques API Interfaces
interface RisqueEntry {
  present: boolean;
  libelle: string;
}

interface GeorisquesV1Response {
  risquesNaturels: Record<string, RisqueEntry>;
  risquesTechnologiques: Record<string, RisqueEntry>;
  url: string;
}

interface GeorisquesResult {
  url: string;
  risques_naturels: string[];
  risques_technologiques: string[];
}

async function getGeorisques(lon: number, lat: number, codeInsee: string): Promise<GeorisquesResult> {
  const v1Url = `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lon},${lat}`;
  console.log(`Attempting Georisques API v1: ${v1Url}`);

  try {
    const v1Response = await axios.get<GeorisquesV1Response>(v1Url, {
      timeout: 15000 // Increased timeout
    });

    if (v1Response.data) {
      const data = v1Response.data;
      const risques_naturels = Object.values(data.risquesNaturels || {})
        .filter(r => r.present)
        .map(r => r.libelle);

      const risques_technologiques = Object.values(data.risquesTechnologiques || {})
        .filter(r => r.present)
        .map(r => r.libelle);

      return {
        url: data.url || `https://www.georisques.gouv.fr/mes-risques/rapport?latlon=${lon},${lat}`,
        risques_naturels,
        risques_technologiques
      };
    }
  } catch (v1Error: any) {
    console.error("Georisques API v1 failed, attempting v2 fallback:", v1Error.message);
  }

  // Fallback to API v2
  const v2Url = `https://www.georisques.gouv.fr/api/v2/indicateurs`; // Changed from /risques to /indicateurs which is more common for v2
  const token = process.env.GEORISQUES_TOKEN;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    console.log(`Attempting Georisques API v2: ${v2Url} for lat=${lat}, lon=${lon}`);
    const v2Response = await axios.get<any>(v2Url, {
      params: {
        lat: lat,
        lng: lon,
      },
      headers,
      timeout: 8000
    });

    if (v2Response.data) {
      // Map v2 response
      const risks = v2Response.data.indicateurs || [];
      const risksList = risks.map((r: any) => r.libelle || r.nom);

      return {
        url: `https://www.georisques.gouv.fr/mes-risques/rapport?latlon=${lon},${lat}`,
        risques_naturels: risksList,
        risques_technologiques: []
      };
    }
  } catch (v2Error: any) {
    console.error("Georisques API v2 also failed:", v2Error.message);
  }

  throw new Error("Georisques API unavailable (v1 and v2 failed)");
}

function formatWeatherData(data: any) {
  if (!data.daily || !data.daily.weather_code || data.daily.weather_code.length === 0) {
    return { meteo: "Inconnu", temperature: null };
  }

  const code = data.daily.weather_code[0];
  const temp = data.daily.temperature_2m_max[0];

  const weatherMap: Record<number, string> = {
    0: "Ciel dégagé",
    1: "Principalement dégagé",
    2: "Partiellement nuageux",
    3: "Couvert",
    45: "Brouillard",
    48: "Brouillard givrant",
    51: "Bruine légère",
    53: "Bruine modérée",
    55: "Bruine dense",
    61: "Pluie faible",
    63: "Pluie modérée",
    65: "Pluie forte",
    71: "Neige faible",
    73: "Neige modérée",
    75: "Neige forte",
    80: "Averses de pluie faibles",
    81: "Averses de pluie modérées",
    82: "Averses de pluie violentes",
    95: "Orage",
  };

  return {
    meteo: weatherMap[code] || "Variable",
    temperature: temp
  };
}

export function registerGeoProxyRoutes(app: Express) {
  app.get("/api/address-search", async (req, res) => {
    try {
      const { q, banId } = req.query;

      if (!q && !banId) {
        return res.status(400).json({ error: "Query parameter 'q' or 'banId' is required" });
      }

      let data: any;

      // If we have a banId, try to get the specific address details first
      if (banId) {
        console.log(`Searching for address by banId: ${banId}`);
        // Try BDNB first for consistency
        const bdnbUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banId}&select=cle_interop_adr,libelle_adr,code_commune_insee,code_postal,nom_commune`;
        try {
          const bdnbRes = await fetchWithTimeout(bdnbUrl, { headers: { 'Accept': 'application/json' } }, 5000);
          if (bdnbRes.ok) {
            const bdnbData = await bdnbRes.json();
            if (Array.isArray(bdnbData) && bdnbData.length > 0) {
              data = bdnbData;
            }
          }
        } catch (e) {
          console.warn("BDNB lookup by banId failed, falling back to standard geocoder");
        }
      }

      // If no data yet and we have a query string
      if (!data && q) {
        // Try Géoplateforme API FIRST (New official IGN API)
        let url = `https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(q as string)}&limit=5`;
        console.log(`Fetching addresses from Géoplateforme for query: ${q}`);

        try {
          let response = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' }
          }, 5000);

          if (response.ok) {
            const geoData = await response.json();
            if (geoData.features && geoData.features.length > 0) {
              data = geoData.features.map((f: any) => ({
                cle_interop_adr: f.properties.id,
                libelle_adr: f.properties.label,
                code_commune_insee: f.properties.citycode,
                code_postal: f.properties.postcode,
                nom_commune: f.properties.city,
                score: f.properties.score,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
              }));
            }
          }
        } catch (e) {
          console.warn("Géoplateforme API failed, trying BAN fallback");
        }

        // Fallback to api-adresse.data.gouv.fr if Géoplateforme returned nothing
        if (!data || (Array.isArray(data) && data.length === 0)) {
          url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q as string)}&limit=5`;
          console.log(`Géoplateforme returned no results, trying BAN for query: ${q}`);

          try {
            let response = await fetchWithTimeout(url, {
              headers: { 'Accept': 'application/json' }
            }, 5000);

            if (response.ok) {
              const banData = await response.json();
              if (banData.features && banData.features.length > 0) {
                data = banData.features.map((f: any) => ({
                  cle_interop_adr: f.properties.id,
                  libelle_adr: f.properties.label,
                  code_commune_insee: f.properties.citycode,
                  code_postal: f.properties.postcode,
                  nom_commune: f.properties.city,
                  score: f.properties.score,
                  lat: f.geometry.coordinates[1],
                  lon: f.geometry.coordinates[0]
                }));
              }
            }
          } catch (e) {
            console.warn("BAN API also failed, trying BDNB fallback");
          }
        }

        // Final fallback to BDNB geocoder
        if (!data || (Array.isArray(data) && data.length === 0)) {
          url = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=5`;
          console.log(`BAN returned no results, trying BDNB for query: ${q}`);

          try {
            let response = await fetchWithTimeout(url, {
              headers: { 'Accept': 'application/json' }
            }, 15000);

            if (response.ok) {
              const text = await response.text();
              data = JSON.parse(text);
            }
          } catch (e) {
            console.warn("BDNB geocoder also failed");
          }
        }
      }

      const results = Array.isArray(data) ? data : [];
      if (!Array.isArray(data)) {
        console.warn(`Geocoder returned non-array data: ${JSON.stringify(data).substring(0, 200)}`);
      }

      const features = results.map((item: any) => ({
        properties: {
          label: item.libelle_adr || item.nom_commune || "Unknown address",
          score: item.score || 0,
          id: item.cle_interop_adr || "",
          name: item.libelle_adr || "",
          postcode: item.code_postal || "",
          citycode: item.code_commune_insee || "",
          city: item.nom_commune || "",
          context: `${item.code_postal || ""} ${item.nom_commune || ""}`,
          importance: item.score || 0
        },
        geometry: {
          type: "Point",
          coordinates: [item.lon || 0, item.lat || 0]
        }
      }));

      res.json({ features });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("BDNB Geocodage request timed out");
        return res.status(504).json({ error: "BDNB Geocodage request timed out" });
      }
      console.error("Error in /api/address-search:", error);
      res.status(500).json({ error: "Failed to fetch addresses" });
    }
  });

  app.get("/api/weather", async (req, res) => {
    try {
      const { q, date } = req.query;
      if (!q || !date) {
        return res.status(400).json({ error: "Address and date are required" });
      }

      // 1. Geocode address
      const geocodeUrl = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q as string)}&limit=1`;
      const geoRes = await fetchWithTimeout(geocodeUrl, {}, 5000);
      if (!geoRes.ok) {
        throw new Error("Geocoding failed");
      }
      const geoData = await geoRes.json();
      if (!geoData.features || geoData.features.length === 0) {
        return res.status(404).json({ error: "Address not found" });
      }

      const [lon, lat] = geoData.features[0].geometry.coordinates;

      // 2. Fetch weather from Open-Meteo
      // We use the forecast API which also handles recent history (up to 92 days)
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=auto&start_date=${date}&end_date=${date}`;

      const weatherRes = await fetchWithTimeout(weatherUrl, {}, 5000);
      if (!weatherRes.ok) {
        // If forecast API fails (maybe date is too far in the past), try archive API
        const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=auto&start_date=${date}&end_date=${date}`;
        const archiveRes = await fetchWithTimeout(archiveUrl, {}, 5000);
        if (!archiveRes.ok) {
          throw new Error("Weather API failed");
        }
        const archiveData = await archiveRes.json();
        return res.json(formatWeatherData(archiveData));
      }

      const weatherData = await weatherRes.json();
      res.json(formatWeatherData(weatherData));
    } catch (error: any) {
      console.error("Error in /api/weather:", error);
      res.status(500).json({ error: "Failed to fetch weather data" });
    }
  });

  // Proxy for Urban Planning (GPU) API
  app.get("/api/urban-planning/documents", async (req, res) => {
    try {
      const { insee, grid, partition } = req.query;
      let url = "";

      if (grid) {
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${grid}&status=document.production`;
      } else if (partition) {
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?partition=${partition}&status=document.production`;
      } else if (insee) {
        // Default to grid search if only insee is provided
        url = `https://www.geoportail-urbanisme.gouv.fr/api/document?grid=${insee}&status=document.production`;
      } else {
        return res.status(400).json({ error: "Missing search parameters (insee, grid, or partition)" });
      }

      console.log(`[GPU] Fetching documents: ${url}`);
      const response = await fetchWithTimeout(url, {}, 10000);

      if (!response.ok) {
        return res.status(response.status).json({ error: `GPU API error: ${response.status}` });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text();
        console.error(`[GPU] Non-JSON response: ${text.substring(0, 200)}`);
        res.status(502).json({ error: "Invalid response from GPU API", details: text.substring(0, 200) });
      }
    } catch (error: any) {
      console.error("[GPU] Proxy Error:", error);
      res.status(500).json({ error: "Internal server error during GPU lookup" });
    }
  });

  app.get("/api/urban-planning/details/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const url = `https://www.geoportail-urbanisme.gouv.fr/api/document/${id}/details`;

      console.log(`[GPU] Fetching details for ${id}`);
      const response = await fetchWithTimeout(url, {}, 10000);

      if (!response.ok) {
        return res.status(response.status).json({ error: `GPU Details error: ${response.status}` });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        res.status(502).json({ error: "Invalid response from GPU Details API" });
      }
    } catch (error: any) {
      console.error("[GPU] Details Proxy Error:", error);
      res.status(500).json({ error: "Internal server error during GPU details lookup" });
    }
  });

  // Proxy for Historical Monuments (Culture API)
  app.get("/api/historical-monuments", async (req, res) => {
    try {
      const { lat: latQuery, lon: lonQuery, distance = 1000 } = req.query;
      if (!latQuery || !lonQuery) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const lat = parseFloat(latQuery as string);
      const lon = parseFloat(lonQuery as string);

      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: "Invalid latitude or longitude" });
      }

      const dataset = "liste-des-immeubles-proteges-au-titre-des-monuments-historiques";
      const url = `https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/${dataset}/records`;

      // ÉTAPE 1 : appel sans select ni where géo — juste 1 record pour voir les vrais noms
      console.log(`[Culture] Découverte des champs sur dataset...`);
      const discoveryResponse = await axios.get(url, {
        params: {
          limit: 1,
        },
        timeout: 10000
      });

      if (discoveryResponse.data?.results?.length > 0) {
        const sample = discoveryResponse.data.results[0];
        console.log("[Culture] === VRAIS NOMS DE CHAMPS ===");
        Object.entries(sample).forEach(([k, v]) => {
          console.log(`  "${k}": ${JSON.stringify(v)?.substring(0, 60)}`);
        });
        console.log("[Culture] === FIN CHAMPS ===");
      }

      // ÉTAPE 2 : appel géographique AVEC where explicite
      console.log(`[Culture] Requête géo: lat=${lat}, lon=${lon}, distance=${distance}m`);

      const response = await axios.get(url, {
        params: {
          limit: 10,
          select: `*, distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})') as dist`,
          where: `within_distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})', ${distance}m)`,
          order_by: `distance(coordonnees_au_format_wgs84, geom'POINT(${lon} ${lat})')`
        },
        timeout: 15000
      });

      const v2Data = response.data;

      if (!v2Data?.results) {
        return res.json({ records: [] });
      }

      console.log(`[Culture] ${v2Data.results.length} monument(s) trouvé(s)`);
      if (v2Data.results.length > 0) {
        console.log("[Culture] Champs du 1er résultat:", Object.keys(v2Data.results[0]));
      }

      // Mapping défensif : on prend ce qui existe, peu importe le nom exact
      const mappedData = {
        records: v2Data.results.map((r: any) => {
          // Cherche le champ geo — peut s'appeler coordonnees_au_format_wgs84, coordonnees_ban, geolocalisation, etc.
          const geoField = r.coordonnees_au_format_wgs84 ?? r.coordonnees_ban ?? r.geolocalisation ?? r.coordonnees_gps ?? null;

          // Cherche la référence Mérimée
          const refField = r.ref ?? r.reference ?? r.ref_merimee ?? null;

          return {
            recordid: refField || `mh-${Math.random().toString(36).substr(2, 9)}`,
            fields: {
              ref_merimee: refField,
              tico: r.tico ?? r.titre_courant ?? r.denomination_de_l_edifice ?? null,
              comm: r.com ?? r.commune ?? r.commune_forme_index ?? null,
              dpt: r.dpt_lettre ?? r.departement ?? r.dep ?? null,
              stat: r.stat ?? r.statut_juridique_de_l_edifice ?? null,
              prec_lib: r.ppro ?? r.precision_sur_la_protection ?? null,
              dpro: r.dpro ?? r.date_et_typologie_de_la_protection ?? null,
              autr: r.autr ?? r.auteur_de_l_edifice ?? null,
              adrs: r.adrs ?? r.adresse_forme_index ?? null,
              coordonnees_ban: geoField,
              dist: r.dist ?? null,
            }
          };
        })
      };

      res.json(mappedData);

    } catch (error: any) {
      if (error.response) {
        console.error(
          "[Culture] API Error:",
          error.response.status,
          JSON.stringify(error.response.data).substring(0, 400)
        );
        return res.status(error.response.status).json({
          error: `Culture API error: ${error.response.status}`,
          details: error.response.data?.message || error.response.data
        });
      }
      console.error("[Culture] Proxy Error:", error.message);
      res.status(error.code === 'ECONNABORTED' ? 504 : 500).json({
        error: error.code === 'ECONNABORTED' ? "Culture API request timed out" : "Internal server error",
        details: error.message
      });
    }
  });

  app.get("/api/cadastre/parcel", async (req, res) => {
    try {
      const { lon, lat, bbox } = req.query;

      let geom: { type: string; coordinates: any };
      if (bbox) {
        const parts = String(bbox).split(',').map(Number);
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
          return res.status(400).json({ error: "Invalid bbox parameter, expected minLon,minLat,maxLon,maxLat" });
        }
        const [minLon, minLat, maxLon, maxLat] = parts;
        geom = {
          type: 'Polygon',
          coordinates: [[
            [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat],
          ]],
        };
        console.log(`[Cadastre] Lookup request: bbox=${bbox}`);
      } else if (lon && lat) {
        geom = { type: 'Point', coordinates: [Number(lon), Number(lat)] };
        console.log(`[Cadastre] Lookup request: lon=${lon}, lat=${lat}`);
      } else {
        return res.status(400).json({ error: "Missing longitude/latitude or bbox parameters" });
      }

      const apiUrl = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify(geom))}&_limit=1000`;
      console.log(`[Cadastre] Fetching from IGN: ${apiUrl}`);

      const response = await fetchWithTimeout(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      }, 8000); // 8 second timeout

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`[Cadastre] IGN API Error: ${response.status} ${response.statusText}`);
        return res.status(response.status).json({
          error: `IGN API returned ${response.status}: ${response.statusText}`,
          details: errorText
        });
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error(`Cadastre API returned non-JSON: ${text}`);
        return res.status(502).json({ error: "Cadastre API returned invalid response format" });
      }

      const data = await response.json();

      // Map IGN properties to the format expected by the frontend
      const mappedFeatures = (data.features || []).map((f: any) => {
        const p = f.properties;
        let id15 = p.idu;

        // Etalab requires exactly 15 characters for the parcel ID
        // IGN's IDU is often 14 characters (missing a leading zero in the 5-digit numero part)
        if (id15 && id15.length === 14) {
          // Insert the missing zero at the start of the numero part (index 10)
          id15 = id15.substring(0, 10) + '0' + id15.substring(10);
        } else if (!id15 || id15.length < 14) {
          // Fallback reconstruction if IDU is missing or malformed
          const section = (p.section || '').padStart(2, '0');
          const prefixe = (p.code_abs || '000').padStart(3, '0');
          const numero5 = (p.numero || '').padStart(5, '0');
          const commune = (p.code_insee || '').padStart(5, '0');
          id15 = `${commune}${prefixe}${section}${numero5}`;
        }

        // The commune code for the URL should be the one from the parcel ID (idu)
        // This is usually the most reliable for cadastral APIs
        const urlCommune = id15.substring(0, 5);

        console.log(`[Cadastre] Mapping: IGN=${p.idu} -> Etalab=${id15} (URL Commune: ${urlCommune}, INSEE: ${p.code_insee})`);

        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: id15,
            section: id15.substring(8, 10),
            numero: id15.substring(10),
            prefixe: id15.substring(5, 8),
            commune: urlCommune,
            insee: p.code_insee || urlCommune,
            contenance: p.contenance
          }
        };
      });

      console.log(`[Cadastre] Success: Found ${mappedFeatures.length} parcels`);
      res.json({ type: 'FeatureCollection', features: mappedFeatures });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("[Cadastre] Request timed out");
        return res.status(504).json({ error: "Cadastre API request timed out" });
      }
      console.error("[Cadastre] Proxy Exception:", error);
      res.status(500).json({
        error: "Internal server error during Cadastre lookup",
        message: error.message
      });
    }
  });

  app.get("/api/rnb-buildings", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const url = `https://rnb-api.beta.gouv.fr/api/alpha/buildings/address/?q=${encodeURIComponent(q as string)}`;
      console.log(`Calling RNB API: ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`RNB API error: ${response.status} ${errorText}`);
        return res.status(response.status).json({ error: `RNB API error: ${response.status}`, details: errorText });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("Error in /api/rnb-buildings:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/georisques", async (req, res) => {
    try {
      const { latitude, longitude, code_insee } = req.query;

      if (!latitude || !longitude || !code_insee) {
        return res.status(400).json({ error: "latitude, longitude, and code_insee are required" });
      }

      const lat = parseFloat(latitude as string);
      const lon = parseFloat(longitude as string);
      const insee = code_insee as string;

      const result = await getGeorisques(lon, lat, insee);
      res.json(result);
    } catch (error: any) {
      console.error("Error in /api/georisques:", error);
      res.status(503).json({
        error: "Service Géorisques temporairement indisponible",
        details: error.message
      });
    }
  });

  app.get("/api/urbanisme", async (req, res) => {
    try {
      const { geom } = req.query;
      if (!geom) {
        return res.status(400).json({ error: "Le paramètre 'geom' est requis (GeoJSON stringifié)" });
      }

      let geometry: GeoJSONGeometry;
      try {
        geometry = JSON.parse(geom as string);
      } catch (e) {
        console.error("[GET /api/urbanisme]", e);
        return res.status(400).json({ error: "Format GeoJSON invalide" });
      }

      const result = await getPlu(geometry);
      res.json(result);
    } catch (error: any) {
      const status = error.status || 500;
      console.error(`[GPU] Route Error (${status}):`, error.message);
      res.status(status).json({ error: error.message });
    }
  });

  // Étape 0 : géocoder une adresse via le géocodeur interne BDNB pour obtenir la cle_interop_adr
  app.get("/api/bdnb-geocode", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const url = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=5`;
      console.log(`Calling BDNB Geocodage API: ${url}`);

      const response = await fetchWithTimeout(url, {
        headers: { 'Accept': 'application/json' }
      }, 10000); // 10 second timeout

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`BDNB Geocodage error: ${response.status} ${errorText.substring(0, 200)}`);
        return res.status(response.status).json({ error: `BDNB Geocodage error: ${response.status}`, details: errorText.substring(0, 200) });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text().catch(() => 'Could not read body');
        console.error(`BDNB Geocodage returned non-JSON: ${text.substring(0, 200)}`);
        res.status(502).json({ error: "Invalid response from BDNB Geocodage", details: text.substring(0, 200) });
      }
    } catch (error: any) {
      console.error("Error in /api/bdnb-geocode:", error);
      if (error.name === 'AbortError') {
        res.status(504).json({ error: "BDNB geocodage request timed out" });
      } else {
        res.status(500).json({ error: "Internal server error", details: error.message });
      }
    }
  });

  app.get("/api/bdnb", async (req, res) => {
    try {
      const { q, banId, cityCode } = req.query;
      if (!q && !banId) {
        return res.status(400).json({ error: "Query parameter 'q' or 'banId' is required" });
      }

      let buildings: any[] = [];

      // Step 1: If we have a banId, try to find the building group ID first using the relationship table
      // This table is indexed on cle_interop_adr and is much faster for direct lookups
      if (banId) {
        const relUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banId}&select=batiment_groupe_id`;
        console.log(`Calling BDNB Rel API: ${relUrl}`);

        try {
          const relResponse = await fetchWithTimeout(relUrl, {
            headers: { 'Accept': 'application/json' }
          }, 5000); // 5 second timeout

          if (relResponse.ok) {
            const relData = await relResponse.json();
            const ids = (Array.isArray(relData) ? relData : []).map((item: any) => item.batiment_groupe_id).filter(Boolean);

            if (ids.length > 0) {
              // Step 2: Fetch full details for these specific building IDs
              const detailUrl = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?batiment_groupe_id=in.(${ids.join(',')})&limit=5`;
              console.log(`Calling BDNB Detail API: ${detailUrl}`);

              const detailResponse = await fetchWithTimeout(detailUrl, {
                headers: { 'Accept': 'application/json' }
              }, 5000);

              if (detailResponse.ok) {
                buildings = await detailResponse.json();
              }
            }
          }
        } catch (err) {
          console.error("Error in BDNB direct lookup:", err);
          // Continue to fallback if direct lookup fails
        }
      }

      // Step 3: Fallback to geocoder if no buildings found via banId or no banId provided
      // Fuzzy search on batiment_groupe_complet is very slow.
      // We use the geocoder to get a cle_interop_adr first.
      if (buildings.length === 0 && q) {
        console.log(`[BDNB] Fallback: Geocoding query "${q}" to get cle_interop_adr`);
        const geoUrl = `https://api.bdnb.io/v1/bdnb/geocodage?q=${encodeURIComponent(q as string)}&limit=1`;

        try {
          const geoRes = await fetchWithTimeout(geoUrl, {
            headers: { 'Accept': 'application/json' }
          }, 5000);

          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const firstResult = geoData[0];
            if (firstResult && firstResult.cle_interop_adr) {
              const banIdFromGeo = firstResult.cle_interop_adr;
              console.log(`[BDNB] Geocoder found cle_interop_adr: ${banIdFromGeo}`);

              // Now try direct lookup with this ID
              const relUrl = `https://api.bdnb.io/v1/bdnb/donnees/rel_batiment_groupe_adresse?cle_interop_adr=eq.${banIdFromGeo}&select=batiment_groupe_id`;
              const relResponse = await fetchWithTimeout(relUrl, {
                headers: { 'Accept': 'application/json' }
              }, 5000);

              if (relResponse.ok) {
                const relData = await relResponse.json();
                const ids = (Array.isArray(relData) ? relData : []).map((item: any) => item.batiment_groupe_id).filter(Boolean);

                if (ids.length > 0) {
                  const detailUrl = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?batiment_groupe_id=in.(${ids.join(',')})&limit=5`;
                  const detailResponse = await fetchWithTimeout(detailUrl, {
                    headers: { 'Accept': 'application/json' }
                  }, 5000);

                  if (detailResponse.ok) {
                    buildings = await detailResponse.json();
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("Error in BDNB fallback geocoding:", err);
        }
      }

      // Step 4: Final fallback to fuzzy search ONLY if geocoder failed or returned nothing
      // This is the last resort and might still timeout.
      if (buildings.length === 0 && q) {
        let url = `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?limit=5`;
        if (cityCode) {
          url += `&code_commune_insee=eq.${cityCode}`;
        }
        url += `&libelle_adr_principale_ban=ilike.*${encodeURIComponent(q as string)}*`;

        console.log(`Calling BDNB Final Fallback API: ${url}`);

        try {
          const response = await fetchWithTimeout(url, {
            headers: { 'Accept': 'application/json' }
          }, 15000); // Increased timeout for fuzzy search

          if (response.ok) {
            buildings = await response.json();
          }
        } catch (err) {
          console.error("Error in BDNB final fallback search:", err);
        }
      }

      res.json(buildings);
    } catch (error: any) {
      console.error("Error in /api/bdnb:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  });
}
