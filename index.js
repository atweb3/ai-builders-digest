#!/usr/bin/env node

// AI Builders Digest - GitHub Actions版本
// 收集AI builders的最新内容，生成摘要，推送到飞书

import { readFileSync, writeFileSync, existsSync } from 'fs';
import OpenAI from 'openai';

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
      const prefix = remaining.length > 0 ? \n📄 第部分 ---\n : '';
      
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

// 生成摘要
async function generateDigest(newContent, stats) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = You are an AI industry digest writer. Create a concise, informative daily digest in Chinese summarizing the latest updates from top AI builders.

Format:
🤖 AI Builders Daily Digest - [日期]

**🔥 最新推文精选**
[3-5 most interesting tweets with author and key insight]

**🎙️ 新播客/视频**
[List new podcast episodes with guest and topic]

**📝 技术博客更新**
[Blog posts and their key takeaways]

Rules:
- Write in Chinese
- Be concise but informative
- Focus on actionable insights and technical depth
- Max 800 words total;

  let contentSummary = '';
  
  if (stats.newTweets > 0) {
    contentSummary += \n\n**新推文 (条):**\n;
    for (const builder of newContent.tweets.slice(0, 5)) {
      contentSummary += \n@ ():\n;
      for (const tweet of builder.tweets.slice(0, 3)) {
        contentSummary += - \n;
      }
    }
  }

  if (stats.newPodcasts > 0) {
    contentSummary += \n\n**新播客 (期):**\n;
    for (const pod of newContent.podcasts.slice(0, 3)) {
      contentSummary += - : \n;
    }
  }

  if (stats.newBlogs > 0) {
    contentSummary += \n\n**新博客 (篇):**\n;
    for (const blog of newContent.blogs.slice(0, 3)) {
      contentSummary += - : \n;
    }
  }

  if (contentSummary.trim() === '') {
    console.log('No new content today, skipping digest.');
    return null;
  }

  console.log('Generating digest with OpenAI...');
  
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content:systemPrompt },
      { role: 'user', content: 请根据以下新内容生成今日摘要： }
    ],
    max_tokens: 1500,
    temperature: 0.7
  });

  return completion.choices[0].message.content;
}

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