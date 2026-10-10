import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, assertPasswordStrength, randomToken, sha256Hex } from '../apps/worker/src/lib/crypto';
import { HttpError } from '../apps/worker/src/lib/http';
import { looksLikeSpamForTest } from '../apps/worker/src/lib/testable';

describe('密码哈希与校验', () => {
  it('生成 pbkdf2 格式哈希', async () => {
    const hash = await hashPassword('SecurePass123');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(hash.split('$')).toHaveLength(4);
  });

  it('相同密码生成不同哈希（随机盐）', async () => {
    const a = await hashPassword('SecurePass123');
    const b = await hashPassword('SecurePass123');
    expect(a).not.toBe(b);
  });

  it('正确密码校验通过', async () => {
    const hash = await hashPassword('SecurePass123');
    await expect(verifyPassword('SecurePass123', hash)).resolves.toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('SecurePass123');
    await expect(verifyPassword('WrongPass123', hash)).resolves.toBe(false);
  });

  it('哈希不含明文密码', async () => {
    const hash = await hashPassword('MySecret123');
    expect(hash).not.toContain('MySecret123');
  });

  it('损坏的哈希返回 false 而非抛错', async () => {
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2$abc$salt$hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2$1000$zz$zz')).resolves.toBe(false);
  });

  it('空密码校验失败', async () => {
    const hash = await hashPassword('SecurePass123');
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });
});

describe('密码强度校验', () => {
  it('拒绝过短密码', () => {
    expect(() => assertPasswordStrength('Ab1')).toThrow(HttpError);
  });

  it('拒绝纯字母密码', () => {
    expect(() => assertPasswordStrength('abcdefghijkl')).toThrow(/字母和数字/);
  });

  it('拒绝纯数字密码', () => {
    expect(() => assertPasswordStrength('12345678901')).toThrow(/字母和数字/);
  });

  it('拒绝过长密码', () => {
    expect(() => assertPasswordStrength('a1'.repeat(150))).toThrow(/过长/);
  });

  it('接受合规密码', () => {
    expect(() => assertPasswordStrength('SecurePass123')).not.toThrow();
  });
});

describe('会话令牌', () => {
  it('生成 64 位十六进制令牌', () => {
    const token = randomToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it('每次生成不同令牌', () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it('SHA-256 输出稳定且为 64 位十六进制', async () => {
    const hash = await sha256Hex('test');
    expect(hash).toHaveLength(64);
    expect(await sha256Hex('test')).toBe(hash);
    expect(await sha256Hex('other')).not.toBe(hash);
  });
});

describe('垃圾评论识别', () => {
  it('识别超量链接', () => {
    const spam = `看看这些 ${'https://a.com '.repeat(4)}`;
    expect(looksLikeSpamForTest(spam)).toBe(true);
  });

  it('识别博彩关键词', () => {
    expect(looksLikeSpamForTest('加微信代开发票 casino')).toBe(true);
  });

  it('识别重复字符', () => {
    expect(looksLikeSpamForTest('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('正常评论不误判', () => {
    expect(looksLikeSpamForTest('写得很棒，学到了！')).toBe(false);
    expect(looksLikeSpamForTest('这个方案我试过了，TypeScript 的类型推断确实很强。')).toBe(false);
    expect(looksLikeSpamForTest('参考 https://developer.mozilla.org 文档解决了问题')).toBe(false);
  });
});