import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { proposalToXml, xmlToProposal } from "./src/lib/xmlHelper";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import https from "https";
import { supabaseAdmin } from "./src/server/supabaseAdmin.js";
import { requireAuth, AuthenticatedRequest } from "./src/server/authMiddleware.js";

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
    let datapproIso = null;
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

// Helper for fetching with timeout
async function fetchWithTimeout(url: string, options: any = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Use memory storage — files are uploaded directly to Supabase Storage
const upload = multer({ storage: multer.memoryStorage() });

dotenv.config();


async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Debug middleware for API routes
  app.use("/api/*", (req, res, next) => {
    console.log(`[API DEBUG] ${req.method} ${req.originalUrl}`);
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", environment: process.env.NODE_ENV });
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

  interface GeorisquesV2Response {
    data: Array<{
      type_risque: string;
      libelle_risque?: string;
      [key: string]: any;
    }>;
    [key: string]: any;
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
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
            const ids = relData.map((item: any) => item.batiment_groupe_id).filter(Boolean);
            
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
                const ids = relData.map((item: any) => item.batiment_groupe_id).filter(Boolean);
                
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

  // OS Routes
  app.get("/api/ordres_de_service", async (req, res) => {
    const { project_id } = req.query;
    const { data, error } = await supabaseAdmin.from('ordres_de_service').select('*').eq('project_id', project_id as string);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/ordres_de_service", async (req, res) => {
    const id = `os-${Date.now()}`;
    const payload = { id, ...req.body, status: req.body.status || 'draft' };
    const { data, error } = await supabaseAdmin.from('ordres_de_service').insert(payload).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  });

  app.put("/api/ordres_de_service/:id", async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin.from('ordres_de_service').update(req.body).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/ordres_de_service/:id", async (req, res) => {
    const { error } = await supabaseAdmin.from('ordres_de_service').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Visa Routes
  app.get("/api/visas", async (req, res) => {
    const { project_id } = req.query;
    const { data, error } = await supabaseAdmin.from('visas').select('*').eq('project_id', project_id as string);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/visas", async (req, res) => {
    const id = `visa-${Date.now()}`;
    const { project_id, title, date, status, comments, document_url } = req.body;
    const { data, error } = await supabaseAdmin.from('visas').insert({ id, project_id, title, date, status: status || 'pending', comments, document_url }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/visas/:id", async (req, res) => {
    const { error } = await supabaseAdmin.from('visas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Reception Routes
  app.get("/api/receptions", async (req, res) => {
    const { project_id } = req.query;
    const { data, error } = await supabaseAdmin.from('receptions').select('*').eq('project_id', project_id as string);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/receptions", async (req, res) => {
    const id = `rec-${Date.now()}`;
    const { project_id, date, type, has_reserves, reserves_count, document_url } = req.body;
    const { data, error } = await supabaseAdmin.from('receptions').insert({ id, project_id, date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/receptions/:id", async (req, res) => {
    const { error } = await supabaseAdmin.from('receptions').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Reserves
  app.get("/api/reserves", async (req, res) => {
    const { project_id } = req.query;
    const { data, error } = await supabaseAdmin.from('reserves').select('*').eq('project_id', project_id as string);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/reserves", async (req, res) => {
    const { id, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
    const { data: lastData } = await supabaseAdmin.from('reserves').select('number').eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
    const nextNumber = ((lastData as any)?.number || 0) + 1;
    const { data, error } = await supabaseAdmin.from('reserves').insert({ id, project_id, reception_id, title, batiment, local, status: status || 'A faire', lots: JSON.stringify(lots), entreprises: JSON.stringify(entreprises), created_at, due_date, plan_id, x, y, number: nextNumber }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.delete("/api/reserves/:id", async (req, res) => {
    const { error } = await supabaseAdmin.from('reserves').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.put("/api/reserves/:id", async (req, res) => {
    const { title, batiment, local, status, lots, entreprises, created_at, due_date } = req.body;
    const { data, error } = await supabaseAdmin.from('reserves').update({ title, batiment, local, status, lots: JSON.stringify(lots), entreprises: JSON.stringify(entreprises), created_at, due_date }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // Plans
  app.get("/api/plans", async (req, res) => {
    const { project_id } = req.query;
    const { data, error } = await supabaseAdmin.from('plans').select('*').eq('project_id', project_id as string);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/plans", async (req, res) => {
    const { id, project_id, name, file_url } = req.body;
    const uploaded_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('plans').insert({ id, project_id, name, file_url, uploaded_at }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // Document Routes
  app.get("/api/documents", async (req, res) => {
    const { project_id } = req.query;
    let query = supabaseAdmin.from('documents').select('*');
    if (project_id) query = query.eq('project_id', project_id as string);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.post("/api/documents", upload.single('file'), async (req, res) => {
    const { project_id, name, category, description, uploaded_by } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const projectIdVal = project_id === '' || project_id === 'null' ? null : project_id;
    const id = `doc-${Date.now()}`;
    const fileName = `${Date.now()}-${file.originalname}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('uploads').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (uploadError) return res.status(500).json({ error: uploadError.message });
    const { data: { publicUrl } } = supabaseAdmin.storage.from('uploads').getPublicUrl(fileName);
    const uploaded_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('documents').insert({ id, project_id: projectIdVal, name, category, version: 1, file_url: publicUrl, uploaded_by, uploaded_at, description }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await supabaseAdmin.from('document_versions').insert({ id: `ver-${Date.now()}`, document_id: id, version: 1, file_url: publicUrl, uploaded_by, uploaded_at, description });
    res.status(201).json(data);
  });

  app.delete("/api/documents/:id", async (req, res) => {
    const { id } = req.params;
    await supabaseAdmin.from('document_versions').delete().eq('document_id', id);
    const { error } = await supabaseAdmin.from('documents').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  app.put("/api/documents/:id", upload.single('file'), async (req, res) => {
    const { id } = req.params;
    const { name, category, description, uploaded_by } = req.body;
    const file = req.file;
    if (file) {
      const { data: doc } = await supabaseAdmin.from('documents').select('version').eq('id', id).single();
      const newVersion = ((doc as any)?.version || 1) + 1;
      const fileName = `${Date.now()}-${file.originalname}`;
      const { error: uploadError } = await supabaseAdmin.storage.from('uploads').upload(fileName, file.buffer, { contentType: file.mimetype });
      if (uploadError) return res.status(500).json({ error: uploadError.message });
      const { data: { publicUrl } } = supabaseAdmin.storage.from('uploads').getPublicUrl(fileName);
      const uploaded_at = new Date().toISOString();
      await supabaseAdmin.from('documents').update({ name, category, description, version: newVersion, file_url: publicUrl, uploaded_at }).eq('id', id);
      await supabaseAdmin.from('document_versions').insert({ id: `ver-${Date.now()}`, document_id: id, version: newVersion, file_url: publicUrl, uploaded_by: uploaded_by || 'System', uploaded_at, description });
    } else {
      await supabaseAdmin.from('documents').update({ name, category, description }).eq('id', id);
    }
    res.json({ success: true });
  });

  app.get("/api/documents/:id/versions", async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin.from('document_versions').select('*').eq('document_id', id).order('version', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  app.get("/api/projects", async (req, res) => {
    const [{ data: projects, error }, { data: cotraitants }, { data: lots }, { data: stakeholders }, { data: junctions }] = await Promise.all([
      supabaseAdmin.from('projects').select('*'),
      supabaseAdmin.from('project_cotraitants').select('*, contacts(first_name, last_name)'),
      supabaseAdmin.from('project_lots').select('*, contacts(first_name, last_name)'),
      supabaseAdmin.from('project_stakeholders').select('*, contacts(first_name, last_name)'),
      supabaseAdmin.from('project_categories_junction').select('*, project_categories(*)'),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    const projectsWithDetails = (projects ?? []).map((p: any) => ({
      ...p,
      cotraitants_list: (cotraitants ?? []).filter((c: any) => c.project_id === p.id).map((c: any) => ({ ...c, contact_name: c.contacts ? `${c.contacts.first_name} ${c.contacts.last_name}` : null })),
      lots_list: (lots ?? []).filter((l: any) => l.project_id === p.id).map((l: any) => ({ ...l, contact_name: l.contacts ? `${l.contacts.first_name} ${l.contacts.last_name}` : null })),
      stakeholders_list: (stakeholders ?? []).filter((s: any) => s.project_id === p.id).map((s: any) => ({ ...s, contact_name: s.contacts ? `${s.contacts.first_name} ${s.contacts.last_name}` : null })),
      categories_list: (junctions ?? []).filter((j: any) => j.project_id === p.id).map((j: any) => j.project_categories),
    }));
    res.json(projectsWithDetails);
  });

  app.get("/api/projects/:id/full", async (req, res) => {
    try {
      const { id } = req.params;
      const { data: project, error: projectError } = await supabaseAdmin.from('projects').select('*').eq('id', id).single();
      if (projectError) return res.status(500).json({ error: projectError.message });
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const [
        { data: milestones, error: milestonesError },
        { data: invoices, error: invoicesError },
        { data: specifications, error: specificationsError },
        { data: ordres_de_service, error: odsError },
        { data: visas, error: visasError },
        { data: receptions, error: receptionsError },
        { data: reserves, error: reservesError },
        { data: plans, error: plansError }
      ] = await Promise.all([
        supabaseAdmin.from('milestones').select('*').eq('project_id', id),
        supabaseAdmin.from('invoices').select('*').eq('project_id', id),
        supabaseAdmin.from('specifications').select('*').eq('project_id', id),
        supabaseAdmin.from('ordres_de_service').select('*').eq('project_id', id),
        supabaseAdmin.from('visas').select('*').eq('project_id', id),
        supabaseAdmin.from('receptions').select('*').eq('project_id', id),
        supabaseAdmin.from('reserves').select('*').eq('project_id', id),
        supabaseAdmin.from('plans').select('*').eq('project_id', id)
      ]);

      if (milestonesError) return res.status(500).json({ error: milestonesError.message });
      if (invoicesError) return res.status(500).json({ error: invoicesError.message });
      if (specificationsError) return res.status(500).json({ error: specificationsError.message });
      if (odsError) return res.status(500).json({ error: odsError.message });
      if (visasError) return res.status(500).json({ error: visasError.message });
      if (receptionsError) return res.status(500).json({ error: receptionsError.message });
      if (reservesError) return res.status(500).json({ error: reservesError.message });
      if (plansError) return res.status(500).json({ error: plansError.message });

      res.json({
        project,
        milestones: milestones ?? [],
        invoices: invoices ?? [],
        specifications: specifications ?? [],
        ordres_de_service: ordres_de_service ?? [],
        visas: visas ?? [],
        receptions: receptions ?? [],
        reserves: reserves ?? [],
        plans: plans ?? []
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch project details" });
    }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Situations API
  app.get("/api/dpgf/:projectId", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('dpgf_items').select('*').eq('project_id', req.params.projectId);
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch dpgf items" });
    }
  });

  app.get("/api/situations/:projectId", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('situations').select('*').eq('project_id', req.params.projectId);
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch situations" });
    }
  });

  app.get("/api/situations/:situationId/details", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('detail_situations').select('*').eq('situation_id', req.params.situationId);
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch situation details" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const {
        id, name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, etudes_notes, chantier_notes, is_public_client,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification
      } = req.body;

      if (!name || !client) {
        return res.status(400).json({ error: "Name and client are required" });
      }

      // Generate project code: YYNNN
      const year = new Date().getFullYear().toString().slice(-2);
      const { data: countData, error: countError } = await supabaseAdmin.from('projects').select('project_code').like('project_code', `${year}%`);
      if (countError) return res.status(500).json({ error: countError.message });
      const nextNum = ((countData?.length ?? 0) + 1).toString().padStart(3, '0');
      const project_code = `${year}${nextNum}`;

      const { error: insertError } = await supabaseAdmin.from('projects').insert({
        id,
        name,
        client,
        status: status || 'Planning',
        budget: budget || 0,
        category: category || null,
        start_date: start_date || new Date().toISOString().split('T')[0],
        end_date: end_date || new Date().toISOString().split('T')[0],
        description: description || null,
        image_url: image_url || null,
        project_code,
        address: address || null,
        is_complete_mission: is_complete_mission ? 1 : 0,
        etudes_notes: etudes_notes || null,
        chantier_notes: chantier_notes || null,
        is_public_client: is_public_client ? 1 : 0,
        surface: surface || null,
        construction_cost: construction_cost || null,
        remuneration: remuneration || null,
        progression: progression || null,
        project_manager: project_manager || null,
        cotraitants: cotraitants || null,
        external_intervenants: external_intervenants || null,
        entreprises: entreprises || null,
        reference: reference || null,
        projet_detail: projet_detail || null,
        is_entreprise: is_entreprise ? 1 : 0,
        nom_societe: nom_societe || null,
        rcs: rcs || null,
        representant: representant || null,
        qualite: qualite || null,
        adresse_client: adresse_client || null,
        cp_client: cp_client || null,
        ville_client: ville_client || null,
        telephone: telephone || null,
        portable: portable || null,
        email_client: email_client || null,
        adresse_terrain: adresse_terrain || null,
        cp_ville_terrain: cp_ville_terrain || null,
        ban_id_terrain: ban_id_terrain || null,
        city_code_terrain: city_code_terrain || null,
        ref_cadastrale: ref_cadastrale || null,
        zone_plu: zone_plu || null,
        surface_parcelle: surface_parcelle || null,
        nom_etablissement: nom_etablissement || null,
        avant_trav: avant_trav || null,
        apres_trav: apres_trav || null,
        type_et_cat: type_et_cat || null,
        type_projet: type_projet || null,
        categorie_projet: categorie_projet || null,
        surface_plancher: surface_plancher || null,
        surface_plancher_ext: surface_plancher_ext || null,
        surface_erp: surface_erp || null,
        surface_ert: surface_ert || null,
        effectif_public: effectif_public || null,
        effectif_personnel: effectif_personnel || null,
        ind: ind || null,
        date_modification: date_modification || null
      });
      if (insertError) return res.status(500).json({ error: insertError.message });

      if (cotraitants_list && Array.isArray(cotraitants_list)) {
        const { error: cotError } = await supabaseAdmin.from('project_cotraitants').insert(
          cotraitants_list.map((cot: any) => ({
            id: `pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            specialty: cot.specialty,
            contact_id: cot.contact_id || null
          }))
        );
        if (cotError) return res.status(500).json({ error: cotError.message });
      }

      if (lots_list && Array.isArray(lots_list)) {
        const { error: lotsError } = await supabaseAdmin.from('project_lots').insert(
          lots_list.map((lot: any) => ({
            id: `pl${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            lot_number: lot.lot_number,
            lot_title: lot.lot_title,
            contact_id: lot.contact_id || null
          }))
        );
        if (lotsError) return res.status(500).json({ error: lotsError.message });
      }

      if (stakeholders_list && Array.isArray(stakeholders_list)) {
        const { error: stakeError } = await supabaseAdmin.from('project_stakeholders').insert(
          stakeholders_list.map((s: any) => ({
            id: `ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            name: s.name,
            role: s.role,
            contact_id: s.contact_id || null
          }))
        );
        if (stakeError) return res.status(500).json({ error: stakeError.message });
      }

      if (categories_list && Array.isArray(categories_list)) {
        const { error: catJuncError } = await supabaseAdmin.from('project_categories_junction').insert(
          categories_list.map((catId: any) => ({ project_id: id, category_id: catId }))
        );
        if (catJuncError) return res.status(500).json({ error: catJuncError.message });
      }

      res.status(201).json({ id, project_code });
    } catch (error: any) {
      console.error("Error creating project:", error);
      res.status(500).json({ error: "Failed to create project: " + error.message });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, etudes_notes, chantier_notes, is_public_client,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification
      } = req.body;

      if (!name || !client) {
        return res.status(400).json({ error: "Name and client are required" });
      }

      const updateContactAffaires = async (contactId: string, projectId: string) => {
        const { data: contact } = await supabaseAdmin.from('contacts').select('affaires').eq('id', contactId).single();
        if (!contact) return;
        let affaires = contact.affaires ? contact.affaires.split(',').map((s: string) => s.trim()) : [];
        if (!affaires.includes(projectId)) {
          affaires.push(projectId);
          await supabaseAdmin.from('contacts').update({ affaires: affaires.join(',') }).eq('id', contactId);
        }
      };

      const { error: updateError } = await supabaseAdmin.from('projects').update({
        name,
        client,
        status,
        budget,
        category: category || null,
        start_date,
        end_date,
        description: description || null,
        image_url: image_url || null,
        address: address || null,
        is_complete_mission: is_complete_mission ? 1 : 0,
        etudes_notes: etudes_notes || null,
        chantier_notes: chantier_notes || null,
        is_public_client: is_public_client ? 1 : 0,
        surface: surface || null,
        construction_cost: construction_cost || null,
        remuneration: remuneration || null,
        progression: progression || null,
        project_manager: project_manager || null,
        cotraitants: cotraitants || null,
        external_intervenants: external_intervenants || null,
        entreprises: entreprises || null,
        reference: reference || null,
        projet_detail: projet_detail || null,
        is_entreprise: is_entreprise ? 1 : 0,
        nom_societe: nom_societe || null,
        rcs: rcs || null,
        representant: representant || null,
        qualite: qualite || null,
        adresse_client: adresse_client || null,
        cp_client: cp_client || null,
        ville_client: ville_client || null,
        telephone: telephone || null,
        portable: portable || null,
        email_client: email_client || null,
        adresse_terrain: adresse_terrain || null,
        cp_ville_terrain: cp_ville_terrain || null,
        ban_id_terrain: ban_id_terrain || null,
        city_code_terrain: city_code_terrain || null,
        ref_cadastrale: ref_cadastrale || null,
        zone_plu: zone_plu || null,
        surface_parcelle: surface_parcelle || null,
        nom_etablissement: nom_etablissement || null,
        avant_trav: avant_trav || null,
        apres_trav: apres_trav || null,
        type_et_cat: type_et_cat || null,
        type_projet: type_projet || null,
        categorie_projet: categorie_projet || null,
        surface_plancher: surface_plancher || null,
        surface_plancher_ext: surface_plancher_ext || null,
        surface_erp: surface_erp || null,
        surface_ert: surface_ert || null,
        effectif_public: effectif_public || null,
        effectif_personnel: effectif_personnel || null,
        ind: ind || null,
        date_modification: date_modification || null
      }).eq('id', id);
      if (updateError) return res.status(updateError.code === 'PGRST116' ? 404 : 500).json({ error: updateError.message });

      // Update cotraitants
      const { error: delCotError } = await supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id);
      if (delCotError) return res.status(500).json({ error: delCotError.message });
      if (cotraitants_list && Array.isArray(cotraitants_list)) {
        const { error: cotError } = await supabaseAdmin.from('project_cotraitants').insert(
          cotraitants_list.map((cot: any) => ({
            id: `pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            specialty: cot.specialty,
            contact_id: cot.contact_id || null
          }))
        );
        if (cotError) return res.status(500).json({ error: cotError.message });
        for (const cot of cotraitants_list) {
          if (cot.contact_id) await updateContactAffaires(cot.contact_id, id);
        }
      }

      // Update lots
      const { error: delLotsError } = await supabaseAdmin.from('project_lots').delete().eq('project_id', id);
      if (delLotsError) return res.status(500).json({ error: delLotsError.message });
      if (lots_list && Array.isArray(lots_list)) {
        const { error: lotsError } = await supabaseAdmin.from('project_lots').insert(
          lots_list.map((lot: any) => ({
            id: `pl${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            lot_number: lot.lot_number,
            lot_title: lot.lot_title,
            contact_id: lot.contact_id || null
          }))
        );
        if (lotsError) return res.status(500).json({ error: lotsError.message });
        for (const lot of lots_list) {
          if (lot.contact_id) await updateContactAffaires(lot.contact_id, id);
        }
      }

      const { error: delStakeError } = await supabaseAdmin.from('project_stakeholders').delete().eq('project_id', id);
      if (delStakeError) return res.status(500).json({ error: delStakeError.message });
      if (stakeholders_list && Array.isArray(stakeholders_list)) {
        const { error: stakeError } = await supabaseAdmin.from('project_stakeholders').insert(
          stakeholders_list.map((s: any) => ({
            id: `ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: id,
            name: s.name,
            role: s.role,
            contact_id: s.contact_id || null
          }))
        );
        if (stakeError) return res.status(500).json({ error: stakeError.message });
        for (const s of stakeholders_list) {
          if (s.contact_id) await updateContactAffaires(s.contact_id, id);
        }
      }

      const { error: delCatError } = await supabaseAdmin.from('project_categories_junction').delete().eq('project_id', id);
      if (delCatError) return res.status(500).json({ error: delCatError.message });
      if (categories_list && Array.isArray(categories_list)) {
        const { error: catJuncError } = await supabaseAdmin.from('project_categories_junction').insert(
          categories_list.map((catId: any) => ({ project_id: id, category_id: catId }))
        );
        if (catJuncError) return res.status(500).json({ error: catJuncError.message });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project: " + error.message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = req.headers['x-user-role'];
      
      console.log(`Attempting to delete project ${id} with role ${userRole}`);

      if (userRole !== 'admin') {
        console.log(`Access denied for role ${userRole}`);
        return res.status(403).json({ error: "Only administrators can delete projects" });
      }

      // Delete related data then project (ON DELETE CASCADE handles most, but explicit for safety)
      await Promise.all([
        supabaseAdmin.from('project_team').delete().eq('project_id', id),
        supabaseAdmin.from('milestones').delete().eq('project_id', id),
        supabaseAdmin.from('specifications').delete().eq('project_id', id),
        supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id),
      ]);
      const { error: delError, count } = await supabaseAdmin.from('projects').delete({ count: 'exact' }).eq('id', id);
      if (delError) return res.status(500).json({ error: delError.message });
      if (!count) {
        console.log(`Project ${id} not found`);
        return res.status(404).json({ error: "Project not found" });
      }
      console.log(`Project ${id} deleted successfully`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting project:", error);
      res.status(500).json({ error: "Failed to delete project: " + error.message });
    }
  });

  app.get("/api/project_categories", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('project_categories').select('*').order('name');
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch project categories" });
    }
  });

  app.post("/api/project_categories", async (req, res) => {
    try {
      const { id, name } = req.body;
      const { error } = await supabaseAdmin.from('project_categories').insert({ id, name });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create project category" });
    }
  });

  app.delete("/api/project_categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_categories').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete project category" });
    }
  });

  app.get("/api/tasks", async (req, res) => {
    try {
      const { data: tasks, error } = await supabaseAdmin.from('tasks').select('*');
      if (error) return res.status(500).json({ error: error.message });
      const tasksWithParsedDeps = (tasks ?? []).map((task: any) => {
        let dependencies = [];
        try {
          dependencies = task.dependencies ? JSON.parse(task.dependencies) : [];
        } catch (e) {
          console.error(`Failed to parse dependencies for task ${task.id}:`, task.dependencies);
        }
        return {
          ...task,
          dependencies
        };
      });
      res.json(tasksWithParsedDeps);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const { id, project_id, title, start_date, end_date, progress, dependencies } = req.body;
      const { error } = await supabaseAdmin.from('tasks').insert({
        id, project_id, title, start_date, end_date,
        progress: progress || 0,
        dependencies: JSON.stringify(dependencies || [])
      });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.put("/api/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, start_date, end_date, progress, dependencies } = req.body;
      const { error } = await supabaseAdmin.from('tasks').update({
        title, start_date, end_date, progress,
        dependencies: JSON.stringify(dependencies || [])
      }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.get("/api/team", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('team_members').select('id, name, email, role, system_role, avatar');
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.post("/api/team", async (req, res) => {
    try {
      const { name, email, role, system_role } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }

      // Check if user already exists
      const { data: existing, error: checkError } = await supabaseAdmin.from('team_members').select('*').eq('email', email).single();
      if (checkError && checkError.code !== 'PGRST116') return res.status(500).json({ error: checkError.message });
      if (existing) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      const id = `t${Date.now()}`;
      const password = Math.random().toString(36).slice(-8); // Generate random 8-char password

      const { error: insertMemberError } = await supabaseAdmin.from('team_members').insert({
        id, name, email, role: role || 'Member', system_role: system_role || 'user', password
      });
      if (insertMemberError) return res.status(500).json({ error: insertMemberError.message });

      // Send email
      let emailSent = false;
      let emailError = null;

      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('id', 'general').single();
      const smtpHost = settings?.smtpHost || process.env.SMTP_HOST;
      const smtpPort = settings?.smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = settings?.smtpUser || process.env.SMTP_USER;
      const smtpPass = settings?.smtpPass || process.env.SMTP_PASS;

      console.log(`[Team Creation] Attempting to send email to ${email} using host ${smtpHost}:${smtpPort}`);

      if (smtpHost && smtpUser && smtpPass) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(String(smtpPort)),
            secure: String(smtpPort) === '465',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });

          const appUrl = process.env.APP_URL || 'http://localhost:3000';
          
          await transporter.sendMail({
            from: `"ArchiManager" <${smtpUser}>`,
            to: email,
            subject: "Your ArchiManager Credentials",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #2563eb;">Welcome to ArchiManager</h2>
                <p>Hello ${name},</p>
                <p>An account has been created for you on ArchiManager. Here are your credentials to access the application:</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0;"><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
                  <p style="margin: 10px 0 0 0;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0 0 0;"><strong>Temporary Password:</strong> ${password}</p>
                </div>
                <p>Please change your password after your first login.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px;">Best regards,<br>The ArchiManager Team</p>
              </div>
            `
          });
          console.log(`Credentials email sent to ${email}`);
          emailSent = true;
        } catch (err: any) {
          console.error("[Team Creation] Failed to send credentials email:", err);
          emailError = err.message;
        }
      } else {
        const missing = [];
        if (!smtpHost) missing.push('smtpHost');
        if (!smtpUser) missing.push('smtpUser');
        if (!smtpPass) missing.push('smtpPass');
        console.warn(`[Team Creation] SMTP settings missing (${missing.join(', ')}), skipping credentials email.`);
        emailError = `Configuration SMTP manquante : ${missing.join(', ')}`;
      }

      res.status(201).json({ id, name, email, role, system_role, emailSent, emailError });
    } catch (error: any) {
      console.error("Error creating team member:", error);
      res.status(500).json({ error: "Failed to create team member: " + error.message });
    }
  });

  app.put("/api/team/:id/role", async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const { error } = await supabaseAdmin.from('team_members').update({ system_role: role }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating user role:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.get("/api/tenders", async (req, res) => {
    try {
      const { data: tenders, error: tendersError } = await supabaseAdmin.from('tenders').select('*, contacts(first_name, last_name)');
      if (tendersError) return res.status(500).json({ error: tendersError.message });

      const { data: allSpecialties, error: specError } = await supabaseAdmin.from('tender_specialties').select('*, contacts(first_name, last_name)');
      if (specError) return res.status(500).json({ error: specError.message });

      const tendersWithSpecialties = (tenders ?? []).map((tender: any) => {
        const mandataire = tender.contacts;
        const mandataire_name = mandataire ? `${mandataire.first_name} ${mandataire.last_name}` : null;
        const specialties_list = (allSpecialties ?? [])
          .filter((ts: any) => ts.tender_id === tender.id)
          .map((ts: any) => ({
            ...ts,
            contact_name: ts.contacts ? `${ts.contacts.first_name} ${ts.contacts.last_name}` : null
          }));
        return { ...tender, mandataire_name, specialties_list };
      });

      res.json(tendersWithSpecialties);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tenders" });
    }
  });

  app.get("/api/tenders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { data: tender, error: tenderError } = await supabaseAdmin.from('tenders').select('*, contacts(first_name, last_name)').eq('id', id).single();
      if (tenderError) return res.status(tenderError.code === 'PGRST116' ? 404 : 500).json({ error: tenderError.code === 'PGRST116' ? "Tender not found" : tenderError.message });

      const { data: specialties, error: specError } = await supabaseAdmin.from('tender_specialties').select('*, contacts(first_name, last_name)').eq('tender_id', id);
      if (specError) return res.status(500).json({ error: specError.message });

      const mandataire = (tender as any).contacts;
      const mandataire_name = mandataire ? `${mandataire.first_name} ${mandataire.last_name}` : null;
      const specialties_list = (specialties ?? []).map((ts: any) => ({
        ...ts,
        contact_name: ts.contacts ? `${ts.contacts.first_name} ${ts.contacts.last_name}` : null
      }));

      res.json({ ...tender, mandataire_name, specialties_list });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch tender" });
    }
  });

  app.post("/api/tenders", async (req, res) => {
    try {
      const {
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list
      } = req.body;

      const id = `t${Date.now()}`;

      const { error: insertErr } = await supabaseAdmin.from('tenders').insert({
        id,
        title,
        client,
        submission_deadline,
        status: status || 'Draft',
        value: value || 0,
        notes: notes || '',
        mandataire_id: mandataire_id || null,
        type: type || null,
        surface: surface || 0,
        construction_cost: construction_cost || 0,
        honoraires_percent: honoraires_percent || 0,
        mandatory_visit: mandatory_visit ? 1 : 0,
        visit_date: visit_date || null,
        withdrawal_deadline: withdrawal_deadline || null,
        archived: archived ? 1 : 0
      });
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      if (specialties_list && Array.isArray(specialties_list)) {
        for (const spec of specialties_list) {
          const { error: specErr } = await supabaseAdmin.from('tender_specialties').insert({
            id: `ts${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            tender_id: id,
            specialty_name: spec.specialty_name,
            contact_id: spec.contact_id || null
          });
          if (specErr) return res.status(500).json({ error: specErr.message });
        }
      }

      if (milestones_list && Array.isArray(milestones_list)) {
        for (const m of milestones_list) {
          const { error: msErr } = await supabaseAdmin.from('milestones').insert({
            id: `m${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            tender_id: id,
            title: m.title,
            due_date: m.due_date,
            completed: m.completed ? 1 : 0
          });
          if (msErr) return res.status(500).json({ error: msErr.message });
        }
      }

      // Fetch the created tender with joined data
      const { data: tender, error: tenderErr } = await supabaseAdmin
        .from('tenders')
        .select('*, contacts(first_name, last_name)')
        .eq('id', id)
        .single();
      if (tenderErr) return res.status(500).json({ error: tenderErr.message });

      const { data: specialties, error: specListErr } = await supabaseAdmin
        .from('tender_specialties')
        .select('*, contacts(first_name, last_name)')
        .eq('tender_id', id);
      if (specListErr) return res.status(500).json({ error: specListErr.message });

      res.status(201).json({ ...tender, specialties_list: specialties ?? [] });
    } catch (error: any) {
      console.error("Error creating tender:", error);
      res.status(500).json({ error: "Failed to create tender: " + error.message });
    }
  });

  app.delete("/api/tenders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error: delSpecErr } = await supabaseAdmin.from('tender_specialties').delete().eq('tender_id', id);
      if (delSpecErr) return res.status(500).json({ error: delSpecErr.message });
      const { error: delMsErr } = await supabaseAdmin.from('milestones').delete().eq('tender_id', id);
      if (delMsErr) return res.status(500).json({ error: delMsErr.message });
      const { error: delErr } = await supabaseAdmin.from('tenders').delete().eq('id', id);
      if (delErr) return res.status(500).json({ error: delErr.message });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete tender" });
    }
  });

  app.put("/api/tenders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        title, client, submission_deadline, status, value, notes,
        mandataire_id, type, surface, construction_cost, honoraires_percent,
        mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list
      } = req.body;

      const { error: updateErr } = await supabaseAdmin.from('tenders').update({
        title,
        client,
        submission_deadline,
        status,
        value: value || 0,
        notes: notes || '',
        mandataire_id: mandataire_id || null,
        type: type || null,
        surface: surface || 0,
        construction_cost: construction_cost || 0,
        honoraires_percent: honoraires_percent || 0,
        mandatory_visit: mandatory_visit ? 1 : 0,
        visit_date: visit_date || null,
        withdrawal_deadline: withdrawal_deadline || null,
        archived: archived ? 1 : 0
      }).eq('id', id);
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Update specialties
      const { error: delSpecErr } = await supabaseAdmin.from('tender_specialties').delete().eq('tender_id', id);
      if (delSpecErr) return res.status(500).json({ error: delSpecErr.message });
      if (specialties_list && Array.isArray(specialties_list)) {
        for (const spec of specialties_list) {
          const { error: specErr } = await supabaseAdmin.from('tender_specialties').insert({
            id: `ts${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            tender_id: id,
            specialty_name: spec.specialty_name,
            contact_id: spec.contact_id || null
          });
          if (specErr) return res.status(500).json({ error: specErr.message });
        }
      }

      // Update milestones
      const { error: delMsErr } = await supabaseAdmin.from('milestones').delete().eq('tender_id', id);
      if (delMsErr) return res.status(500).json({ error: delMsErr.message });
      if (milestones_list && Array.isArray(milestones_list)) {
        for (const m of milestones_list) {
          const { error: msErr } = await supabaseAdmin.from('milestones').insert({
            id: `m${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            tender_id: id,
            title: m.title,
            due_date: m.due_date,
            completed: m.completed ? 1 : 0
          });
          if (msErr) return res.status(500).json({ error: msErr.message });
        }
      }

      const { data: tender, error: tenderErr } = await supabaseAdmin
        .from('tenders')
        .select('*, contacts(first_name, last_name)')
        .eq('id', id)
        .single();
      if (tenderErr) return res.status(500).json({ error: tenderErr.message });

      const { data: specialties, error: specListErr } = await supabaseAdmin
        .from('tender_specialties')
        .select('*, contacts(first_name, last_name)')
        .eq('tender_id', id);
      if (specListErr) return res.status(500).json({ error: specListErr.message });

      res.json({ ...tender, specialties_list: specialties ?? [] });
    } catch (error: any) {
      console.error("Error updating tender:", error);
      res.status(500).json({ error: "Failed to update tender: " + error.message });
    }
  });

  app.get("/api/milestones", async (req, res) => {
    try {
      const { project_id, tender_id, proposal_id } = req.query;
      let query = supabaseAdmin.from('milestones').select('*').order('due_date', { ascending: true });
      if (project_id) {
        query = query.eq('project_id', project_id as string);
      } else if (tender_id) {
        query = query.eq('tender_id', tender_id as string);
      } else if (proposal_id) {
        query = query.eq('proposal_id', proposal_id as string);
      }
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch milestones" });
    }
  });

  app.post("/api/milestones", async (req, res) => {
    try {
      const { project_id, tender_id, proposal_id, title, due_date, completed } = req.body;
      const id = `m${Date.now()}`;
      const { error } = await supabaseAdmin.from('milestones').insert({
        id, project_id: project_id || null, tender_id: tender_id || null,
        proposal_id: proposal_id || null, title, due_date, completed: !!completed
      });
      if (error) return res.status(500).json({ error: error.message });
      const { data: milestone } = await supabaseAdmin.from('milestones').select('*').eq('id', id).single();
      res.status(201).json(milestone);
    } catch (error: any) {
      console.error("Error creating milestone:", error);
      res.status(500).json({ error: "Failed to create milestone: " + error.message });
    }
  });

  app.put("/api/milestones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, due_date, completed } = req.body;
      const { error } = await supabaseAdmin.from('milestones').update({
        title, due_date, completed: !!completed
      }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating milestone:", error);
      res.status(500).json({ error: "Failed to update milestone: " + error.message });
    }
  });

  app.delete("/api/milestones/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('milestones').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting milestone:", error);
      res.status(500).json({ error: "Failed to delete milestone: " + error.message });
    }
  });

  app.get("/api/specifications", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('specifications').select('*').order('last_updated', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      res.json((data ?? []).map((s: any) => ({ ...s, is_template: !!s.is_template })));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch specifications" });
    }
  });

  app.post("/api/specifications", async (req, res) => {
    try {
      const { id, project_id, title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { error } = await supabaseAdmin.from('specifications').insert({
        id, project_id, title, content, last_updated, is_template: !!is_template
      });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id, last_updated });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to create specification: " + error.message });
    }
  });

  app.put("/api/specifications/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { error } = await supabaseAdmin.from('specifications').update({
        title, content, last_updated, is_template: !!is_template
      }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, last_updated });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to update specification: " + error.message });
    }
  });

  app.delete("/api/specifications/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('specifications').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete specification: " + error.message });
    }
  });

  app.get("/api/contacts", async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin.from('contacts').select('*');
      if (error) return res.status(500).json({ error: error.message });
      const contacts = (data ?? []).map((c: any) => ({
        ...c,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ')
      }));
      res.json(contacts);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    console.log("POST /api/contacts hit");
    try {
      const contact = req.body;
      console.log("Contact body:", JSON.stringify(contact));
      const { error } = await supabaseAdmin.from('contacts').insert(contact);
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id: contact.id });
    } catch (error: any) {
      console.error("Error creating contact:", error.message);
      res.status(500).json({ error: "Failed to create contact: " + error.message });
    }
  });

  app.put("/api/contacts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const contact = req.body;
      const { error } = await supabaseAdmin.from('contacts').update(contact).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating contact:", error.message);
      res.status(500).json({ error: "Failed to update contact: " + error.message });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('contacts').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting contact:", error.message);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.get("/api/contact-categories", async (req, res) => {
    console.log("GET /api/contact-categories called");
    try {
      const { data, error } = await supabaseAdmin
        .from('contact_categories').select('*').order('name');
      if (error) return res.status(500).json({ error: error.message });
      res.json(data ?? []);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch contact categories" });
    }
  });

  app.get("/api/proposals", async (req, res) => {
    try {
      const { data: proposals, error: propErr } = await supabaseAdmin
        .from('proposals')
        .select('*, contacts(first_name, last_name)')
        .order('created_at', { ascending: false });
      if (propErr) return res.status(500).json({ error: propErr.message });

      const { data: allSpecialties, error: specErr } = await supabaseAdmin
        .from('proposal_specialties')
        .select('*, contacts(first_name, last_name)');
      if (specErr) return res.status(500).json({ error: specErr.message });

      const result = (proposals ?? []).map((p: any) => {
        const specialties = (allSpecialties ?? []).filter((s: any) => s.proposal_id === p.id);
        const contact = p.contacts;
        return {
          ...p,
          client_name: contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() : null,
          specialties_list: specialties.map((s: any) => ({
            ...s,
            contact_name: s.contacts ? `${s.contacts.first_name ?? ''} ${s.contacts.last_name ?? ''}`.trim() : null
          }))
        };
      });
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch proposals" });
    }
  });

  app.post("/api/proposals", async (req, res) => {
    try {
      const p = req.body;
      const id = `prop${Date.now()}`;
      const created_at = new Date().toISOString();

      const { error: insertErr } = await supabaseAdmin.from('proposals').insert({
        id, title: p.title, client_id: p.client_id || null, amount: p.amount || 0,
        status: p.status || 'Draft', description: p.description || '', created_at,
        reference: p.reference, projet_detail: p.projet_detail, is_entreprise: !!p.is_entreprise,
        nom_societe: p.nom_societe, rcs: p.rcs, representant: p.representant, qualite: p.qualite,
        adresse_client: p.adresse_client, cp_client: p.cp_client, ville_client: p.ville_client,
        telephone: p.telephone, portable: p.portable, email_client: p.email_client,
        adresse_terrain: p.adresse_terrain, cp_ville_terrain: p.cp_ville_terrain,
        ref_cadastrale: p.ref_cadastrale, zone_plu: p.zone_plu, surface_parcelle: p.surface_parcelle,
        nom_etablissement: p.nom_etablissement, avant_trav: p.avant_trav, apres_trav: p.apres_trav,
        type_et_cat: p.type_et_cat, type_projet: p.type_projet, categorie_projet: p.categorie_projet,
        surface_plancher: p.surface_plancher, surface_plancher_ext: p.surface_plancher_ext,
        surface_erp: p.surface_erp, surface_ert: p.surface_ert, effectif_public: p.effectif_public,
        effectif_personnel: p.effectif_personnel, ind: p.ind, date_modification: p.date_modification,
        project_code: p.project_code, project_number: p.project_number, project_status: p.project_status,
        keywords: p.keywords, notes: p.notes,
        site_name: p.site_name, site_description: p.site_description, site_id: p.site_id,
        site_address_1: p.site_address_1, site_address_2: p.site_address_2, site_address_3: p.site_address_3,
        site_postbox: p.site_postbox, site_city: p.site_city, site_state: p.site_state,
        site_postcode: p.site_postcode, site_country: p.site_country,
        site_gross_perimeter: p.site_gross_perimeter, site_gross_area: p.site_gross_area,
        building_name: p.building_name, building_description: p.building_description, building_id: p.building_id,
        contact_fullname: p.contact_fullname, contact_prefixtitle: p.contact_prefixtitle,
        contact_givenname: p.contact_givenname, contact_middlename: p.contact_middlename,
        contact_familyname: p.contact_familyname, contact_suffixtitle: p.contact_suffixtitle,
        contact_nameorder: p.contact_nameorder, contact_id: p.contact_id || null,
        contact_role: p.contact_role, contact_department: p.contact_department,
        contact_company: p.contact_company, contact_companycode: p.contact_companycode,
        contact_fulladdress: p.contact_fulladdress, contact_address_1: p.contact_address_1,
        contact_address_2: p.contact_address_2, contact_address_3: p.contact_address_3,
        contact_postbox: p.contact_postbox, contact_city: p.contact_city,
        contact_state: p.contact_state, contact_postcode: p.contact_postcode,
        contact_country: p.contact_country, contact_email: p.contact_email,
        contact_phone: p.contact_phone, contact_fax: p.contact_fax, contact_web: p.contact_web,
        cad_technician_fullname: p.cad_technician_fullname, cad_technician_prefixtitle: p.cad_technician_prefixtitle,
        cad_technician_givenname: p.cad_technician_givenname, cad_technician_middlename: p.cad_technician_middlename,
        cad_technician_familyname: p.cad_technician_familyname, cad_technician_suffixtitle: p.cad_technician_suffixtitle,
        cad_technician_nameorder: p.cad_technician_nameorder,
        client_fullname: p.client_fullname, client_prefixtitle: p.client_prefixtitle,
        client_givenname: p.client_givenname, client_middlename: p.client_middlename,
        client_familyname: p.client_familyname, client_suffixtitle: p.client_suffixtitle,
        client_nameorder: p.client_nameorder, client_company: p.client_company,
        client_fulladdress: p.client_fulladdress, client_address_1: p.client_address_1,
        client_address_2: p.client_address_2, client_address_3: p.client_address_3,
        client_postbox: p.client_postbox, client_city: p.client_city, client_state: p.client_state,
        client_postcode: p.client_postcode, client_country: p.client_country,
        client_email: p.client_email, client_phone: p.client_phone, client_fax: p.client_fax,
        ed_report_header: p.ed_report_header, custom_building: p.custom_building,
        custom_architect: p.custom_architect, custom_client: p.custom_client,
        fee_distribution: p.fee_distribution
      });
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      if (p.specialties_list && Array.isArray(p.specialties_list) && p.specialties_list.length > 0) {
        const specRows = p.specialties_list.map((spec: any) => ({
          id: `ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
          proposal_id: id,
          specialty_name: spec.specialty_name,
          contact_id: spec.contact_id || null
        }));
        const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specRows);
        if (specErr) return res.status(500).json({ error: specErr.message });
      }

      const { data: proposal, error: fetchErr } = await supabaseAdmin
        .from('proposals').select('*, contacts(first_name, last_name)').eq('id', id).single();
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      const { data: specialties } = await supabaseAdmin
        .from('proposal_specialties').select('*, contacts(first_name, last_name)').eq('proposal_id', id);

      const contact = (proposal as any)?.contacts;
      res.status(201).json({
        ...proposal,
        client_name: contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() : null,
        specialties_list: (specialties ?? []).map((s: any) => ({
          ...s,
          contact_name: s.contacts ? `${s.contacts.first_name ?? ''} ${s.contacts.last_name ?? ''}`.trim() : null
        }))
      });
    } catch (error: any) {
      console.error("Error creating proposal:", error);
      res.status(500).json({ error: "Failed to create proposal: " + error.message });
    }
  });

  app.put("/api/proposals/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const p = req.body;

      const { data: oldProposal, error: oldErr } = await supabaseAdmin
        .from('proposals').select('status').eq('id', id).single();
      if (oldErr) return res.status(500).json({ error: oldErr.message });

      const { error: updateErr } = await supabaseAdmin.from('proposals').update({
        title: p.title, client_id: p.client_id || null, amount: p.amount,
        description: p.description, status: p.status,
        reference: p.reference, projet_detail: p.projet_detail, is_entreprise: !!p.is_entreprise,
        nom_societe: p.nom_societe, rcs: p.rcs, representant: p.representant, qualite: p.qualite,
        adresse_client: p.adresse_client, cp_client: p.cp_client, ville_client: p.ville_client,
        telephone: p.telephone, portable: p.portable, email_client: p.email_client,
        adresse_terrain: p.adresse_terrain, cp_ville_terrain: p.cp_ville_terrain,
        ref_cadastrale: p.ref_cadastrale, zone_plu: p.zone_plu, surface_parcelle: p.surface_parcelle,
        nom_etablissement: p.nom_etablissement, avant_trav: p.avant_trav, apres_trav: p.apres_trav,
        type_et_cat: p.type_et_cat, type_projet: p.type_projet, categorie_projet: p.categorie_projet,
        surface_plancher: p.surface_plancher, surface_plancher_ext: p.surface_plancher_ext,
        surface_erp: p.surface_erp, surface_ert: p.surface_ert, effectif_public: p.effectif_public,
        effectif_personnel: p.effectif_personnel, ind: p.ind, date_modification: p.date_modification,
        project_code: p.project_code, project_number: p.project_number, project_status: p.project_status,
        keywords: p.keywords, notes: p.notes,
        site_name: p.site_name, site_description: p.site_description, site_id: p.site_id,
        site_address_1: p.site_address_1, site_address_2: p.site_address_2, site_address_3: p.site_address_3,
        site_postbox: p.site_postbox, site_city: p.site_city, site_state: p.site_state,
        site_postcode: p.site_postcode, site_country: p.site_country,
        site_gross_perimeter: p.site_gross_perimeter, site_gross_area: p.site_gross_area,
        building_name: p.building_name, building_description: p.building_description, building_id: p.building_id,
        contact_fullname: p.contact_fullname, contact_prefixtitle: p.contact_prefixtitle,
        contact_givenname: p.contact_givenname, contact_middlename: p.contact_middlename,
        contact_familyname: p.contact_familyname, contact_suffixtitle: p.contact_suffixtitle,
        contact_nameorder: p.contact_nameorder, contact_id: p.contact_id || null,
        contact_role: p.contact_role, contact_department: p.contact_department,
        contact_company: p.contact_company, contact_companycode: p.contact_companycode,
        contact_fulladdress: p.contact_fulladdress, contact_address_1: p.contact_address_1,
        contact_address_2: p.contact_address_2, contact_address_3: p.contact_address_3,
        contact_postbox: p.contact_postbox, contact_city: p.contact_city,
        contact_state: p.contact_state, contact_postcode: p.contact_postcode,
        contact_country: p.contact_country, contact_email: p.contact_email,
        contact_phone: p.contact_phone, contact_fax: p.contact_fax, contact_web: p.contact_web,
        cad_technician_fullname: p.cad_technician_fullname, cad_technician_prefixtitle: p.cad_technician_prefixtitle,
        cad_technician_givenname: p.cad_technician_givenname, cad_technician_middlename: p.cad_technician_middlename,
        cad_technician_familyname: p.cad_technician_familyname, cad_technician_suffixtitle: p.cad_technician_suffixtitle,
        cad_technician_nameorder: p.cad_technician_nameorder,
        client_fullname: p.client_fullname, client_prefixtitle: p.client_prefixtitle,
        client_givenname: p.client_givenname, client_middlename: p.client_middlename,
        client_familyname: p.client_familyname, client_suffixtitle: p.client_suffixtitle,
        client_nameorder: p.client_nameorder, client_company: p.client_company,
        client_fulladdress: p.client_fulladdress, client_address_1: p.client_address_1,
        client_address_2: p.client_address_2, client_address_3: p.client_address_3,
        client_postbox: p.client_postbox, client_city: p.client_city, client_state: p.client_state,
        client_postcode: p.client_postcode, client_country: p.client_country,
        client_email: p.client_email, client_phone: p.client_phone, client_fax: p.client_fax,
        ed_report_header: p.ed_report_header, custom_building: p.custom_building,
        custom_architect: p.custom_architect, custom_client: p.custom_client,
        fee_distribution: p.fee_distribution
      }).eq('id', id);
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Replace specialties
      await supabaseAdmin.from('proposal_specialties').delete().eq('proposal_id', id);
      if (p.specialties_list && Array.isArray(p.specialties_list) && p.specialties_list.length > 0) {
        const specRows = p.specialties_list.map((spec: any) => ({
          id: `ps${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
          proposal_id: id,
          specialty_name: spec.specialty_name,
          contact_id: spec.contact_id || null
        }));
        const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specRows);
        if (specErr) return res.status(500).json({ error: specErr.message });
      }

      // Auto-create project when status changes to Accepted
      if (p.status === 'Accepted' && (oldProposal as any)?.status !== 'Accepted') {
        const projectId = `p${Date.now()}`;
        let clientName = 'Unknown Client';
        if (p.client_id) {
          const { data: clientData } = await supabaseAdmin
            .from('contacts').select('first_name, last_name').eq('id', p.client_id).single();
          if (clientData) clientName = `${clientData.first_name ?? ''} ${clientData.last_name ?? ''}`.trim();
        }

        const { error: projErr } = await supabaseAdmin.from('projects').insert({
          id: projectId, name: p.title, client: clientName, status: 'Planning',
          budget: p.amount, description: p.description,
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          address: p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : '',
          reference: p.reference, projet_detail: p.projet_detail, is_entreprise: !!p.is_entreprise,
          nom_societe: p.nom_societe, rcs: p.rcs, representant: p.representant, qualite: p.qualite,
          adresse_client: p.adresse_client, cp_client: p.cp_client, ville_client: p.ville_client,
          telephone: p.telephone, portable: p.portable, email_client: p.email_client,
          adresse_terrain: p.adresse_terrain, cp_ville_terrain: p.cp_ville_terrain,
          ban_id_terrain: p.ban_id_terrain, city_code_terrain: p.city_code_terrain,
          ref_cadastrale: p.ref_cadastrale, zone_plu: p.zone_plu, surface_parcelle: p.surface_parcelle,
          nom_etablissement: p.nom_etablissement, avant_trav: p.avant_trav, apres_trav: p.apres_trav,
          type_et_cat: p.type_et_cat, type_projet: p.type_projet, categorie_projet: p.categorie_projet,
          surface_plancher: p.surface_plancher, surface_plancher_ext: p.surface_plancher_ext,
          surface_erp: p.surface_erp, surface_ert: p.surface_ert, effectif_public: p.effectif_public,
          effectif_personnel: p.effectif_personnel, ind: p.ind, date_modification: p.date_modification
        });
        if (projErr) console.error("Error auto-creating project:", projErr.message);

        if (!projErr && p.specialties_list && Array.isArray(p.specialties_list) && p.specialties_list.length > 0) {
          const cotRows = p.specialties_list.map((spec: any) => ({
            id: `pc${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
            project_id: projectId,
            specialty: spec.specialty_name,
            contact_id: spec.contact_id || null
          }));
          await supabaseAdmin.from('project_cotraitants').insert(cotRows);
        }
      }

      const { data: proposal, error: proposalErr } = await supabaseAdmin
        .from('proposals')
        .select('*, contacts(first_name, last_name)')
        .eq('id', id)
        .single();
      if (proposalErr) return res.status(500).json({ error: proposalErr.message });

      const { data: specialties, error: specFetchErr } = await supabaseAdmin
        .from('proposal_specialties')
        .select('*, contacts(first_name, last_name)')
        .eq('proposal_id', id);
      if (specFetchErr) return res.status(500).json({ error: specFetchErr.message });

      const contact = (proposal as any)?.contacts;
      res.json({
        ...proposal,
        client_name: contact ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim() : null,
        specialties_list: (specialties ?? []).map((s: any) => ({
          ...s,
          contact_name: s.contacts ? `${s.contacts.first_name ?? ''} ${s.contacts.last_name ?? ''}`.trim() : null
        }))
      });
    } catch (error: any) {
      console.error("Error updating proposal:", error);
      res.status(500).json({ error: "Failed to update proposal: " + error.message });
    }
  });

  app.get("/api/proposals/:id/export", async (req, res) => {
    const { data: proposal, error: propErr } = await supabaseAdmin.from('proposals').select('*').eq('id', req.params.id).single();
    if (propErr || !proposal) return res.status(404).json({ error: "Proposal not found" });

    const xml = proposalToXml(proposal as any);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename=proposal_${(proposal as any).id}.xml`);
    res.send(xml);
  });

  app.post("/api/proposals/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const xml = req.file.buffer.toString();
      const proposalData = xmlToProposal(xml);

      const id = `prop${Date.now()}`;
      const created_at = new Date().toISOString();

      const { error: insertErr } = await supabaseAdmin.from('proposals').insert({
        id,
        title: proposalData.title || 'Imported Proposal',
        description: proposalData.description || '',
        created_at,
        status: 'Draft',
      });
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      res.json({ success: true, id });
    } catch (error: any) {
      console.error("Error importing proposal:", error);
      res.status(500).json({ error: "Failed to import proposal: " + error.message });
    }
  });

  app.get("/api/invoices", async (req, res) => {
    try {
      const { data: invoices, error: invErr } = await supabaseAdmin
        .from('invoices')
        .select('*, projects(name)')
        .order('created_at', { ascending: false });
      if (invErr) return res.status(500).json({ error: invErr.message });

      const invoicesWithItems = await Promise.all((invoices ?? []).map(async (inv: any) => {
        const { data: items } = await supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', inv.id);
        return { ...inv, items: items ?? [] };
      }));

      res.json(invoicesWithItems);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const {
        project_id, amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        items
      } = req.body;

      const id = `inv${Date.now()}`;
      const created_at = new Date().toISOString();

      // Fetch default seller info from settings if not provided
      let finalSellerName = seller_name;
      let finalSellerAddress = seller_address;
      let finalSellerSiret = seller_siret;
      let finalSellerVatNumber = seller_vat_number;
      let finalSellerIban = seller_iban;
      let finalSellerBic = seller_bic;

      if (!finalSellerName || !finalSellerAddress || !finalSellerSiret) {
        const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('id', 'main').single();
        if (settings) {
          finalSellerName = finalSellerName || settings.agencyName;
          finalSellerAddress = finalSellerAddress || settings.address;
          finalSellerSiret = finalSellerSiret || settings.siret;
          finalSellerVatNumber = finalSellerVatNumber || settings.vatNumber;
          finalSellerIban = finalSellerIban || settings.seller_iban;
          finalSellerBic = finalSellerBic || settings.seller_bic;
        }
      }

      const { error: insertErr } = await supabaseAdmin.from('invoices').insert({
        id,
        invoice_number: invoice_number || null,
        project_id,
        amount: amount || 0,
        tax_amount: tax_amount || 0,
        total_amount: total_amount || 0,
        status: status || 'Draft',
        due_date,
        issue_date: issue_date || created_at.split('T')[0],
        description: description || '',
        created_at,
        seller_name: finalSellerName || null,
        seller_address: finalSellerAddress || null,
        seller_siret: finalSellerSiret || null,
        seller_vat_number: finalSellerVatNumber || null,
        seller_iban: finalSellerIban || null,
        seller_bic: finalSellerBic || null,
        vat_rate: vat_rate || 20,
      });
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      if (items && Array.isArray(items)) {
        const itemRows = items.map((item: any) => ({
          id: item.id || `ii${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
          invoice_id: id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
        }));
        const { error: itemsErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
        if (itemsErr) return res.status(500).json({ error: itemsErr.message });
      }

      const { data: invoice, error: fetchErr } = await supabaseAdmin
        .from('invoices')
        .select('*, projects(name)')
        .eq('id', id)
        .single();
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      const { data: savedItems } = await supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', id);
      res.status(201).json({ ...invoice, items: savedItems ?? [] });
    } catch (error: any) {
      console.error("Error creating invoice:", error);
      res.status(500).json({ error: "Failed to create invoice: " + error.message });
    }
  });

  app.put("/api/invoices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        amount, description, status, due_date,
        invoice_number, tax_amount, total_amount, issue_date,
        seller_name, seller_address, seller_siret, seller_vat_number, seller_iban, seller_bic, vat_rate,
        items
      } = req.body;

      const { error: updateErr } = await supabaseAdmin.from('invoices').update({
        amount: amount || 0,
        description: description || '',
        status: status || 'Draft',
        due_date: due_date || null,
        invoice_number: invoice_number || null,
        tax_amount: tax_amount || 0,
        total_amount: total_amount || 0,
        issue_date: issue_date || null,
        seller_name: seller_name || null,
        seller_address: seller_address || null,
        seller_siret: seller_siret || null,
        seller_vat_number: seller_vat_number || null,
        seller_iban: seller_iban || null,
        seller_bic: seller_bic || null,
        vat_rate: vat_rate || 20,
      }).eq('id', id);
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      if (items && Array.isArray(items)) {
        // Simplified: delete and recreate items
        const { error: delErr } = await supabaseAdmin.from('invoice_items').delete().eq('invoice_id', id);
        if (delErr) return res.status(500).json({ error: delErr.message });
        const itemRows = items.map((item: any) => ({
          id: item.id || `ii${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
          invoice_id: id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
        }));
        const { error: itemsErr } = await supabaseAdmin.from('invoice_items').insert(itemRows);
        if (itemsErr) return res.status(500).json({ error: itemsErr.message });
      }

      const { data: invoice, error: fetchErr } = await supabaseAdmin
        .from('invoices')
        .select('*, projects(name)')
        .eq('id', id)
        .single();
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      const { data: savedItems } = await supabaseAdmin.from('invoice_items').select('*').eq('invoice_id', id);
      res.json({ ...invoice, items: savedItems ?? [] });
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: "Failed to update invoice: " + error.message });
    }
  });

  app.post("/api/contact-categories", async (req, res) => {
    try {
      const { id, name } = req.body;
      const { error } = await supabaseAdmin.from('contact_categories').insert({ id, name });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create contact category" });
    }
  });

  app.delete("/api/contact-categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('contact_categories').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to delete contact category" });
    }
  });

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
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
      const { lon, lat } = req.query;
      console.log(`[Cadastre] Lookup request: lon=${lon}, lat=${lat}`);
      
      if (!lon || !lat) {
        return res.status(400).json({ error: "Missing longitude or latitude parameters" });
      }

      const apiUrl = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=%7B%22type%22%3A%22Point%22%2C%22coordinates%22%3A%5B${lon}%2C${lat}%5D%7D`;
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
          properties: {
            id: id15,
            section: id15.substring(8, 10),
            numero: id15.substring(10),
            prefixe: id15.substring(5, 8),
            commune: urlCommune,
            insee: p.code_insee || urlCommune
          }
        };
      });

      console.log(`[Cadastre] Success: Found ${mappedFeatures.length} parcels`);
      res.json({ features: mappedFeatures });
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

  app.post("/api/send-email", async (req, res) => {
    try {
      const { to, subject, text, html, attachments, userEmail } = req.body;
      
      // Get settings from DB
      const { data: settings, error: settingsErr } = await supabaseAdmin
        .from('settings').select('*').eq('id', 'main').single();
      if (settingsErr || !settings) {
        return res.status(500).json({ error: "Settings not found" });
      }

      const smtpHost = settings.smtpHost || process.env.SMTP_HOST;
      const smtpPort = settings.smtpPort || process.env.SMTP_PORT || '587';
      const smtpUser = settings.smtpUser || process.env.SMTP_USER;
      const smtpPass = settings.smtpPass || process.env.SMTP_PASS;

      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(500).json({ error: "Configuration SMTP manquante" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort)),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const from = settings.senderOption === 'personal' ? userEmail : settings.email;
      const cc = settings.senderOption === 'personal' ? settings.email : undefined;

      await transporter.sendMail({
        from,
        to,
        cc,
        subject,
        text,
        html,
        attachments
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email: " + error.message });
    }
  });

  app.get("/api/projects/:projectId/reports", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { data: reports, error } = await supabaseAdmin
        .from('site_reports').select('*').eq('project_id', projectId).order('date', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      const parsedReports = (reports ?? []).map((report: any) => {
        let stakeholders = [];
        try { stakeholders = report.stakeholders ? JSON.parse(report.stakeholders) : []; } catch (e) { console.error("Error parsing stakeholders:", e); }
        let companies = [];
        try { companies = report.companies ? JSON.parse(report.companies) : []; } catch (e) { console.error("Error parsing companies:", e); }
        return { ...report, stakeholders, companies };
      });
      res.json(parsedReports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/projects/:projectId/reports", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { date, report_number } = req.body;
      const id = `sr${Date.now()}`;

      const { error: insertErr } = await supabaseAdmin
        .from('site_reports').insert({ id, project_id: projectId, date, report_number });
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      // Copy open tasks from previous report
      const { data: previousReport } = await supabaseAdmin
        .from('site_reports').select('*').eq('project_id', projectId).neq('id', id)
        .order('date', { ascending: false }).limit(1).single();
      if (previousReport) {
        const { data: openNotes } = await supabaseAdmin
          .from('site_report_notes').select('*').eq('report_id', previousReport.id).eq('status', 'open');
        if (openNotes && openNotes.length > 0) {
          const noteRows = openNotes.map((note: any) => ({
            id: `sn${Date.now()}${Math.random()}`,
            report_id: id,
            category: note.category,
            note_number: note.note_number,
            responsible_company: note.responsible_company,
            issue_date: note.issue_date,
            due_date: note.due_date,
            status: 'open',
          }));
          const { error: notesErr } = await supabaseAdmin.from('site_report_notes').insert(noteRows);
          if (notesErr) return res.status(500).json({ error: notesErr.message });
        }
      }

      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create report" });
    }
  });

  app.get("/api/reports/:reportId/notes", async (req, res) => {
    try {
      const { reportId } = req.params;
      const { data: notes, error } = await supabaseAdmin
        .from('site_report_notes').select('*').eq('report_id', reportId);
      if (error) return res.status(500).json({ error: error.message });
      res.json(notes ?? []);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.post("/api/reports/:reportId/notes", async (req, res) => {
    try {
      const { reportId } = req.params;
      const { category, note_number, responsible_company, issue_date, due_date } = req.body;
      const id = `sn${Date.now()}`;
      const { error } = await supabaseAdmin.from('site_report_notes').insert({
        id, report_id: reportId, category, note_number, responsible_company, issue_date, due_date,
      });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  app.put("/api/reports/:reportId", async (req, res) => {
    try {
      const { reportId } = req.params;
      const { pageFormat, stakeholders, companies, meetingNotes, nextMeeting } = req.body;

      const { error: updateErr } = await supabaseAdmin.from('site_reports').update({
        pageFormat: pageFormat || null,
        stakeholders: JSON.stringify(stakeholders || []),
        companies: JSON.stringify(companies || []),
        meetingNotes: meetingNotes || null,
        nextMeeting: nextMeeting || null,
      }).eq('id', reportId);
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      const { data: updatedReport, error: fetchErr } = await supabaseAdmin
        .from('site_reports').select('*').eq('id', reportId).single();
      if (fetchErr) return res.status(500).json({ error: fetchErr.message });

      res.json({
        ...updatedReport,
        stakeholders: (() => { try { return updatedReport.stakeholders ? JSON.parse(updatedReport.stakeholders) : []; } catch (e) { console.error("Error parsing stakeholders:", e); return []; } })(),
        companies: (() => { try { return updatedReport.companies ? JSON.parse(updatedReport.companies) : []; } catch (e) { console.error("Error parsing companies:", e); return []; } })()
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update report" });
    }
  });

  app.put("/api/notes/:noteId", async (req, res) => {
    try {
      const { noteId } = req.params;
      const { category, responsible_company, text, status, due_date, realization_date } = req.body;
      const { error } = await supabaseAdmin.from('site_report_notes').update({
        category, responsible_company, text, status, due_date, realization_date,
      }).eq('id', noteId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:noteId", async (req, res) => {
    try {
      const { noteId } = req.params;
      const { error } = await supabaseAdmin.from('site_report_notes').delete().eq('id', noteId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  app.get("/api/projects/:projectId/cctp", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { data: cctp, error } = await supabaseAdmin
        .from('cctps').select('*').eq('project_id', projectId).single();
      if (error) return res.status(404).json({ error: "CCTP not found" });
      res.json(JSON.parse(cctp.data));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch CCTP" });
    }
  });

  app.post("/api/projects/:projectId/cctp", async (req, res) => {
    try {
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? `cctp${Date.now()}` : data.id;
      data.id = id;

      const { data: existing } = await supabaseAdmin
        .from('cctps').select('id').eq('project_id', projectId).single();
      if (existing) {
        const { error } = await supabaseAdmin.from('cctps').update({ data: JSON.stringify(data) }).eq('project_id', projectId);
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supabaseAdmin.from('cctps').insert({ id, project_id: projectId, data: JSON.stringify(data) });
        if (error) return res.status(500).json({ error: error.message });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save CCTP" });
    }
  });

  app.get("/api/projects/:projectId/dpgf", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { data: dpgf, error } = await supabaseAdmin
        .from('dpgfs').select('*').eq('project_id', projectId).single();
      if (error) return res.status(404).json({ error: "DPGF not found" });
      res.json(JSON.parse(dpgf.data));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DPGF" });
    }
  });

  app.post("/api/projects/:projectId/dpgf", async (req, res) => {
    try {
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? `dpgf${Date.now()}` : data.id;
      data.id = id;

      const { data: existing } = await supabaseAdmin
        .from('dpgfs').select('id').eq('project_id', projectId).single();
      if (existing) {
        const { error } = await supabaseAdmin.from('dpgfs').update({ data: JSON.stringify(data) }).eq('project_id', projectId);
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supabaseAdmin.from('dpgfs').insert({ id, project_id: projectId, data: JSON.stringify(data) });
        if (error) return res.status(500).json({ error: error.message });
      }
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to save DPGF" });
    }
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const { data: settings, error } = await supabaseAdmin
        .from('settings').select('*').eq('id', 'main').single();
      if (error) return res.json({ id: 'main' });
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const data = req.body;
      const validColumns = ['agencyName', 'address', 'phone', 'email', 'siret', 'vatNumber', 'currency', 'language', 'senderOption', 'defaultEmailTemplate', 'logoUrl', 'seller_iban', 'seller_bic', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass'];
      const filteredData = Object.keys(data)
        .filter(k => validColumns.includes(k))
        .reduce((obj, key) => {
          obj[key] = data[key];
          return obj;
        }, {} as any);

      if (Object.keys(filteredData).length === 0) {
        return res.json({ success: true });
      }

      const { data: existing } = await supabaseAdmin
        .from('settings').select('id').eq('id', 'main').single();
      if (existing) {
        const { error } = await supabaseAdmin.from('settings').update(filteredData).eq('id', 'main');
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supabaseAdmin.from('settings').insert({ ...filteredData, id: 'main' });
        if (error) return res.status(500).json({ error: error.message });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  app.post("/api/test-smtp", async (req, res) => {
    try {
      const { smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
      
      if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(400).json({ error: "Missing SMTP configuration" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(String(smtpPort) || '587'),
        secure: String(smtpPort) === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: `"ArchiManager Test" <${smtpUser}>`,
        to: smtpUser,
        subject: "ArchiManager SMTP Test",
        text: "This is a test email from ArchiManager to verify your SMTP configuration.",
        html: "<b>This is a test email from ArchiManager to verify your SMTP configuration.</b>"
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/lots", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { data: lots, error } = await supabaseAdmin
        .from('project_lots').select('*').eq('project_id', projectId);
      if (error) return res.status(500).json({ error: error.message });
      res.json(lots ?? []);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/projects/:projectId/lots", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { id, lot_number, lot_title } = req.body;
      const lotId = id || `lot${Date.now()}`;
      const { error } = await supabaseAdmin.from('project_lots').insert({
        id: lotId, project_id: projectId, lot_number, lot_title
      });
      if (error) return res.status(500).json({ error: error.message });
      res.status(201).json({ id: lotId });
    } catch (error) {
      res.status(500).json({ error: "Failed to create lot" });
    }
  });

  app.delete("/api/lots/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_lots').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete lot" });
    }
  });

  // Auth routes
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, full_name } = req.body;
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name, system_role: 'user' }
      });
      if (error) return res.status(400).json({ error: error.message });
      res.status(201).json({ user: data.user });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: error.message });
      res.json({ user: data.user, session: data.session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { data: member } = await supabaseAdmin
        .from('team_members').select('*').eq('auth_user_id', req.user!.id).single();
      res.json({ user: req.user, profile: member ?? null });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { full_name, ...rest } = req.body;
      if (full_name) {
        await supabaseAdmin.auth.admin.updateUserById(req.user!.id, {
          user_metadata: { full_name }
        });
      }
      const { data, error } = await supabaseAdmin
        .from('team_members').update(rest).eq('auth_user_id', req.user!.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  // Vite middleware for development
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom", // Disable Vite's own SPA fallback
    });
    app.use(vite.middlewares);

    // Custom SPA fallback for dev
    app.use("*", async (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

  } else {
    // Production serving
    app.use(express.static(distPath));

    // Specifically handle missing assets (like CSS, JS, etc.) to avoid sending index.html and causing loops
    app.use((req, res, next) => {
      // If request has a file extension, do not fall back to index.html
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      next();
    });

    // SPA fallback for production
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Start listening after all middleware is set up
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
