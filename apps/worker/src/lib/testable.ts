/** 导出内部纯函数以便单元测试（不含任何业务副作用） */

const MAX_LINKS = 3;

export function looksLikeSpamForTest(text: string): boolean {
  const linkCount = (text.match(/https?:\/\//g) ?? []).length;
  if (linkCount > MAX_LINKS) return true;
  if (/(viagra|casino|crypto\s*airdrop|free\s*money|加微信|代开发票|色情|博彩)/i.test(text)) return true;
  if (/(.)\1{12,}/.test(text)) return true;
  const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const digits = text.match(/[0-9]/g)?.length ?? 0;
  if (letters > 12 && digits / Math.max(1, letters) > 0.5) return true;
  return false;
}