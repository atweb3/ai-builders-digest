const fs = require('fs');
const https = require('https');

const FEEDS = [
  'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
  'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json',
  'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json'
];

let state = {};
if (fs.existsSync('./state-feed.json')) {
  try { state = JSON.parse(fs.readFileSync('./state-feed.json')); } catch(e) {}
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function sendToFeishu(title, items) {
  if (!items.length) return;
  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) return;
  const content = {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title: title,
          content: items.map(item => [
            [{ tag: 'text', text: '> ' + (item.title || item.name || 'unknown') }],
            [{ tag: 'a', text: 'Link', href: item.url || item.link || '#' }],
            [{ tag: 'text', text: '\n' }]
          ]).flat()
        }
      }
    }
  };
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(content);
    const u = new URL(webhook);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => { res.resume(); resolve(); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  for (const feed of FEEDS) {
    const name = feed.split('/').pop().replace('.json', '');
    try {
      const data = await fetchJSON(feed);
      const items = Array.isArray(data) ? data : (data.items || []);
      const newItems = items.filter(item => {
        const id = item.id || item.url || item.link;
        return id && !state[id];
      });
      if (newItems.length) {
        await sendToFeishu(name + ' Updates (' + newItems.length + ')', newItems);
        newItems.forEach(item => {
          const id = item.id || item.url || item.link;
          state[id] = { time: new Date().toISOString() };
        });
      }
    } catch(e) { console.error(name, e.message); }
  }
  fs.writeFileSync('./state-feed.json', JSON.stringify(state, null, 2));
})();