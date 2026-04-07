#!/usr/bin/env node

// AI Builders Digest - GitHub Actions版本
// 使用免费 Groq API，无需 API Key
// 收集AI builders的最新内容，生成摘要，推送到飞书

import('fs').then(fs => {
const { readFileSync, writeFileSync, existsSync } = fs;

// 配置
const FEED_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const FEED_PODCASTS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json';
const FEED_BLOGS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';
const STATE_FILE = 'state-feed.json';

// 飞书WebHook发送
async function sendToFeishu(text, webhookUrl) {
  const MAX_LEN = 4000;
  
  if (text.length <= MAX_LEN) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } })
    });
  } else {
    let remaining = text;
    let part = 1;
    while (remaining.length > 0) {
      let splitAt = remaining.length <= MAX_LEN ? remaining.length : remaining.lastIndexOf('\n', MAX_LEN);
      if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN;
      
      const chunk = remaining.slice(0, splitAt);
      remaining = remaining.slice(splitAt);
      const prefix = remaining.length > 0 ? `\n📄 第${part}部分 ---\n` : '';
      
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: prefix + chunk } })
      });
      
      if (remaining.length > 0) await new Promise(r => setTimeout(r, 1000));
      part++;
    }
  }
}

// 加载状态文件
function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return { seenIds: new Set(), lastRun: null };
}

// 保存状态
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// 获取新内容
async function fetchNewContent() {
  const state = loadState();
  state.lastRun = new Date().toISOString();
  
  console.log('Fetching feeds...');
  
  const [feedX, feedPodcasts, feedBlogs] = await Promise.all([
    fetch(FEED_X_URL).then(r => r.json()).catch(() => null),
    fetch(FEED_PODCASTS_URL).then(r => r.json()).catch(() => null),
    fetch(FEED_BLOGS_URL).then(r => r.json()).catch(() => null)
  ]);

  const newContent = { tweets: [], podcasts: [], blogs: [] };

  if (feedX?.x) {
    for (const builder of feedX.x) {
      const newTweets = builder.tweets.filter(t => !state.seenIds.has(t.id));
      if (newTweets.length > 0) {
        newContent.tweets.push({ name: builder.name, handle: builder.handle, tweets: newTweets });
        newTweets.forEach(t => state.seenIds.add(t.id));
      }
    }
  }

  if (feedPodcasts?.podcasts) {
    for (const pod of feedPodcasts.podcasts) {
      if (!state.seenIds.has(pod.id)) {
        newContent.podcasts.push(pod);
        state.seenIds.add(pod.id);
      }
    }
  }

  if (feedBlogs?.blogs) {
    for (const blog of feedBlogs.blogs) {
      if (!state.seenIds.has(blog.id)) {
        newContent.blogs.push(blog);
        state.seenIds.add(blog.id);
      }
    }
  }

  const ids = Array.from(state.seenIds);
  if (ids.length > 500) {
    state.seenIds = new Set(ids.slice(-500));
  }

  saveState(state);

  return {
    newContent,
    stats: {
      newTweets: newContent.tweets.reduce((sum, b) => sum + b.tweets.length, 0),
      newPodcasts: newContent.podcasts.length,
      newBlogs: newContent.blogs.length
    }
  };
}

// 使用免费的 Groq API 生成摘要 (无需 API Key)
async function generateDigest(newContent, stats) {
  const systemPrompt = `你是一个AI行业资讯摘要助手。请根据以下内容，用简洁的中文生成一篇AI Builders今日动态摘要。

格式要求：
🤖 AI Builders Daily Digest - [今日日期]

**🔥 最新推文精选**
[3-5条最有趣的推文，包含作者和核心观点]

**🎙️ 新播客/视频**
[列出新播客节目，附嘉宾和主题]

**📝 技术博客更新**
[博客文章及其关键要点]

要求：
- 用中文写作
- 简洁但信息丰富
- 聚焦技术洞见和实操内容
- 总字数控制在800字以内`;

  let contentSummary = '';
  
  if (stats.newTweets > 0) {
    contentSummary += `\n\n**新推文 (${stats.newTweets}条):**\n`;
    for (const builder of newContent.tweets.slice(0, 5)) {
      contentSummary += `\n@${builder.handle} (${builder.name}):\n`;
      for (const tweet of builder.tweets.slice(0, 3)) {
        contentSummary += `- ${tweet.text?.slice(0, 200) || '暂无文本'}\n`;
      }
    }
  }

  if (stats.newPodcasts > 0) {
    contentSummary += `\n\n**新播客 (${stats.newPodcasts}期):**\n`;
    for (const pod of newContent.podcasts.slice(0, 3)) {
      contentSummary += `- ${pod.name}: ${pod.title || pod.episodeTitle || '暂无标题'}\n`;
    }
  }

  if (stats.newBlogs > 0) {
    contentSummary += `\n\n**新博客 (${stats.newBlogs}篇):**\n`;
    for (const blog of newContent.blogs.slice(0, 3)) {
      contentSummary += `- ${blog.name}: ${blog.title || '暂无标题'}\n`;
    }
  }

  if (contentSummary.trim() === '') {
    console.log('No new content today, skipping digest.');
    return null;
  }

  console.log('Generating digest with Groq (free API)...');
  
  // 使用 Groq 免费 API (Llama模型，完全免费无需Key)
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer gsk_wow'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请根据以下新内容生成今日摘要：${contentSummary}` }
      ],
      max_tokens: 1500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Groq API error:', error);
    throw new Error('Groq API call failed');
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

// 主函数
async function main() {
  console.log('🚀 AI Builders Digest started');
  console.log('Time:', new Date().toISOString());

  const { newContent, stats } = await fetchNewContent();
  console.log('New content stats:', stats);

  if (stats.newTweets === 0 && stats.newPodcasts === 0 && stats.newBlogs === 0) {
    console.log('No new content, exiting.');
    return;
  }

  const digest = await generateDigest(newContent, stats);
  
  if (!digest) {
    console.log('No digest generated.');
    return;
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('FEISHU_WEBHOOK_URL not set!');
    process.exit(1);
  }

  await sendToFeishu(digest, webhookUrl);
  console.log('✅ Digest sent to Feishu!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
