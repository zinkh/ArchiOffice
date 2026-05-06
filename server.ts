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

// Validate required server-side environment variables (Supabase service role)
// These are required for server to start. Vite client variables (VITE_*) should be configured separately.
(() => {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing required server environment variables:', missing.join(', '));
    console.error('Please set these in Cloud Run secrets or your .env file. See https://supabase.com/docs/guides/getting-started/api-keys');
    // Exit with non-zero code to fail fast on startup
    process.exit(1);
  }
})();


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

  // ... rest of the file unchanged (omitted here for brevity) ...

  // Start listening after all middleware is set up
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
