const fs = require('fs');
const https = require('https');

const FEEDS = [
  {url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json', name: 'X'},
  {url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json', name: 'Podcasts'},
  {url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json', name: 'Blogs'}
];

let state = new Map();
if (fs.existsSync('./s.json')) {
  JSON.parse(fs.readFileSync('./s.json','utf8')).forEach((v,k) => state.set(k,v));
}

function fetch(url) {
  return new Promise((ok, no) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { no(new Error(res.statusCode)); return; }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { ok(JSON.parse(d)); } catch(e) { no(e); } });
    }).on('error', no);
  });
}

function getId(i) { return i.id || i.url || JSON.stringify(i).slice(0,50); }
function getTitle(i) { return i.title || i.name || i.handle || ''; }

async function sendFeishu(title, items) {
  if (!items || !items.length) return;
  const wh = process.env.FEISHU_WEBHOOK_URL;
  if (!wh) return;
  const body = {
    msg_type: 'post',
    content: { post: { zh_cn: { title, content: items.map(i => [[{tag:'text', text:'* ' + getTitle(i)}]]) } } }
  };
  return new Promise(ok => {
    const u = new URL(wh);
    const req = https.request({hostname: u.hostname, path: u.pathname, method:'POST', headers:{'Content-Type':'application/json'}}, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>ok(res.statusCode===200));
    });
    req.on('error', () => ok(false));
    req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  let total = 0;
  for (const f of FEEDS) {
    console.log('Processing:', f.name);
    try {
      const d = await fetch(f.url);
      let items = [];
      if (d.x) items = d.x.flatMap(b => (b.tweets||[]).map(t => ({id: t.id, title: '@'+b.handle+': '+(t.text||'').slice(0,100)})));
      else if (d.podcasts) items = d.podcasts;
      else if (d.blogs) items = d.blogs;
      else if (Array.isArray(d)) items = d;
      const newItems = items.filter(i => !state.has(getId(i)));
      if (newItems.length) {
        console.log('New:', newItems.length);
        const ok = await sendFeishu(f.name+' Updates ('+newItems.length+')', newItems);
        if (ok) { newItems.forEach(i => state.set(getId(i), 1)); total += newItems.length; }
      } else console.log('No new');
      await new Promise(r => setTimeout(r, 500));
    } catch(e) { console.error('Error:', e.message); }
  }
  fs.writeFileSync('./s.json', JSON.stringify(Object.fromEntries(state)));
  console.log('Done. Total:', total);
}

main().catch(e => { console.error(e); process.exit(1); });