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

function sendToFeishu(title, items) {
  return new Promise((resolve, reject) => {
    const webhook = process.env.FEISHU_WEBHOOK_URL;
    if (!webhook) {
      console.log('ERROR: FEISHU_WEBHOOK_URL not set');
      resolve(false);
      return;
    }
    if (!items.length) {
      resolve(false);
      return;
    }

    const content = {
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: title,
            content: items.map(item => [
              [{ tag: 'text', text: '> ' + (item.text || item.title || item.name || 'unknown') }],
              [{ tag: 'a', text: 'Link', href: item.url || item.link || '#' }],
              [{ tag: 'text', text: '\n' }]
            ]).flat()
          }
        }
      }
    };

    const data = JSON.stringify(content);
    console.log('Sending to Feishu:', title, '- Items:', items.length);

    const u = new URL(webhook);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('Feishu response:', res.statusCode);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (e) => {
      console.log('Feishu error:', e.message);
      resolve(false);
    });
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('Starting AI Builders Digest...');
  console.log('Current state entries:', Object.keys(state).length);

  for (const feed of FEEDS) {
    const name = feed.split('/').pop().replace('.json', '');
    console.log('Processing:', name);
    try {
      const data = await fetchJSON(feed);

      // Fix: support multi-layer JSON structures
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.x) {
        // feed-x.json: { x: [{ tweets: [...] }, ...] }
        items = data.x.flatMap(b => (b.tweets || []).map(t => ({
          id: t.id,
          text: '@' + b.handle + ': ' + (t.text || '').slice(0, 100),
          url: t.url
        })));
      } else if (data.podcasts) {
        items = data.podcasts.map(p => ({
          id: p.url || p.title,
          title: p.title,
          url: p.url
        }));
      } else if (data.blogs) {
        // Fix: use title as stable id fallback
        items = data.blogs.map(b => ({
          id: b.title || b.url,
          title: b.title,
          url: b.url
        }));
      } else if (data.items) {
        items = data.items;
      }

      console.log('Found items:', items.length);

      const newItems = items.filter(item => {
        const id = item.id || item.url || item.link;
        return id && !state[id];
      });

      console.log('New items:', newItems.length);

      if (newItems.length) {
        const sent = await sendToFeishu('AI Builders Digest Daily - ' + name + ' Updates (' + newItems.length + ')', newItems);
        if (sent) {
          newItems.forEach(item => {
            const id = item.id || item.url || item.link;
            state[id] = { time: new Date().toISOString() };
          });
          console.log('Sent successfully!');
        }
      }
    } catch(e) {
      console.log('Error:', e.message);
    }
  }

  fs.writeFileSync('./state-feed.json', JSON.stringify(state, null, 2));
  console.log('Done. Total tracked:', Object.keys(state).length);
})();
