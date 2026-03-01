const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept',
  'content-type': 'application/json',
  'cache-control': 'public, max-age=30'
};

function parseInvestors(txt: string) {
  const norm = txt.replace(/\s+/g, '');
  const m = norm.match(/투자자별개인([+\-]?\d[,\d]*)외국인([+\-]?\d[,\d]*)기관([+\-]?\d[,\d]*)/);
  const p = norm.match(/프로그램차익([+\-]?\d[,\d]*)비차익([+\-]?\d[,\d]*)전체([+\-]?\d[,\d]*)/);
  const val = (s?: string) => (s || '').replace(/,/g, '');
  return {
    individual: m ? parseInt(val(m[1])) : null,
    foreign: m ? parseInt(val(m[2])) : null,
    institution: m ? parseInt(val(m[3])) : null,
    program: {
      arbitrage: p ? parseInt(val(p[1])) : null,
      non_arbitrage: p ? parseInt(val(p[2])) : null,
      total: p ? parseInt(val(p[3])) : null
    }
  };
}

async function fetchIndexBasic(index: 'KOSPI' | 'KOSDAQ') {
  const url = `https://m.stock.naver.com/api/index/${index}/basic`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'accept': 'application/json'
    }
  });
  const j = await res.json();
  const pickStr = (v?: unknown) => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    return null;
  };
  const point = pickStr(j.closePrice);
  const open = pickStr((j.openPrice ?? j.openingPrice));
  const high = pickStr(j.highPrice);
  const low = pickStr(j.lowPrice);
  const r = j.fluctuationsRatio;
  let change_percent: string | null = null;
  if (typeof r === 'string') {
    change_percent = r.startsWith('-') ? `${r}%` : `+${r}%`;
  } else if (typeof r === 'number') {
    const s = r.toFixed(2);
    change_percent = r < 0 ? `${s}%` : `+${s}%`;
  }
  const chartUrl = j.imageCharts?.day || j.imageCharts?.day_up || null;
  return { point, change_percent, open, high, low, chartUrl };
}

async function fetchInvestorsFromIntegration(index: 'KOSPI' | 'KOSDAQ') {
  const url = `https://m.stock.naver.com/api/index/${index}/integration?pageSize=10&page=1`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'accept': 'application/json'
    }
  });
  const j = await res.json();
  const toNum = (s?: string) => {
    if (!s || typeof s !== 'string') return null;
    const t = s.replace(/,/g, '');
    const n = parseInt(t);
    return Number.isNaN(n) ? null : n;
  };
  const deal = j.dealTrendInfo || {};
  const prog = j.programTrendInfo || {};
  return {
    individual: toNum(deal.personalValue),
    foreign: toNum(deal.foreignValue),
    institution: toNum(deal.institutionalValue),
    program: {
      arbitrage: toNum(prog.indexDifferenceReal),
      non_arbitrage: toNum(prog.indexBiDifferenceReal),
      total: toNum(prog.indexTotalReal)
    }
  };
}

async function fetchIndexPrices(index: 'KOSPI' | 'KOSDAQ') {
  const url = `https://m.stock.naver.com/api/index/${index}/price?pageSize=30&page=1`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'accept': 'application/json'
    }
  });
  const j = await res.json();
  if (!Array.isArray(j)) return [];
  const sorted = j.slice().sort((a, b) => {
    const ta = Date.parse(String(a.localTradedAt || ''));
    const tb = Date.parse(String(b.localTradedAt || ''));
    return ta - tb;
  });
  return sorted.map((it) => {
    const s = typeof it.closePrice === 'string' ? it.closePrice : null;
    if (!s) return null;
    const n = parseFloat(s.replace(/,/g, ''));
    return Number.isNaN(n) ? null : n;
  }).filter((v) => typeof v === 'number' && isFinite(v)) as number[];
}

async function fetchDayOhlcFromPage(index: 'KOSPI' | 'KOSDAQ') {
  const url = `https://m.stock.naver.com/domestic/index/${index}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'accept': 'text/html'
    }
  });
  const html = await res.text();
  const take = (label: string) => {
    const m = html.match(new RegExp(`${label}\\s*([\\d,\\.]+)`));
    return m ? m[1] : null;
  };
  const open = take('시가');
  const high = take('고가');
  const low = take('저가');
  return { open, high, low };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const index = (url.searchParams.get('index') || 'KOSPI').toUpperCase();
  try {
    const [basicInfo, investors, prices] = await Promise.all([
      fetchIndexBasic(index === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'),
      fetchInvestorsFromIntegration(index === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'),
      fetchIndexPrices(index === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI')
    ]);
    const toNum = (s?: string) => {
      if (!s) return null;
      const n = parseFloat(s.replace(/,/g, ''));
      return Number.isNaN(n) ? null : n;
    };
    let openStr = basicInfo.open;
    let highStr = basicInfo.high;
    let lowStr = basicInfo.low;
    if (!openStr || !highStr || !lowStr) {
      try {
        const alt = await fetchDayOhlcFromPage(index === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI');
        openStr = openStr || alt.open;
        highStr = highStr || alt.high;
        lowStr = lowStr || alt.low;
      } catch {}
    }
    const openNum = toNum(openStr || undefined);
    const pointNum = toNum(basicInfo.point);
    const series = (typeof openNum === 'number' && typeof pointNum === 'number') ? [openNum, pointNum] : [];
    return new Response(JSON.stringify({ index, investors, point: basicInfo.point, change_percent: basicInfo.change_percent, open: openStr, high: highStr, low: lowStr, chartUrl: basicInfo.chartUrl, series, prices }), { headers: cors });
  } catch {
    return new Response(JSON.stringify({ index, investors: null, point: null, change_percent: null, series: [], prices: [] }), { status: 500, headers: cors });
  }
});
