#!/usr/bin/env node

// AI Builders Digest - GitHub Actions版本
// 使用免费 Groq API，无需 API Key
// 收集AI builders的最新内容，生成摘要，推送到飞书

import { readFileSync, writeFileSync, existsSync } from 'fs';

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

// 生成摘要 - 纯本地格式化，无需API Key
function generateDigest(newContent, stats) {
  const today = new Date().toLocaleDateString('zh-CN', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });
  
  let digest = `🤖 AI Builders Daily Digest - ${today}\n\n`;

  if (stats.newTweets > 0) {
    digest += `**🔥 最新推文精选 (${stats.newTweets}条)**\n\n`;
    for (const builder of newContent.tweets.slice(0, 5)) {
      digest += `📱 @${builder.handle}\n`;
      for (const tweet of builder.tweets.slice(0, 2)) {
        const text = tweet.text?.slice(0, 280) || '暂无文本';
        digest += `   "${text}"\n`;
      }
      digest += '\n';
    }
  }

  if (stats.newPodcasts > 0) {
    digest += `**🎙️ 新播客/视频 (${stats.newPodcasts}期)**\n\n`;
    for (const pod of newContent.podcasts.slice(0, 3)) {
      digest += `🎧 ${pod.name}\n`;
      digest += `   ${pod.title || pod.episodeTitle || '暂无标题'}\n`;
      if (pod.url) digest += `   🔗 ${pod.url}\n`;
      digest += '\n';
    }
  }

  if (stats.newBlogs > 0) {
    digest += `**📝 技术博客更新 (${stats.newBlogs}篇)**\n\n`;
    for (const blog of newContent.blogs.slice(0, 3)) {
      digest += `📄 ${blog.name}\n`;
      digest += `   ${blog.title || '暂无标题'}\n`;
      digest += '\n';
    }
  }

  digest += '---\n';
  digest += `📊 今日统计: ${stats.newTweets}条推文 | ${stats.newPodcasts}期播客 | ${stats.newBlogs}篇博客\n`;
  digest += `🔗 数据来源: follow-builders`;

  if (digest.trim() === `🤖 AI Builders Daily Digest - ${today}\n\n---\n📊 今日统计:`) {
    console.log('No new content today, skipping digest.');
    return null;
  }

  return digest;
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
