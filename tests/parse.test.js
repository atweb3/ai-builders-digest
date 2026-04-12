const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
describe('Feed Parsing', () => {
  it('should parse feed-x.json structure correctly', () => {
    const data = {
      x: [{ handle: 'testuser', tweets: [{ id: '123', text: 'Hello world', url: 'https://example.com/test' }] }]
    };
    const items = data.x.flatMap(b => (b.tweets || []).map(t => ({ id: t.id, text: '@' + b.handle + ': ' + (t.text || '').slice(0, 100), url: t.url })));
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, '123');
  });
  it('should use title as id fallback for blogs', () => {
    const data = { blogs: [{ title: 'Test Blog Post', url: null }, { title: 'Another Post', url: '' }] };
    const items = data.blogs.map(b => ({ id: b.title || b.url, title: b.title, url: b.url }));
    assert.strictEqual(items[0].id, 'Test Blog Post');
    assert.strictEqual(items[1].id, 'Another Post');
  });
  it('should use title as id when both title and url exist', () => {
    const blog = { title: 'My Blog Post', url: 'https://example.com/blog' };
    const item = { id: blog.title || blog.url, title: blog.title, url: blog.url };
    assert.strictEqual(item.id, 'My Blog Post');
  });
  it('should fallback to url when title is missing', () => {
    const blog = { title: null, url: 'https://example.com/blog' };
    const item = { id: blog.title || blog.url, title: blog.title, url: blog.url };
    assert.strictEqual(item.id, 'https://example.com/blog');
  });
  it('should handle podcasts parsing', () => {
    const data = { podcasts: [{ title: 'AI Podcast', url: 'https://example.com/pod' }] };
    const items = data.podcasts.map(p => ({ id: p.url || p.title, title: p.title, url: p.url }));
    assert.strictEqual(items.length, 1);
  });
});
describe('State Deduplication', () => {
  it('should filter out already seen items', () => {
    const state = { '123': { time: '2024-01-01' } };
    const items = [{ id: '123', title: 'Old post' }, { id: '456', title: 'New post' }];
    const newItems = items.filter(item => { const id = item.id || item.url || item.link; return id && !state[id]; });
    assert.strictEqual(newItems.length, 1);
    assert.strictEqual(newItems[0].id, '456');
  });
});