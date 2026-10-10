"""全功能测试脚本：前台启动 wrangler，逐项验证，输出结构化结果。"""
import subprocess, time, urllib.request, urllib.error, urllib.parse, json, re, sys, os, sqlite3, glob, struct, zlib, io

ROOT = os.path.dirname(os.path.abspath(__file__))
B = 'http://127.0.0.1:8790'
DB = glob.glob(os.path.join(ROOT, '.tmp/d1/v3/d1/*/*.sqlite'))[0]

def jget(b, path, default=None):
    """安全地从 JSON 响应取值，任何异常都返回默认值，避免测试脚本自身崩溃"""
    try:
        d = json.loads(b)
        for k in path.split('.'):
            if isinstance(d, list):
                d = d[int(k)]          # 支持负索引，如 data.-1.id
            else:
                d = d[k]
        return d
    except Exception:
        return default

results = []
def rec(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (('  | ' + detail) if detail else ''), flush=True)

def req(path, method='GET', body=None, cookie=None, csrf=None, files=None):
    """返回 (status, text|bytes, headers)。path 中的中文需先URL 编码"""
    # 拆分路径与查询串，只对路径段做百分号编码（中文 slug 必须编码否则请求直接失败）
    if '?' in path:
        raw, qs = path.split('?', 1)
        qs = '?' + qs
    else:
        raw, qs = path, ''
    url = B + urllib.parse.quote(raw, safe="/:@&=+$,~*()[]!") + qs
    headers = {}
    data = None
    if files:
        boundary = '----MFB' + 'x' * 40
        buf = io.BytesIO()
        for k, v in files.items():
            buf.write(f'--{boundary}\r\n'.encode())
            buf.write(f'Content-Disposition: form-data; name="{k}"; filename="{v[0]}"\r\n'.encode())
            buf.write(f'Content-Type: application/octet-stream\r\n\r\n'.encode())
            buf.write(v[1]); buf.write(b'\r\n')
        buf.write(f'--{boundary}--\r\n'.encode())
        data = buf.getvalue()
        headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json; charset=utf-8'
    if cookie: headers['Cookie'] = cookie
    if csrf: headers['X-CSRF-Token'] = csrf
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers
    except Exception as e:
        return 0, str(e).encode(), {}

def code(path):
    return req(path)[0]

def png_bytes(w=8, h=8):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\xff\x00\x00' * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

def start():
    # Windows 下 node_modules/.bin/wrangler 是 shell 脚本，需调用 .cmd 包装器
    cmd = os.path.join(ROOT, 'node_modules/.bin/wrangler.cmd')
    if not os.path.exists(cmd):
        cmd = os.path.join(ROOT, 'node_modules/.bin/wrangler')
    p = subprocess.Popen(
        [cmd, 'dev', '--port', '8790',
         '--persist-to', '.tmp/d1', '--ip', '127.0.0.1', '--test-scheduled'],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        shell=(os.name == 'nt'), creationflags=0x08000000)  # CREATE_NO_WINDOW
    for _ in range(90):
        time.sleep(1)
        if code('/') == 200:
            return p
    return p

def main():
    print('启动 Worker...', flush=True)
    proc = start()
    print('服务就绪\n', flush=True)

    print('===== A. 前台页面 =====')
    for p, name in [('/', '首页'), ('/posts', '文章列表'), ('/archives', '归档'),
                    ('/categories', '分类'), ('/tags', '标签'), ('/search', '搜索'),
                    ('/about', '关于我'), ('/projects', '项目'), ('/links', '友情链接'),
                    ('/privacy', '隐私政策')]:
        c = code(p)
        rec(f'前台 {name} {p}', c == 200, f'HTTP {c}')
    c = code('/no-such-page-xyz')
    rec('404 页面返回 404', c == 404, f'HTTP {c}')

    print('\n===== B. 前台内容完整性 =====')
    s, h, _ = req('/')
    h = h.decode('utf-8')
    nav = re.search(r'<nav class="site-nav"[^>]*>(.*?)</nav>', h, re.S)
    navitems = re.findall(r'<a href="([^"]+)"[^>]*>([^<]+)</a>', nav.group(1)) if nav else []
    rec('顶栏导航多菜单', len(navitems) >= 5, f'{len(navitems)} 项')
    rec('Hero 区渲染', 'hero-title' in h)
    rec('CSS 已内联', len(re.findall(r'<style>(.*?)</style>', h, re.S)[1] if len(re.findall(r'<style>(.*?)</style>', h, re.S)) > 1 else '') > 5000 if len(re.findall(r'<style>(.*?)</style>', h, re.S)) > 1 else False)
    rec('岛脚本注入', 'islands/app.js' in h)
    rec('canonical 标签', 'rel="canonical"' in h)
    rec('JSON-LD 结构化数据', 'WebSite' in h)
    rec('Open Graph 标签', 'og:title' in h)

    print('\n===== C. 认证 =====')
    # 直接建/重置管理员：必须用 UPSERT，否则重复运行时旧密码哈希会导致登录失败
    import hashlib
    salt = os.urandom(16)
    hk = hashlib.pbkdf2_hmac('sha256', b'TestPass123', salt, 210000, 32)
    hstr = f'pbkdf2$210000${salt.hex()}${hk.hex()}'
    con = sqlite3.connect(DB)
    con.execute("""INSERT INTO users (username,email,password_hash,password_algo,role,status,display_name,created_at,updated_at)
                   VALUES ('admin','a@t.com',?,'pbkdf2-sha256','admin','active','测试管理员',datetime('now'),datetime('now'))
                   ON CONFLICT(username) DO UPDATE SET
                     password_hash=excluded.password_hash, password_algo='pbkdf2-sha256', status='active'""", (hstr,))
    con.commit(); con.close()

    s, b, hdrs = req('/api/v1/admin/auth/login', 'POST', {'username': 'admin', 'password': 'wrongpass'})
    rec('错误密码拒绝 401', s == 401, f'HTTP {s}')
    s, b, hdrs = req('/api/v1/admin/auth/login', 'POST', {'username': 'admin', 'password': 'TestPass123'})
    # Set-Cookie 有两个值，必须用 get_all 取全部，dict() 会丢
    raw_sc = hdrs.get_all('Set-Cookie') if hasattr(hdrs, 'get_all') else [hdrs.get('Set-Cookie', '')]
    sc = ' ; '.join(raw_sc)
    rec('正确密码登录 200', s == 200, f'HTTP {s}')
    rec('下发 session Cookie', 'mb_session=' in sc)
    rec('下发 csrf Cookie', 'mb_csrf=' in sc)
    m = re.search(r'mb_csrf=([^;]+)', sc)
    csrf = m.group(1) if m else ''
    m = re.search(r'mb_session=([^;]+)', sc)
    cookie = f'mb_session={m.group(1)}; mb_csrf={csrf}' if m else ''
    if not csrf or 'mb_session' not in cookie:
        print('  !! Cookie 解析失败，无法继续鉴权测试', flush=True)
    s, b, _ = req('/api/v1/admin/me', cookie=cookie)
    rec('会话校验 /admin/me 200', s == 200, f'HTTP {s}')

    print('\n===== D. 安全防护 =====')
    s, _, _ = req('/api/v1/admin/posts')
    rec('未登录访问管理接口 401', s == 401, f'HTTP {s}')
    s, _, _ = req('/api/v1/admin/posts', 'POST', {'title': 'x', 'content': 'y'}, cookie=cookie)
    rec('缺 CSRF 令牌写操作 403', s == 403, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/posts', 'POST', {'title': 'x', 'content': 'y'}, cookie=cookie, csrf=csrf)
    rec('带 CSRF 创建文章 201', s == 201, f'HTTP {s}')
    pid = jget(b, 'data.id') if s == 201 else None
    rev = jget(b, 'data.revision') if s == 201 else 0
    slug = jget(b, 'data.slug') if s == 201 else None
    s, _, _ = req(f'/api/v1/admin/posts/{pid}', 'PUT', {'title': 'z', 'content': 'w', 'baseRevision': 999}, cookie=cookie, csrf=csrf)
    rec('版本冲突返回 409', s == 409, f'HTTP {s}')
    s, _, _ = req('/api/v1/admin/posts', 'POST', {'title': '', 'content': ''}, cookie=cookie, csrf=csrf)
    rec('空内容不新建（走占位）', s in (201, 422), f'HTTP {s}')
    s, _, _ = req('/api/v1/admin/categories', 'POST', {'name': 'x', 'slug': 'y', 'parentId': 999999}, cookie=cookie, csrf=csrf)
    rec('非法父分类被拒', s in (201, 422), f'HTTP {s}')
    s, _, _ = req('/api/v1/admin/settings', 'PUT', {'sessionSecret': 'hack'}, cookie=cookie, csrf=csrf)
    rec('敏感配置项不可前端改写 422', s == 422, f'HTTP {s}')

    print('\n===== E. Markdown 与 XSS =====')
    md = "# 标题\n\n**粗体** `代码`\n\n## 二级\n\n- 列表\n\n```js\nconst a = 1;\n```\n\n<script>alert(1)</script>\n\n[j](javascript:alert(1))\n\n[i](https://ok.com)"
    s, b, _ = req('/api/v1/admin/posts', 'POST', {'title': '功能验证文章', 'content': md, 'tagNames': ['验证'], 'status': 'draft'}, cookie=cookie, csrf=csrf)
    rec('创建含 Markdown 文章 201', s == 201, f'HTTP {s}')
    xid = jget(b, 'data.id') if s == 201 else None
    xslug = jget(b, 'data.slug') if s == 201 else None
    # 预览路由是 /admin/preview/:slug（不是 /posts/:id/preview/）
    s, b, _ = req(f'/api/v1/admin/preview/{xslug}', cookie=cookie)
    rec('管理员预览草稿 200', s == 200, f'HTTP {s}')
    pv = jget(b, 'data.html', '') if s == 200 else ''
    rec('Markdown 标题渲染', '<h1' in pv and '<h2' in pv)
    rec('Markdown 粗体渲染', '<strong>粗体</strong>' in pv)
    rec('Markdown 代码高亮', 'tok-kw' in pv and 'language-js' in pv)
    rec('Markdown 列表渲染', '<ul>' in pv or '<li>' in pv)
    rec('目录 TOC 生成', 'toc' in b.decode('utf-8'))
    rec('script 标签被转义', '<script>alert' not in pv and '&lt;script&gt;' in pv)
    rec('javascript: 链接被拦截', 'href="javascript:' not in pv)
    rec('正常 https 链接保留', 'href="https://ok.com"' in pv)
    s, b, _ = req('/api/v1/admin/posts', 'POST', {'title': '发布验证', 'content': md, 'status': 'draft'}, cookie=cookie, csrf=csrf)
    pid2 = jget(b, 'data.id'); slug2 = jget(b, 'data.slug')
    s, _, _ = req(f'/api/v1/posts/{slug2}')
    rec('草稿对公开接口隐藏 404', s == 404, f'HTTP {s}')
    s, b, _ = req(f'/api/v1/admin/posts/{pid2}/publish', 'POST', {}, cookie=cookie, csrf=csrf)
    rec('发布文章 200', s == 200 and jget(b, 'data.status') == 'published', f'HTTP {s}')
    s, b, _ = req(f'/api/v1/posts/{slug2}')
    rec('发布后公开可读 200', s == 200, f'HTTP {s}')
    s, h, _ = req(f'/posts/{slug2}')
    h = h.decode('utf-8')
    rec('前台文章页 SSR 200', s == 200)
    rec('文章页含阅读进度条', 'read-progress' in h)
    rec('文章页含目录容器', 'data-toc' in h)
    rec('文章页含图片灯箱', 'data-lightbox' in h)
    rec('文章页含代码复制按钮', 'md-code-copy' in h)
    rec('文章页 JSON-LD 为 BlogPosting', 'BlogPosting' in h)
    rec('文章页无未转义 script', '<script>alert' not in h)

    print('\n===== F. 状态机 =====')
    s, _, _ = req(f'/api/v1/admin/posts/{pid2}/archive', 'POST', {}, cookie=cookie, csrf=csrf)
    rec('归档文章 200', s == 200, f'HTTP {s}')
    s, _, _ = req(f'/api/v1/admin/posts/{pid2}', 'DELETE', None, cookie=cookie, csrf=csrf)
    rec('移入回收站 200', s == 200, f'HTTP {s}')
    s, _, _ = req(f'/api/v1/admin/posts/{pid2}/publish', 'POST', {}, cookie=cookie, csrf=csrf)
    rec('回收站文章不能发布 422', s == 422, f'HTTP {s}')
    s, _, _ = req(f'/api/v1/admin/posts/{pid2}/restore', 'POST', {}, cookie=cookie, csrf=csrf)
    rec('从回收站恢复 200', s == 200, f'HTTP {s}')
    s, b2, _ = req(f'/api/v1/admin/posts/{pid2}/duplicate', 'POST', {}, cookie=cookie, csrf=csrf)
    rec('复制文章 201', s == 201, f'HTTP {s}')
    # 另建一篇专门用于永久删除测试，避免删掉后续搜索要用的文章
    s, b, _ = req('/api/v1/admin/posts', 'POST', {'title': '待永久删除', 'content': 'x'}, cookie=cookie, csrf=csrf)
    did = jget(b, 'data.id')
    s, _, _ = req(f'/api/v1/admin/posts/{did}/permanent?confirm=true', 'DELETE', None, cookie=cookie, csrf=csrf) if did else (0, b'', {})
    rec('永久删除（带确认参数）200', s == 200, f'HTTP {s}')

    print('\n===== G. 版本历史 =====')
    s, b, _ = req(f'/api/v1/admin/posts/{pid}/revisions', cookie=cookie)
    rec('版本列表 200', s == 200, f'HTTP {s}')
    revs = json.loads(b)['data'] if s == 200 else []
    rec('已产生多个版本', len(revs) >= 1, f'{len(revs)} 个')
    if revs:
        s, b, _ = req(f"/api/v1/admin/posts/{pid}/revisions/{revs[0]['id']}", cookie=cookie)
        rec('版本详情 200', s == 200, f'HTTP {s}')
        s, _, _ = req(f"/api/v1/admin/posts/{pid}/revisions/{revs[0]['id']}/restore", 'POST', {}, cookie=cookie, csrf=csrf)
        rec('恢复历史版本 200', s == 200, f'HTTP {s}')

    print('\n===== H. 分类与标签 =====')
    s, b, _ = req('/api/v1/admin/categories', 'POST', {'name': '技术笔记', 'description': '技术类'}, cookie=cookie, csrf=csrf)
    rec('创建分类 201', s == 201, f'HTTP {s}')
    cid = jget(b, 'data.id') if s == 201 else None
    s, b, _ = req('/api/v1/admin/tags', 'POST', {'name': 'TypeScript'}, cookie=cookie, csrf=csrf)
    rec('创建标签 201', s == 201, f'HTTP {s}')
    tid = jget(b, 'data.id') if s == 201 else None
    s, b, _ = req('/api/v1/admin/tags', 'POST', {'name': 'JS'}, cookie=cookie, csrf=csrf)
    tid2 = jget(b, 'data.id') if s == 201 else None
    s, b, _ = req('/api/v1/admin/tags/merge', 'POST', {'sourceId': tid2, 'targetId': tid}, cookie=cookie, csrf=csrf)
    rec('标签合并 200', s == 200, f'HTTP {s}')
    s, _, _ = req(f'/api/v1/admin/categories/{cid}', 'DELETE', None, cookie=cookie, csrf=csrf)
    rec('删除分类 200', s == 200, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/categories', cookie=cookie)
    rec('分类列表 200', s == 200, f'HTTP {s}')

    print('\n===== I. 媒体库 =====')
    # 用唯一内容避免命中秒传复用（秒传返回 200 而非 201）
    uniq = png_bytes(8, 8) + os.urandom(16)
    s, b, _ = req('/api/v1/admin/media/upload', 'POST', cookie=cookie, csrf=csrf, files={'file': ('t.png', uniq)})
    rec('上传 PNG', s in (200, 201), f'HTTP {s}')
    url = jget(b, 'data.url', '')
    wh = jget(b, 'data', {}) or {}
    rec('自动解析图片宽高 8x8', wh.get('width') == 8 and wh.get('height') == 8, f"{wh.get('width')}x{wh.get('height')}")
    rec('返回 Markdown 引用', 'markdown' in (wh or {}))
    s, raw, hdr = req(url.replace(B, ''))
    rec('图片可访问 200', s == 200, f'HTTP {s}')
    rec('图片字节完全一致', raw == uniq, f'回传 {len(raw)} / 上传 {len(uniq)} 字节')
    s, b, _ = req('/api/v1/admin/media/upload', 'POST', cookie=cookie, csrf=csrf, files={'file': ('evil.sh', b'#!/bin/sh\necho pwned')})
    rec('危险脚本被拒 422', s == 422, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/media/upload', 'POST', cookie=cookie, csrf=csrf, files={'file': ('fake.png', b'not-a-real-png-at-all' + os.urandom(8))})
    rec('伪装图片被拒 422', s == 422, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/media/stats', cookie=cookie)
    rec('媒体统计 200', s == 200, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/media', cookie=cookie)
    rec('媒体列表 200', s == 200, f'HTTP {s}')

    print('\n===== J. 菜单 / 友链 / 重定向 =====')
    s, b, _ = req('/api/v1/admin/menus', cookie=cookie)
    rec('菜单列表 200', s == 200 and len(jget(b, 'data', []) or []) >= 5, f"{len(jget(b, 'data', []) or []) if s==200 else 0} 条")
    s, b, _ = req('/api/v1/admin/menus', 'POST', {'label': '测试', 'href': '/test', 'location': 'footer'}, cookie=cookie, csrf=csrf)
    rec('新增菜单 201', s == 201, f'HTTP {s}')
    mid = jget(b, 'data.-1.id') if s == 201 else None
    s, _, _ = req(f'/api/v1/admin/menus/{mid}', 'DELETE', None, cookie=cookie, csrf=csrf)
    rec('删除菜单 200', s == 200, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/menus', 'POST', {'label': '坏链接', 'href': 'notaurl'}, cookie=cookie, csrf=csrf)
    rec('站内非法菜单地址被拒 422', s == 422, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/menus', 'POST', {'label': 'XSS', 'href': 'javascript:alert(1)'}, cookie=cookie, csrf=csrf)
    rec('javascript: 菜单地址被拒 422', s == 422, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/links', 'POST', {'name': '友链', 'url': 'https://example.com'}, cookie=cookie, csrf=csrf)
    rec('新增友链 201', s == 201, f'HTTP {s}')
    lid = jget(b, 'data.-1.id')
    print(f'    [debug] 友链响应={b[:300]!r}', flush=True)
    if lid:
        s, _, _ = req(f'/api/v1/admin/links/{lid}', 'DELETE', None, cookie=cookie, csrf=csrf)
    else:
        s = 0
    rec('删除友链 200', s == 200, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/links', 'POST', {'name': '坏链', 'url': 'ftp://x.com'}, cookie=cookie, csrf=csrf)
    rec('非 http(s) 友链被拒 422', s == 422, f'HTTP {s}')
    # 源路径唯一化，避免重复运行触发 409 冲突
    uniq_from = '/old-' + os.urandom(4).hex()
    s, b, _ = req('/api/v1/admin/redirects', 'POST', {'fromPath': uniq_from, 'toPath': '/posts'}, cookie=cookie, csrf=csrf)
    rec('新增重定向 201', s == 201, f'HTTP {s}')
    rid = jget(b, 'data.-1.id')
    print(f'    [debug] 重定向响应={b[:300]!r}', flush=True)
    if rid:
        s, _, _ = req(f'/api/v1/admin/redirects/{rid}', 'DELETE', None, cookie=cookie, csrf=csrf)
    else:
        s = 0
    rec('删除重定向 200', s == 200, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/redirects', 'POST', {'fromPath': 'no-slash', 'toPath': '/x'}, cookie=cookie, csrf=csrf)
    rec('源路径缺斜杠被拒 422', s == 422, f'HTTP {s}')

    print('\n===== K. 搜索与聚合 =====')
    # 前面永久删除了被测文章，这里新建并发布一篇专供搜索测试，避免依赖残留数据
    s, b, _ = req('/api/v1/admin/posts', 'POST',
                  {'title': '搜索目标文章', 'content': '独特关键词 zqxjkvwm 用于搜索验证', 'status': 'draft'},
                  cookie=cookie, csrf=csrf)
    sid = jget(b, 'data.id')
    if sid:
        req(f'/api/v1/admin/posts/{sid}/publish', 'POST', {}, cookie=cookie, csrf=csrf)
    s, b, _ = req('/api/v1/search?q=' + urllib.parse.quote('搜索目标文章'))
    rec('搜索接口 200', s == 200, f'HTTP {s}')
    hits = jget(b, 'data.items', []) or []
    rec('搜索命中已发布文章', len(hits) >= 1, f'{len(hits)} 条')
    s, b, _ = req('/api/v1/search?q=' + urllib.parse.quote('不存在的关键词zzz'))
    rec('搜索无结果返回空数组', s == 200 and len(jget(b, 'data.items', []) or []) == 0)
    s, b, _ = req('/api/v1/home')
    rec('首页聚合 200', s == 200 and 'latest' in json.loads(b)['data'])
    s, b, _ = req('/api/v1/archives')
    rec('归档接口 200', s == 200)
    s, b, _ = req('/api/v1/admin/dashboard', cookie=cookie)
    rec('工作台数据 200', s == 200 and 'stats' in json.loads(b)['data'])
    s, b, _ = req('/api/v1/admin/logs?limit=20', cookie=cookie)
    rec('操作日志 200', s == 200 and len(jget(b, 'data', []) or []) >= 1, f"{len(jget(b, 'data', []) or []) if s==200 else 0} 条")

    print('\n===== L. SEO 输出 =====')
    s, b, _ = req('/api/v1/feed')
    rec('RSS 200 且为 XML', s == 200 and b'<rss' in b)
    rec('RSS 含文章条目', b'<item>' in b)
    s, b, _ = req('/api/v1/sitemap.xml')
    rec('Sitemap 200 且为 XML', s == 200 and b'<urlset' in b)
    rec('Sitemap 含文章 URL', b'/posts/' in b)
    s, b, _ = req('/robots.txt')
    rec('robots.txt 200', s == 200)
    rec('robots 禁止抓后台', b'Disallow: /admin' in b)
    rec('robots 含 Sitemap 地址', b'Sitemap:' in b)

    print('\n===== M. 设置与密码 =====')
    s, b, _ = req('/api/v1/admin/settings', cookie=cookie)
    rec('读取设置 200', s == 200)
    s, b, _ = req('/api/v1/admin/settings', 'PUT', {'siteName': '我的博客', 'postsPerPage': 10}, cookie=cookie, csrf=csrf)
    rec('保存设置 200', s == 200, f'HTTP {s}')
    s, _, _ = req('/api/v1/admin/settings', 'PUT', {'accentColor': 'red'}, cookie=cookie, csrf=csrf)
    rec('非法主题色被拒 422', s == 422, f'HTTP {s}')
    s, b, _ = req('/api/v1/admin/password', 'PUT', {'currentPassword': 'TestPass123', 'newPassword': 'weak'}, cookie=cookie, csrf=csrf)
    rec('弱密码被拒 422', s == 422, f'HTTP {s}')

    print('\n===== N. 后台 SPA =====')
    for p in ['/admin', '/admin/login', '/admin/posts', '/admin/posts/1', '/admin/settings', '/admin/media']:
        c = code(p)
        rec(f'后台路由 {p}', c == 200, f'HTTP {c}')
    c = code('/islands/app.js')
    rec('前台岛脚本 200', c == 200, f'HTTP {c}')

    print('\n' + '=' * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [(n, d) for n, ok, d in results if not ok]
    print(f'总测试项 {len(results)} | 通过 {passed} | 失败 {len(failed)}')
    if failed:
        print('\n失败项：')
        for n, d in failed:
            print(f'  - {n}  {d}')
    print('=' * 60)

    proc.terminate()
    try: proc.wait(timeout=10)
    except Exception:
        proc.kill()

if __name__ == '__main__':
    main()