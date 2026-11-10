// 「富江」模式的提示词落地：把包内 prompt-fujiang.md 写到会话工作目录的
// FUJIANG.md，再由 @deepseek-ai/dsh-agent-instructions 以基线消息读取。
//
// 与 prompt-inject.js 同一套送达路径（见 README 的“送达路径”）：不写入
// system 字段，也不改写用户消息。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'fujiang-prompt';

const PROMPT = readFileSync(new URL('../prompt-fujiang.md', import.meta.url), 'utf8');
const FILE = 'FUJIANG.md';

/** 已处理过的 session（按对象身份去重）。 */
const handled = new WeakSet();

/** 把提示词文件同步到会话工作目录；内容相同则不写，避免无谓的 mtime 变化。 */
function ensureFile(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return;
  const target = join(cwd, FILE);
  try {
    if (existsSync(target)) {
      if (readFileSync(target, 'utf8') === PROMPT) return;
    } else {
      mkdirSync(cwd, { recursive: true });
    }
    writeFileSync(target, PROMPT);
  } catch {
    // 工作目录不可写时静默跳过：模式仍可运行，只是没有指令注入。
  }
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent !== undefined && agent.session !== undefined && !handled.has(agent.session)) {
      handled.add(agent.session);
      ensureFile(agent.session.header?.cwd);
    }
    return next();
  });
}