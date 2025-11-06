# ESG–Casualty Risk Dashboard (Vercel-ready)

A React + Vite demo dashboard for casualty insurance analytics with ESG signals.
- Charts with **Recharts**
- Interactive **Leaflet map** via CDN (no react-leaflet)
- CSV uploads to replace the sample data
- Centroid fallback: if a row has `geo` (ISO-2) but no coordinates, we plot at country centroid

## Quick start

```bash
npm i
npm run dev
```

Open http://localhost:5173

## Deploy on Vercel
- Build: `npm run build`
- Output: `dist/`

## CSV schemas
- **Companies**: `company,industry,EHEI,is_high_risk,geo,lat,lon`
- **Portfolio**: `industry,companies,avg_EHEI,pct_high_risk`
- **Features**: `feature,importance`

## Notes
- Leaflet is loaded from CDN inside the component; if your network blocks CDN, download Leaflet JS/CSS into `/public/leaflet/` and point the two URLs in `App.jsx` to `/leaflet/leaflet.js` and `/leaflet/leaflet.css`.
