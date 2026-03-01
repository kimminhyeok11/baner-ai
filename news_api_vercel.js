export default async function handler(req, res) {
  const q = (req.query.q || '코스피 OR 코스닥 OR 증시');
  const rssUrl = `https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(rssUrl);
    const xml = await r.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map(m => {
      const item = m[1];
      const pick = (tag) => {
        const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        const v = match ? match[1] : '';
        return v.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
      };
      const title = pick('title');
      const link = pick('link');
      const source = pick('source');
      const pubDate = pick('pubDate');
      return { title, link, source, published_at: pubDate };
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ items });
  } catch {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ items: [] });
  }
}
