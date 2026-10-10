"""
补全 package-lock.json 中缺失的跨平台二进制依赖条目。

背景：npm 在 Windows 上生成的 lock 只包含 win32 平台的可选依赖，
Cloudflare 的 Linux 构建环境执行 `npm ci` 会报「lock 文件不同步」。

用法：python scripts/fix-lock-platforms.py
"""
import json
import io
import os
import subprocess
import sys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, 'package-lock.json')

# 平台包命名规则：@esbuild/<os>-<arch>、@rollup/rollup-<os>-<arch>[-<abi>]
ESBUILD_PLATFORMS = [
    'aix-ppc64', 'android-arm', 'android-arm64', 'android-x64',
    'darwin-arm64', 'darwin-x64',
    'freebsd-arm64', 'freebsd-x64',
    'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-loong64',
    'linux-mips64el', 'linux-ppc64', 'linux-riscv64', 'linux-s390x',
    'linux-x64',
    'netbsd-x64', 'openbsd-x64',
    'sunos-x64',
    'win32-arm64', 'win32-ia32', 'win32-x64'
]

ROLLUP_PLATFORMS = [
    'darwin-arm64', 'darwin-x64',
    'freebsd-x64', 'linux-arm', 'linux-arm64', 'linux-gnulibc-x64',
    'linux-musl-arm64', 'linux-musl-x64',
    'linux-x64-gnu', 'linux-x64-musl',
    'netbsd-x64', 'openbsd-x64',
    'win32-arm64-msvc', 'win32-ia32-msvc', 'win32-x64-msvc'
]

# @rollup/rollup-linux-x64 在 npm 上实际叫 gnu / musl 两个变体
ROLLUP_ALIASES = {
    'linux-x64': ['linux-x64-gnu', 'linux-x64-musl', 'linux-gnulibc-x64']
}


def npm_integrity(pkg: str):
    """从 npm registry 取 dist.{integrity,tarball}，失败返回 None。

    直接走 curl 而非 `npm view`：后者在部分沙箱环境下会静默失败。
    """
    name, _, ver = pkg.rpartition('@')
    url = 'https://registry.npmjs.org/' + name.replace('/', '%2F') + '/' + ver
    try:
        r = subprocess.run(
            ['curl', '-s', '--max-time', '25', url],
            capture_output=True, text=True, timeout=40, cwd=ROOT
        )
        if r.returncode != 0 or not r.stdout.strip():
            return None
        data = json.loads(r.stdout)
        dist = data.get('dist') or {}
        integrity = dist.get('integrity')
        if not integrity:
            return None
        return integrity, dist.get('tarball')
    except Exception:
        return None


def cpu_of(platform: str):
    if platform in ('aix-ppc64',):
        return 'ppc64'
    for arch in ('arm64', 'x64', 'ia32', 'arm', 'loong64', 'mips64el',
                 'ppc64', 'riscv64', 's390x', 'arm64'):
        if platform.endswith('-' + arch):
            return arch
    return 'x64'


def os_of(platform: str):
    p = platform.split('-')[0]
    return {'win32': 'win32', 'darwin': 'darwin'}.get(p, p)


def main() -> int:
    if not os.path.exists(LOCK):
        print('✗ 未找到 package-lock.json')
        return 1

    with io.open(LOCK, encoding='utf-8') as f:
        lock = json.load(f, object_pairs_hook=collections.OrderedDict)

    packages = lock['packages']
    added, skipped, failed = [], [], []

    # ---- 收集需要补全的 (宿主包路径, 平台, 版本) ----
    jobs = []
    for key, meta in list(packages.items()):
        if key.endswith('node_modules/@esbuild/win32-x64'):
            ver = meta.get('version')
            for pf in ESBUILD_PLATFORMS:
                target = key.replace('@esbuild/win32-x64', '@esbuild/' + pf)
                if target not in packages:
                    jobs.append(('esbuild', target, '@esbuild/' + pf + '@' + ver, meta))
        elif key.endswith('node_modules/@rollup/rollup-win32-x64-msvc'):
            ver = meta.get('version')
            for pf in ROLLUP_PLATFORMS:
                names = ROLLUP_ALIASES.get(pf, [pf])
                for name in names:
                    target = key.replace('@rollup/rollup-win32-x64-msvc', '@rollup/rollup-' + name)
                    if target not in packages:
                        jobs.append(('rollup', target, '@rollup/rollup-' + name + '@' + ver, meta))

    print(f'需补全 {len(jobs)} 个平台包')

    for kind, target, spec, template in jobs:
        got = npm_integrity(spec)
        if not got:
            failed.append(spec)
            continue
        integrity, tarball = got

        short = spec.rsplit('@', 1)[0].split('/')[-1]
        entry = collections.OrderedDict()
        entry['version'] = template.get('version')
        entry['resolved'] = tarball or (
            'https://registry.npmjs.org/' + spec.rsplit('@', 1)[0]
            + '/-/' + short + '-' + template.get('version') + '.tgz'
        )
        entry['integrity'] = integrity

        suffix = target.split('@esbuild/')[-1] if kind == 'esbuild' else target.split('rollup-')[-1]
        entry['cpu'] = [cpu_of(suffix)]
        entry['optional'] = True
        entry['os'] = [os_of(suffix)]
        if kind == 'rollup' and suffix.endswith('musl'):
            entry['libc'] = ['musl']
        elif kind == 'rollup' and suffix.endswith('gnu'):
            entry['libc'] = ['glibc']

        packages[target] = entry
        added.append(target)

    if added:
        # 保持 key 有序（npm 要求 packages 对象按字典序）
        lock['packages'] = collections.OrderedDict(sorted(packages.items(), key=lambda kv: kv[0]))
        with io.open(LOCK, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(lock, f, indent=2, ensure_ascii=False)
            f.write('\n')

    print(f'✓ 新增 {len(added)} 个，registry 无此包 {len(failed)} 个')
    if failed:
        print('  失败清单（通常是平台不存在，属正常）：')
        for x in failed[:6]:
            print('   -', x)
        if len(failed) > 6:
            print(f'   …还有 {len(failed) - 6} 个')
    return 0


if __name__ == '__main__':
    sys.exit(main())