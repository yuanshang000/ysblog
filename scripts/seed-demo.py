"""
初始化本地演示数据 —— 让首次 clone 后能直接看到效果。

用法：python scripts/seed-demo.py
说明：仅写入本地库（.tmp/d1），不影响线上数据库。
"""
import os
import sqlite3
import glob
import hashlib
import secrets

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATTERN = os.path.join(ROOT, '.tmp/d1/v3/d1/*/*.sqlite')

dbs = glob.glob(DB_PATTERN)
if not dbs:
    print('✗ 未找到本地数据库，请先执行：npm run db:migrate:local')
    raise SystemExit(1)

con = sqlite3.connect(dbs[0])
now = "datetime('now')"

# ---------- 管理员 ----------
salt = secrets.token_bytes(16)
dk = hashlib.pbkdf2_hmac('sha256', b'Demo123456', salt, 210000, 32)
pw = f"pbkdf2$210000${salt.hex()}${dk.hex()}"
con.execute(f"""INSERT INTO users (username,email,password_hash,password_algo,role,status,display_name,created_at,updated_at)
                VALUES ('admin','admin@example.com','{pw}','pbkdf2-sha256','admin','active','博主',{now},{now})
                ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash""")

# ---------- 导航菜单 ----------
menus = [('首页','/','header',1),('文章','/posts','header',2),('归档','/archives','header',3),
         ('分类','/categories','header',4),('标签','/tags','header',5),('项目','/projects','header',6),
         ('关于我','/about','header',7),('友链','/links','header',8),
         ('RSS','/api/v1/feed','footer',1),('管理后台','/admin','footer',2)]
con.execute('DELETE FROM menus')
for label, href, loc, so in menus:
    ext = 1 if href.startswith('http') else 0
    con.execute("""INSERT INTO menus (label,href,location,sort_order,is_visible,is_external,open_in_new,created_at,updated_at)
                    VALUES (?,?,?,?,1,?,1,datetime('now'),datetime('now'))""", (label, href, loc, so, ext))

# ---------- 分类与标签 ----------
con.execute("INSERT OR IGNORE INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,1,datetime('now'),datetime('now'))", ('技术笔记','tech','技术相关的文章与笔记'))
con.execute("INSERT OR IGNORE INTO categories (name,slug,description,sort_order,created_at,updated_at) VALUES (?,?,?,2,datetime('now'),datetime('now'))", ('产品思考','product','产品与设计相关的思考'))
con.execute("INSERT OR IGNORE INTO tags (name,slug,created_at) VALUES ('TypeScript','typescript',datetime('now'))")
con.execute("INSERT OR IGNORE INTO tags (name,slug,created_at) VALUES ('Cloudflare','cloudflare',datetime('now'))")
con.execute("INSERT OR IGNORE INTO tags (name,slug,created_at) VALUES ('随笔','essay',datetime('now'))")

tech = con.execute("SELECT id FROM categories WHERE slug='tech'").fetchone()[0]
prod = con.execute("SELECT id FROM categories WHERE slug='product'").fetchone()[0]

# ---------- 文章 ----------
posts = [
    {
        'title': '用 Cloudflare Workers 搭建个人博客',
        'slug': 'build-blog-with-workers',
        'excerpt': '记录一次从零搭建博客系统的全过程：技术选型、数据模型、安全设计与踩过的坑。',
        'content': '''## 为什么选择 Workers

个人博客的核心诉求是**低维护成本**。相比传统 VPS 方案，Cloudflare Workers 免去了服务器运维、系统更新与安全补丁，部署只需一条命令。

### 技术栈

| 层次 | 选型 | 说明 |
| --- | --- | --- |
| 前台 | Vue 3 + 服务端渲染 | 搜索引擎可直接抓取完整内容 |
| 后端 | Workers + TypeScript | 边缘运行，冷启动几乎无感 |
| 数据库 | D1 | SQLite 兼容，无需连接池 |
| 文件 | R2 | 按量计费，无出网费用 |

## 内容安全

Markdown 渲染器**禁用了原始 HTML**，所有标签一律转义。这看似保守，实则杜绝了账号被盗后的 XSS 风险。

```ts
// 链接协议白名单：拦截 javascript: 等危险协议
const ALLOWED = new Set(['http:', 'https:', 'mailto:']);
```

## 部署

```bash
npm run build
npx wrangler deploy
```

整个过程不需要碰服务器。
''',
        'cat': tech, 'tags': ['cloudflare'], 'days': 0, 'featured': 1
    },
    {
        'title': 'TypeScript 类型体操实战',
        'slug': 'typescript-type-gymnastics',
        'excerpt': '从 any 到 unknown再到条件类型，记录几个真实项目里用到的类型技巧。',
        'content': '''## 为什么讨厌 any

`any` 是类型系统的逃逸舱门。一旦它进入函数签名，编译器就彻底放弃对后续调用的检查。

> 相比 `any`，`unknown` 更适合「我暂时不知道但调用方必须处理」的场景。

## 几个实用模式

### 1. 收窄未知输入

```ts
function assertString(v: unknown): asserts v is string {
  if (typeof v !== 'string') throw new TypeError('expected string')
}
```

### 2. 从对象取键

```ts
type Keys<T> = Extract<keyof T, string>
```

### 3. 禁止空值

```ts
type Requiredish<T> = { [K in keyof T]-?: T[K] }
```

> 类型体操的价值不在于炫技，而在于把约束前移到编译期。
''',
        'cat': tech, 'tags': ['typescript'], 'days': 3, 'featured': 0
    },
    {
        'title': '写作三年的一点反思',
        'slug': 'reflection-on-writing',
        'excerpt': '技术博客写了三年，流量没涨多少，倒是把「写清楚」这件事练出来了。',
        'content': '''## 一开始为什么写

2023 年初开始写博客，最初的理由很朴素：觉得做过的项目如果不写下来，过半年就等于没做过。

## 写不出来的时候怎么办

大部分卡壳都来自**没有想清楚**，而不是文笔问题。我的做法是先画图，后写字。

## 三个小结论

1. 写给三个月后的自己看，收益最大；
2. 一篇讲透一篇，好过十篇罗列；
3. 允许自己写烂草稿，但不允许自己发没读过的稿子。

## 下一步

继续写。不追求爆款。
''',
        'cat': prod, 'tags': ['essay'], 'days': 7, 'featured': 0
    }
]

con.execute('DELETE FROM posts')
for p in posts:
    # 全部走参数绑定：正文含单引号、换行、反引号，拼接 SQL 会语法出错且有注入风险
    con.execute("""INSERT INTO posts
        (author_id, type, title, slug, excerpt, content, content_format, status, is_featured,
         word_count, reading_time, robots_index, revision, published_at, created_at, updated_at)
        VALUES (1,'post',?,?,?,?,'markdown','published',?,300,1,1,1,
                datetime('now', ?), datetime('now', ?), datetime('now'))""",
        (p['title'], p['slug'], p['excerpt'], p['content'], p['featured'],
         f"-{p['days']} days", f"-{p['days']} days"))
    pid = con.execute('SELECT last_insert_rowid()').fetchone()[0]
    con.execute('INSERT OR IGNORE INTO post_categories (post_id,category_id) VALUES (?,?)', (pid, p['cat']))
    for t in p['tags']:
        tid = con.execute('SELECT id FROM tags WHERE slug=?', (t,)).fetchone()[0]
        con.execute('INSERT OR IGNORE INTO post_tags (post_id,tag_id) VALUES (?,?)', (pid, tid))
    con.execute("""INSERT INTO post_revisions (post_id,title,excerpt,content,revision,created_at,created_by)
                  VALUES (?,?,?,?,1,datetime('now'),1)""", (pid, p['title'], p['excerpt'], p['content']))

# ---------- 独立页面 ----------
pages = [
    ('about', '关于我', '''## 嗨，我是 Lala

一名全栈开发者，长期在做 **Python 桌面工具** 与 **Web 应用**。

### 技术栈

- 桌面端：PySide6 + onnxruntime
- Web：Vue 3 / TypeScript / Cloudflare

### 联系

- 邮箱：hi@example.com
'''),
    ('projects', '项目', '''## 无垠之境- 微信自动获客助手

基于 PySide6 的 Windows 桌面自动化工具，读取 Excel 名单自动执行企业微信加好友动作。

## 无垠之境- 微信通讯录导出助手

已上线的产品，服务超过百位用户。

## MyBlog

就是你现在看到的这个：Workers + D1 + R2 的自托管博客系统。
'''),
    ('privacy', '隐私政策', '''## 隐私政策

本站不收集个人身份信息。

### 访问统计

仅保存 IP 的**加盐哈希**与匿名化访客标识，用于去重统计与频率限制。原始 IP 不落库。

### 评论

如开启评论功能，会保存昵称、可选邮箱与评论内容。**邮箱不会公开展示。**

### Cookie

仅使用两个必需 Cookie：会话令牌（HttpOnly）与 CSRF 令牌，用于维持登录状态与防跨站请求伪造。
''')
]
for slug, title, content in pages:
    con.execute("""INSERT OR REPLACE INTO posts
        (author_id, type, title, slug, excerpt, content, content_format, status, word_count, reading_time, robots_index, revision, published_at, created_at, updated_at)
        VALUES (1,'page',?,?,'',?,'markdown','published',100,1,1,1,datetime('now'),datetime('now'),datetime('now'))""",
        (title, slug, content))

# ---------- 友情链接 ----------
con.execute('DELETE FROM links')
friends = [('Cloudflare', 'https://developers.cloudflare.com', 'Web 基础设施提供方'),
           ('Vue.js', 'https://cn.vuejs.org', '渐进式 JavaScript 框架'),
           ('MDN Web Docs', 'https://developer.mozilla.org/zh-CN/', 'Web 技术权威文档')]
for i, (n, u, d) in enumerate(friends):
    con.execute("""INSERT INTO links (name,url,description,sort_order,is_visible,created_at)
                    VALUES (?,?,?,?,1,datetime('now'))""", (n, u, d, i + 1))

con.commit()

n_posts = con.execute("SELECT COUNT(*) FROM posts WHERE type='post' AND status='published'").fetchone()[0]
n_cats = con.execute('SELECT COUNT(*) FROM categories').fetchone()[0]
n_tags = con.execute('SELECT COUNT(*) FROM tags').fetchone()[0]
print(f'✓ 演示数据已写入：{n_posts} 篇文章 / {n_cats} 个分类 / {n_tags} 个标签 / {len(friends)} 条友链')
print('')
print('  本地登录信息：')
print('    地址：http://127.0.0.1:8787/admin')
print('    用户名：admin')
print('    密码：Demo123456')
print('')
print('  ⚠ 这是演示账号，正式使用前请到「站点设置 → 安全」修改密码')
con.close()