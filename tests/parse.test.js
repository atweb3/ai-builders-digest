const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock fs module
const fsMock = {
  existsSync: () => true,
  readFileSync: () => JSON.stringify({}),
  writeFileSync: () => {}
};

// Mock https module
const httpsMock = {
  get: (url, cb) => {
    cb({ on: () => {} });
    return { on: () => {}, end: () => {} };
  },
  request: (opts, cb) => {
    const res = { on: () => {}, statusCode: 200 };
    cb(res);
    return { on: () => {}, write: () => {}, end: () => {} };
  }
};

describe('Feed Parsing', () => {
  it('should parse feed-x.json structure correctly', () => {
    const data = {
      x: [
        {
          handle: 'testuser',
          tweets: [
            { id: '123', text: 'Hello world', url: 'https://x.com/test' }
          ]
        }
      ]
    };

    // Test: items extraction from x feed
    const items = data.x.flatMap(b => (b.tweets || []).map(t => ({
      id: t.id,
      text: '@' + b.handle + ': ' + (t.text || '').slice(0, 100),
      url: t.url
    })));

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, '123');
    assert.strictEqual(items[0].text, '@testuser: Hello world');
  });

  it('should use title as id fallback for blogs', () => {
    const data = {
      blogs: [
        { title: 'Test Blog Post', url: null },
        { title: 'Another Post', url: '' }
      ]
    };

    // Test: id generation with title fallback
    const items = data.blogs.map(b => ({
      id: b.title || b.url,
      title: b.title,
      url: b.url
    }));

    assert.strictEqual(items[0].id, 'Test Blog Post');
    assert.strictEqual(items[1].id, 'Another Post');
  });

  it('should handle podcasts parsing', () => {
    const data = {
      podcasts: [
        { title: 'AI Podcast', url: 'https://example.com/pod' }
      ]
    };

    const items = data.podcasts.map(p => ({
      id: p.url || p.title,
      title: p.title,
      url: p.url
    }));

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].title, 'AI Podcast');
  });
});

describe('State Deduplication', () => {
  it('should filter out already seen items', () => {
    const state = {
      '123': { time: '2024-01-01' }
    };

    const items = [
      { id: '123', title: 'Old post' },
      { id: '456', title: 'New post' }
    ];

    const newItems = items.filter(item => {
      const id = item.id || item.url || item.link;
      return id && !state[id];
    });

    assert.strictEqual(newItems.length, 1);
    assert.strictEqual(newItems[0].id, '456');
  });
});
