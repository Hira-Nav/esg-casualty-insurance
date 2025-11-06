import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts";

/**
 * ESG–Casualty Risk Dashboard (Vercel-ready, Leaflet via CDN — no react-leaflet)
 * -----------------------------------------------------------------------------
 * - Vanilla Leaflet loaded from CDN (CSS + JS) to avoid SSR/bundler issues.
 * - Geocoding fallback: if a company's lat/lon is missing, snap to country centroid by ISO-2 `geo` code.
 */

// ---------- Minimal CSV parser (simple, no quoted comma support) ----------
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(",");
      const row = {};
      headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
      return row;
    });
}

// ---------- Sample fallback data ----------
const SAMPLE_PORTFOLIO = [
  { industry: "Chemicals", companies: 38, avg_EHEI: 0.72, pct_high_risk: 0.44 },
  { industry: "Construction", companies: 36, avg_EHEI: 0.64, pct_high_risk: 0.39 },
  { industry: "Energy", companies: 42, avg_EHEI: 0.61, pct_high_risk: 0.33 },
  { industry: "Pharmaceuticals", companies: 33, avg_EHEI: 0.49, pct_high_risk: 0.22 },
  { industry: "Consumer Goods", companies: 39, avg_EHEI: 0.41, pct_high_risk: 0.18 },
];

const SAMPLE_FEATURES = [
  { feature: "climate_risk", importance: 0.26 },
  { feature: "worker_incidents_per_1k", importance: 0.21 },
  { feature: "hazardous_material_exposure", importance: 0.18 },
  { feature: "compliance_fines_musd", importance: 0.13 },
  { feature: "revenue_usd_m", importance: 0.09 },
  { feature: "G_score", importance: 0.07 },
  { feature: "S_score", importance: 0.04 },
  { feature: "E_score", importance: 0.02 },
];

const SAMPLE_COMPANIES = [
  { company_id: "C0001", company: "Company_0001", industry: "Chemicals", EHEI: 0.86, is_high_risk: 1, geo: "FR", lat: 48.85, lon: 2.35 },
  { company_id: "C0002", company: "Company_0002", industry: "Construction", EHEI: 0.74, is_high_risk: 1, geo: "UK", lat: 51.51, lon: -0.13 },
  { company_id: "C0003", company: "Company_0003", industry: "Energy", EHEI: 0.68, is_high_risk: 1, geo: "DE", lat: 52.52, lon: 13.4 },
  { company_id: "C0004", company: "Company_0004", industry: "Pharmaceuticals", EHEI: 0.41, is_high_risk: 0, geo: "IE", lat: 53.35, lon: -6.26 },
  { company_id: "C0005", company: "Company_0005", industry: "Consumer Goods", EHEI: 0.37, is_high_risk: 0, geo: "ES", lat: 40.42, lon: -3.7 },
  { company_id: "C0006", company: "Company_0006", industry: "Chemicals", EHEI: 0.79, is_high_risk: 1, geo: "IT", lat: 45.46, lon: 9.19 },
  { company_id: "C0007", company: "Company_0007", industry: "Energy", EHEI: 0.63, is_high_risk: 1, geo: "PL", lat: 52.23, lon: 21.01 },
  { company_id: "C0008", company: "Company_0008", industry: "Construction", EHEI: 0.58, is_high_risk: 0, geo: "SE", lat: 59.33, lon: 18.07 },
];

// ---------- UI helpers ----------
const card = { boxShadow: "0 8px 24px rgba(0,0,0,.08)", borderRadius: 16, padding: 16, background: "#fff" };
const hstack = { display: "flex", gap: 16, alignItems: "stretch", flexWrap: "wrap" };
const vstack = { display: "flex", gap: 16, flexDirection: "column" };

// ---------- LeafletVanillaMap (CDN Leaflet, no bundler deps) ----------
function LeafletVanillaMap({ points, colorFor, height = 420 }) {
  const mapRef = useRef(null); // container div
  const leafletMap = useRef(null);
  const markersLayer = useRef(null);

  // Inject Leaflet CSS & JS once
  useEffect(() => {
    const cssId = "leaflet-css";
    const jsId = "leaflet-js";

    function ensureLink() {
      if (!document.getElementById(cssId)) {
        const link = document.createElement("link");
        link.id = cssId;
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }
    }
    function ensureScript() {
      return new Promise((resolve, reject) => {
        if (window.L) return resolve(window.L);
        if (document.getElementById(jsId)) {
          const el = document.getElementById(jsId);
          el.addEventListener("load", () => resolve(window.L));
          el.addEventListener("error", reject);
          return;
        }
        const script = document.createElement("script");
        script.id = jsId;
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.async = true;
        script.onload = () => resolve(window.L);
        script.onerror = reject;
        document.body.appendChild(script);
      });
    }

    ensureLink();
    let cancelled = false;
    ensureScript()
      .then((L) => {
        if (cancelled || !mapRef.current) return;
        // init map
        leafletMap.current = L.map(mapRef.current, { center: [50, 10], zoom: 4, zoomControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(leafletMap.current);
        markersLayer.current = L.layerGroup().addTo(leafletMap.current);
      })
      .catch((err) => console.warn("Leaflet failed to load", err));

    return () => {
      cancelled = true;
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Update markers when points change
  useEffect(() => {
    if (!window.L || !leafletMap.current || !markersLayer.current) return;
    const L = window.L;
    markersLayer.current.clearLayers();
    const bounds = [];
    points.forEach((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
      const color = colorFor(p.EHEI);
      const circle = L.circleMarker([p.lat, p.lon], {
        radius: Math.max(6, Math.round(12 * Number(p.EHEI))),
        color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1,
      }).bindPopup(
        `<div style="min-width:180px"><strong>${p.company}</strong><br/>Industry: ${p.industry}<br/>EHEI: ${Number(p.EHEI).toFixed(2)}<br/>High Risk: ${String(p.is_high_risk) === "1" ? "Yes" : "No"}</div>`
      );
      circle.addTo(markersLayer.current);
      bounds.push([p.lat, p.lon]);
    });
    if (bounds.length) leafletMap.current.fitBounds(bounds, { padding: [24, 24] });
  }, [points, colorFor]);

  return <div ref={mapRef} style={{ width: "100%", height, borderRadius: 12, overflow: "hidden", background: "#0b1220" }} />;
}

export default function App() {
  const [portfolio, setPortfolio] = useState(SAMPLE_PORTFOLIO);
  const [features, setFeatures] = useState(SAMPLE_FEATURES);
  const [companies, setCompanies] = useState(SAMPLE_COMPANIES);
  const [industryFilter, setIndustryFilter] = useState("All");

  // Country/region centroid lookup (used when lat/lon missing)
  const CENTROIDS = useMemo(() => ({
    AT: [47.5162, 14.5501], BE: [50.5039, 4.4699], BG: [42.7339, 25.4858],
    CH: [46.8182, 8.2275], CY: [35.1264, 33.4299], CZ: [49.8175, 15.4730],
    DE: [51.1657, 10.4515], DK: [56.2639, 9.5018], EE: [58.5953, 25.0136],
    ES: [40.4637, -3.7492], FI: [61.9241, 25.7482], FR: [46.2276, 2.2137],
    GB: [55.3781, -3.4360], UK: [55.3781, -3.4360], GR: [39.0742, 21.8243],
    HR: [45.1000, 15.2000], HU: [47.1625, 19.5033], IE: [53.1424, -7.6921],
    IS: [64.9631, -19.0208], IT: [41.8719, 12.5674], LT: [55.1694, 23.8813],
    LU: [49.8153, 6.1296], LV: [56.8796, 24.6032], MT: [35.9375, 14.3754],
    NL: [52.1326, 5.2913], NO: [60.4720, 8.4689], PL: [51.9194, 19.1451],
    PT: [39.3999, -8.2245], RO: [45.9432, 24.9668], SE: [60.1282, 18.6435],
    SI: [46.1512, 14.9955], SK: [48.6690, 19.6990]
  }), []);

  const industries = useMemo(
    () => ["All", ...Array.from(new Set([...SAMPLE_PORTFOLIO.map((d) => d.industry), ...companies.map((c) => c.industry)]))],
    [companies]
  );

  const kpis = useMemo(() => {
    const rows = industryFilter === "All" ? companies : companies.filter((c) => c.industry === industryFilter);
    const totalCompanies = rows.length || 0;
    const high = rows.filter((c) => String(c.is_high_risk) === "1").length;
    const highPct = totalCompanies ? (high / totalCompanies) * 100 : 0;
    const avgEHEI = rows.reduce((a, c) => a + (Number(c.EHEI) || 0), 0) / (totalCompanies || 1);
    return { totalCompanies, highPct: +highPct.toFixed(1), avgEHEI: +avgEHEI.toFixed(2) };
  }, [companies, industryFilter]);

  const topCompanies = useMemo(() => {
    const rows = industryFilter === "All" ? companies : companies.filter((c) => c.industry === industryFilter);
    return [...rows]
      .map((c) => ({ ...c, EHEI: Number(c.EHEI) }))
      .sort((a, b) => b.EHEI - a.EHEI)
      .slice(0, 10);
  }, [companies, industryFilter]);

  const filteredPortfolio = useMemo(() => {
    if (industryFilter === "All") return portfolio;
    return portfolio.filter((p) => p.industry === industryFilter);
  }, [portfolio, industryFilter]);

  // File upload handlers
  const onUploadPortfolio = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);
    const clean = rows
      .filter((r) => r.industry)
      .map((r) => ({
        industry: r.industry,
        companies: Number(r.companies || 0),
        avg_EHEI: Number(r.avg_EHEI || r.avg_ehei || 0),
        pct_high_risk: Number(r.pct_high_risk || r.percent_high_risk || 0),
      }));
    if (clean.length) setPortfolio(clean);
  };

  const onUploadFeatures = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);
    const clean = rows
      .filter((r) => r.feature)
      .map((r) => ({ feature: r.feature, importance: Number(r.importance || 0) }));
    if (clean.length) setFeatures(clean);
  };

  const onUploadCompanies = async (file) => {
    const text = await file.text();
    const rows = parseCSV(text);
    const clean = rows
      .filter((r) => r.company)
      .map((r) => ({
        company_id: r.company_id || r.id || "",
        company: r.company,
        industry: r.industry || "",
        EHEI: Number(r.EHEI || r.ehei || 0),
        is_high_risk: String(r.is_high_risk || r.high || 0),
        geo: r.geo || r.region || "",
        lat: r.lat === undefined && r.latitude === undefined ? null : Number(r.lat || r.latitude || 0),
        lon: r.lon === undefined && r.longitude === undefined ? null : Number(r.lon || r.longitude || 0),
      }));
    if (clean.length) setCompanies(clean);
  };

  // Color helper for EHEI
  const colorFor = (ehei) => {
    if (ehei >= 0.75) return "#ef4444"; // red
    if (ehei >= 0.6) return "#f59e0b"; // amber
    if (ehei >= 0.45) return "#eab308"; // yellow
    return "#22c55e"; // green
  };

  // Build map points; if lat/lon missing, snap to country centroid using `geo`
  const mapPoints = useMemo(() => {
    const rows = industryFilter === "All" ? companies : companies.filter((c) => c.industry === industryFilter);
    return rows
      .map((r) => {
        let lat = Number.isFinite(r.lat) ? r.lat : null;
        let lon = Number.isFinite(r.lon) ? r.lon : null;
        let placement = "exact";
        if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && r.geo && CENTROIDS[r.geo]) {
          const [clat, clon] = CENTROIDS[r.geo];
          lat = clat; lon = clon; placement = "centroid";
        }
        return lat != null && lon != null ? { ...r, lat, lon, placement } : null;
      })
      .filter(Boolean);
  }, [companies, industryFilter, CENTROIDS]);

  // ---------------- Self-Checks / "Tests" ----------------
  useEffect(() => {
    const eps = 1e-6;
    const inRange = (x) => typeof x === "number" && x >= -eps && x <= 1 + eps;
    console.assert(Array.isArray(companies), "companies should be an array");
    companies.slice(0, 5).forEach((c) => {
      console.assert(typeof c.company === "string", "company should be string");
      console.assert(inRange(Number(c.EHEI)), "EHEI should be in [0,1]");
    });
    // CSV parser smoke test
    const csv = `industry,companies,avg_EHEI,pct_high_risk\nTest,5,0.5,0.2`;
    const parsed = parseCSV(csv);
    console.assert(parsed.length === 1 && parsed[0].industry === "Test", "CSV parser smoke test failed");
    // Centroid fallback tests
    const rows = [
      { company: "X", industry: "Chemicals", EHEI: 0.5, is_high_risk: 0, geo: "FR" },
      { company: "Y", industry: "Energy", EHEI: 0.7, is_high_risk: 1, geo: "UK" },
      { company: "Z", industry: "Energy", EHEI: 0.3, is_high_risk: 0, geo: "ZZ" }, // unknown
    ];
    const toPoints = (rs) => rs.map((r) => {
      let lat = null, lon = null, placement = "exact";
      if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && r.geo && CENTROIDS[r.geo]) {
        const [clat, clon] = CENTROIDS[r.geo]; lat = clat; lon = clon; placement = "centroid";
      }
      return lat != null && lon != null ? { ...r, lat, lon, placement } : null;
    }).filter(Boolean);
    const pts = toPoints(rows);
    console.assert(pts.length === 2 && pts.every(p => p.placement === "centroid"), "Centroid fallback failed");
  }, [companies, CENTROIDS]);

  // Table cell styles
  const th = { textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" };
  const td = { padding: 10, borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ padding: 24, minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", color: "#e2e8f0" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>ESG–Casualty Risk Dashboard</h1>
          <p style={{ opacity: 0.9, marginTop: 8 }}>
            Interactive portfolio view with <strong>map</strong>, industry slicer, KPIs, and model explainers. Upload the CSVs to replace sample data.
          </p>
        </header>

        {/* About card */}
        <section style={{ ...card, background: "#111827", color: "#e5e7eb", marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>About this dashboard</h3>
          <p>
            This dashboard serves casualty insurance analysts, product managers, and data-ops teams by translating ESG and hazard signals into actionable portfolio insights. It highlights where liability exposure may concentrate (by industry, geography, and company), helping underwriting and aggregation teams prioritize due diligence, controls, and capacity allocation.
          </p>
        </section>

        {/* Upload + slicer */}
        <section style={{ ...card, background: "#111827", color: "#e5e7eb", marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>Upload Data (optional) & Industry Slicer</h3>
          <div style={{ ...hstack, alignItems: "flex-end" }}>
            <div style={vstack}>
              <label>portfolio_aggregation_by_industry.csv</label>
              <input type="file" accept=".csv" onChange={(e) => e.target.files[0] && onUploadPortfolio(e.target.files[0])} />
            </div>
            <div style={vstack}>
              <label>model_feature_importance.csv</label>
              <input type="file" accept=".csv" onChange={(e) => e.target.files[0] && onUploadFeatures(e.target.files[0])} />
            </div>
            <div style={vstack}>
              <label>esg_casualty_companies.csv</label>
              <input type="file" accept=".csv" onChange={(e) => e.target.files[0] && onUploadCompanies(e.target.files[0])} />
            </div>
            <div style={vstack}>
              <label>Filter by Industry</label>
              <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} style={{ padding: 8, borderRadius: 8 }}>
                {industries.map((ind) => (
                  <option key={ind} value={ind}>{ind}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* KPI cards */}
        <section style={{ ...hstack, marginBottom: 24 }}>
          <div style={{ ...card, flex: 1, background: "#111827", color: "#e5e7eb" }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Total Companies</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{kpis.totalCompanies}</div>
          </div>
          <div style={{ ...card, flex: 1, background: "#111827", color: "#e5e7eb" }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>% High Risk</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{kpis.highPct}%</div>
          </div>
          <div style={{ ...card, flex: 1, background: "#111827", color: "#e5e7eb" }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Avg EHEI</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{kpis.avgEHEI}</div>
          </div>
        </section>

        {/* MAP PANEL (Leaflet via CDN) */}
        <section style={{ ...card, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>Interactive Map — High-Risk Areas & Companies</h3>
          <p style={{ marginTop: 0, color: "#334155" }}>Familiar Leaflet map with OSM tiles. Markers are sized/colored by EHEI; companies lacking coordinates are placed at country centroids when a valid GEO code is present. Use the industry slicer above to focus the view.</p>
          <LeafletVanillaMap points={mapPoints} colorFor={colorFor} />
        </section>

        {/* Industry risk chart */}
        <section style={{ ...card, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>High-Risk % by Industry</h3>
          <p style={{ marginTop: 0, color: "#334155" }}>Compares portfolio share of companies flagged as High casualty risk across industries.</p>
          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={filteredPortfolio.map((d) => ({ ...d, pct: Math.round(Number(d.pct_high_risk) * 100) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="industry" />
                <YAxis unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend />
                <Bar dataKey="pct" name="High Risk %" fill="#6366f1">
                  <LabelList dataKey="pct" position="top" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Feature importances */}
        <section style={{ ...card, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>Feature Importances</h3>
          <p style={{ marginTop: 0, color: "#334155" }}>Ranks model drivers contributing most to High-risk classification on the current dataset.</p>
          <div style={{ width: "100%", height: 360 }}>
            <ResponsiveContainer>
              <BarChart data={[...features].sort((a, b) => a.importance - b.importance)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="feature" width={180} />
                <Tooltip />
                <Bar dataKey="importance" name="Importance" fill="#14b8a6">
                  <LabelList dataKey="importance" position="right" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Top companies table */}
        <section style={{ ...card, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>Top Companies by EHEI</h3>
          <p style={{ marginTop: 0, color: "#334155" }}>Lists the companies with the highest modeled hazard exposure index (EHEI) after ESG mitigation.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={th}>Company</th>
                  <th style={th}>Industry</th>
                  <th style={th}>EHEI</th>
                  <th style={th}>High Risk?</th>
                  <th style={th}>Region</th>
                </tr>
              </thead>
              <tbody>
                {topCompanies.map((c) => (
                  <tr key={c.company_id}>
                    <td style={td}>{c.company}</td>
                    <td style={td}>{c.industry}</td>
                    <td style={td}>{c.EHEI.toFixed ? c.EHEI.toFixed(2) : Number(c.EHEI).toFixed(2)}</td>
                    <td style={td}>{String(c.is_high_risk) === "1" ? "Yes" : "No"}</td>
                    <td style={td}>{c.geo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* EHEI formula & Data provenance */}
        <section style={{ ...card, marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, color: "#0f172a" }}>EHEI Formula & Data Notes</h3>
          <p style={{ marginTop: 0, color: "#334155" }}>Shows how the hazard exposure index is constructed and where the demo data comes from.</p>
          <div style={{ background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 12 }}>
            <pre style={{ margin: 0 }}>{`EHEI = 0.40·ClimateRisk + 0.25·WorkerIncidents + 0.20·ComplianceFines + 0.15·HazardExposure\nEHEI = EHEI × (1 − 0.6·ESG_Mitigation);   ESG_Mitigation = 0.35·E + 0.35·S + 0.30·G (scaled 0–1)`}</pre>
          </div>
          <p style={{ color: "#334155", marginTop: 8 }}>
            <strong>Where is this from?</strong> The EHEI is a prototype metric we designed for this demo, grounded in casualty-liability drivers (climate/physical hazards, worker safety, regulatory/compliance, and product/hazard exposure), with ESG acting as a mitigation factor. It is <em>not</em> copied from a single publication; it’s a transparent, explainable construct intended for model product exploration.
          </p>
          <p style={{ color: "#334155" }}>
            <strong>Synthetic data source:</strong> Generated programmatically for 300 companies across 8 industries and 5 regions using domain-informed assumptions (e.g., higher incidents in Construction, higher hazardous exposure in Chemicals). Replace with your real CSV exports to switch the dashboard to actual data.
          </p>
        </section>

        <footer style={{ opacity: 0.8, fontSize: 12, textAlign: "center", marginTop: 24 }}>
          ESG–Casualty Risk Dashboard · Demo build for presentation.
        </footer>
      </div>
    </div>
  );
}
