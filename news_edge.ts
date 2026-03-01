const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept',
  'content-type': 'application/json',
  'cache-control': 'public, max-age=30'
};

const parseItems = (xml: string) => {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(m => {
    const item = m[1];
    const pick = (tag: string) => {
      const r = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      const v = r ? r[1] : '';
      return v.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
    };
    const title = pick('title');
    const link = pick('link');
    const source = pick('source');
    const pubDate = pick('pubDate');
    return { title, link, source, published_at: pubDate };
  });
  return items;
};
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  const q = url.searchParams.get('q') ?? '코스피 OR 코스닥 OR 증시';
  const rssUrl = `https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=${encodeURIComponent(q)}&t=${Date.now()}`;
  try {
    const res = await fetch(rssUrl, {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept': 'application/rss+xml,text/xml', 'pragma': 'no-cache', 'cache-control': 'no-cache' }
    });
    const xml = await res.text();
    const items = parseItems(xml).sort((a, b) => {
      const ta = a.published_at ? Date.parse(a.published_at) : 0;
      const tb = b.published_at ? Date.parse(b.published_at) : 0;
      return tb - ta;
    });
    return new Response(JSON.stringify({ items }), { headers: corsHeaders });
  } catch {
    return new Response(JSON.stringify({ items: [] }), { status: 500, headers: corsHeaders });
  }
});
