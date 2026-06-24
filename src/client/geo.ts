// OSM(Nominatim) の無料APIで「店名・地名 検索」「緯度経度→名前（逆ジオ）」を行う。APIキー不要。
// tabikake の src/lib/geocode.ts を web 向けに移植（ブラウザは User-Agent を付けられないので Referer 任せ）。

async function fetchJson(url: string, ms = 8000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ReverseResult = { name: string; area: string };

// 緯度経度 → 一番それらしい名前（POI名 or 地名）
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseResult> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}` +
    `&zoom=18&addressdetails=1&namedetails=1&accept-language=ja`;
  const j = await fetchJson(url);
  if (!j) return { name: '', area: '' };
  const a = j.address ?? {};
  const area =
    [a.city, a.town, a.village, a.suburb, a.neighbourhood].filter(Boolean).slice(0, 2).join(' ') || a.state || '';
  const name =
    j.namedetails?.['name:ja'] || j.namedetails?.name || a.shop || a.amenity || a.building || a.road || area;
  return { name: name ?? '', area };
}

export type SearchResult = { name: string; detail: string; dist: number | null; lat: number; lon: number };

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 店名・地名で検索。near があれば周辺を優先し近い順に並べる。
export async function searchPlaces(query: string, near?: { lat: number; lon: number }): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  let url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}` +
    `&accept-language=ja&limit=20&namedetails=1&addressdetails=1`;
  if (near) {
    const d = 0.2;
    url += `&viewbox=${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`;
  }
  const j = await fetchJson(url);
  const arr: any[] = Array.isArray(j) ? j : [];
  const out = arr
    .map((r) => {
      const name =
        r.namedetails?.['name:ja'] || r.namedetails?.name || r.name ||
        (typeof r.display_name === 'string' ? r.display_name.split(',')[0] : '');
      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      return { name: name ?? '', detail: r.display_name ?? '', dist: near ? Math.round(distanceM(near.lat, near.lon, lat, lon)) : null, lat, lon };
    })
    .filter((r) => r.name && !isNaN(r.lat) && !isNaN(r.lon));
  if (near) out.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
  return out.slice(0, 12);
}

export const fmtDist = (m: number | null) => (m == null ? '' : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);
