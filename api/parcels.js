// Vercel serverless function: looks up county parcels (owner, use code, location)
// from the SWFWMD parcel service. Used to verify imported owner lists and pin them on the map.
// GET /api/parcels?county=Sarasota&ids=2027010068,2027080024
// GET /api/parcels?county=Sarasota&adds=107 S OSPREY AVE|1820 RINGLING BLVD
const LAYERS = { sarasota: 15, manatee: 10, charlotte: 1, pinellas: 13, hillsborough: 7 }
const BASE = 'https://www25.swfwmd.state.fl.us/arcgis12/rest/services/BaseVector/parcel_search/MapServer/'

export default async function handler(req, res) {
  const layer = LAYERS[String(req.query.county || '').toLowerCase().replace(/\s*county$/, '')]
  if (layer == null) return res.status(400).json({ error: 'Unknown county' })
  const ids = String(req.query.ids || '').split(',').map(s => s.replace(/[^0-9A-Za-z]/g, '')).filter(Boolean).slice(0, 100)
  const adds = String(req.query.adds || '').split('|').map(s => s.toUpperCase().replace(/[^0-9A-Z .#-]/g, '').trim()).filter(Boolean).slice(0, 100)
  if (!ids.length && !adds.length) return res.status(400).json({ error: 'Missing ids or adds' })
  const q = s => `'${s.replace(/'/g, "''")}'`
  const where = ids.length ? `PARCELID IN (${ids.map(q).join(',')})` : `SITEADD IN (${adds.map(q).join(',')})`
  const body = new URLSearchParams({
    where, outFields: 'PARCELID,SITEADD,SCITY,OWNNAME,PARUSECODE,DORUSECODE,TOT_LVG_AREA,YRBLT_ACT',
    returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'json',
  })
  try {
    const r = await fetch(BASE + layer + '/query', { method: 'POST', body })
    const j = await r.json()
    if (j.error) return res.status(502).json({ error: j.error.message || 'Parcel service error' })
    res.setHeader('Cache-Control', 's-maxage=3600')
    res.json((j.features || []).map(f => {
      const pts = (f.geometry?.rings || []).flat()
      const lat = pts.length ? pts.reduce((a, p) => a + p[1], 0) / pts.length : null
      const lng = pts.length ? pts.reduce((a, p) => a + p[0], 0) / pts.length : null
      return { ...f.attributes, lat, lng }
    }))
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
}
