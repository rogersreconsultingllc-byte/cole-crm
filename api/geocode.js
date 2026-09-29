// Vercel serverless function: turns an address into map coordinates.
// Tries the US Census geocoder first (accurate for US street addresses, free, no key),
// then OpenStreetMap as a fallback.
export default async function handler(req, res) {
  const q = String(req.query.q || '').trim()
  if (!q) return res.status(400).json({ error: 'Missing q' })
  res.setHeader('Cache-Control', 's-maxage=86400')

  try {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
      new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' })
    const r = await fetch(u)
    const j = await r.json()
    const m = j?.result?.addressMatches?.[0]
    if (m) return res.json({ lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress, source: 'US Census' })
  } catch (e) { /* fall through */ }

  try {
    const u = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'us', viewbox: '-83.2,28.2,-81.6,26.6' })
    const r = await fetch(u, { headers: { 'User-Agent': 'cole-crm/1.0 (rogersreconsultingllc@gmail.com)' } })
    const j = await r.json()
    if (j[0]) return res.json({ lat: +j[0].lat, lng: +j[0].lon, matched: j[0].display_name, source: 'OpenStreetMap', approximate: true })
  } catch (e) { /* fall through */ }

  res.status(404).json({ error: 'No match' })
}
