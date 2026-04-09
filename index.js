const fs = require('fs');
const https = require('https');

// 数据源配置
const FEEDS = [
  {
    url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/src/feed/builder.json',
    name: 'Builder'
  },
  {
    url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/src/feed/x.json',
    name: 'X (Twitter)'
  },
  {
    url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/src/feed/engineering.json',
    name: 'Engineering'
  }
];

// 状态文件路径
const STATE_FILE = './state-feed.json';

// 加载已推送记录
let pushedState = new Map();
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const [id, data] of Object.entries(obj)) {
      pushedState.set(id, data);
    }
    console.log(`已加载 ${pushedState.size} 条历史推送记录`);
  } catch (e) {
    console.warn('读取状态文件失败，将重新开始', e.message);
  }
}

// 通用 JSON 抓取
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 提取条目唯一ID（优先使用 id，否则用 url/link）
function getItemId(item) {
  return item.id || item.url || item.link || null;
}

// 提取条目标题
function getItemTitle(item) {
  return item.title || item.name || '未命名';
}

// 提取条目链接
function getItemLink(item) {
  return item.url || item.link || null;
}

// 发送到飞书（单条消息最多20条内容，分页安全）
async function sendToFeishu(title, items) {
  if (!items || items.length === 0) return false;
  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) {
    console.error('缺少 FEISHU_WEBHOOK_URL 环境变量');
    return false;
  }

  // 飞书富文本消息格式
  const content = {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title: title,
          content: []
        }
      }
    }
  };

  // 每个条目占两行：标题 + 链接
  for (const item of items) {
    const line = [
      [{ tag: 'text', text: `• ${getItemTitle(item)}` }]
    ];
    const link = getItemLink(item);
    if (link) {
      line.push([{ tag: 'a', text: '查看详情', href: link }]);
    }
    line.push([{ tag: 'text', text: '' }]); // 空行分隔
    content.content.post.zh_cn.content.push(...line);
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify(content);
    const urlObj = new URL(webhook);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let resp = '';
      res.on('data', d => resp += d);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`飞书推送成功: ${title}`);
          resolve(true);
        } else {
          console.error(`飞书推送失败 (${res.statusCode}): ${resp}`);
          resolve(false);
        }
      });
    });
    req.on('error', (e) => {
      console.error('飞书请求错误:', e.message);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

// 主函数
async function main() {
  let totalNew = 0;
  for (const feed of FEEDS) {
    console.log(`\n📡 正在处理: ${feed.name}`);
    try {
      const data = await fetchJSON(feed.url);
      let items = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.items && Array.isArray(data.items)) {
        items = data.items;
      } else {
        console.warn(`未知的数据格式，跳过 ${feed.name}`);
        continue;
      }

      const newItems = [];
      for (const item of items) {
        const id = getItemId(item);
        if (!id) {
          console.warn('条目缺少唯一标识，跳过', item);
          continue;
        }
        if (!pushedState.has(id)) {
          newItems.push(item);
        }
      }

      if (newItems.length > 0) {
        console.log(`发现 ${newItems.length} 条新内容`);
        const title = `📬 ${feed.name} 更新 (${newItems.length}条)`;
        const success = await sendToFeishu(title, newItems);
        if (success) {
          // 记录已推送
          for (const item of newItems) {
            const id = getItemId(item);
            pushedState.set(id, {
              pushedAt: new Date().toISOString(),
              title: getItemTitle(item)
            });
          }
          totalNew += newItems.length;
        } else {
          console.error(`发送 ${feed.name} 失败，本次不记录状态`);
        }
      } else {
        console.log(`无新内容`);
      }
      // 避免请求过快
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`处理 ${feed.name} 时出错:`, err.message);
    }
  }

  // 保存状态
  const stateObj = Object.fromEntries(pushedState);
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateObj, null, 2));
  console.log(`\n✅ 执行完成，共推送 ${totalNew} 条新内容`);
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});
