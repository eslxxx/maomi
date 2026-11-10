// dsh-vst-sandbox-pack: 把沙箱提示词作为会话的“工作区指令”送达。
//
// 送达路径：本插件在会话首次请求前，把包内 prompt.md 写到该会话的工作目录
// （VST_SANDBOX.md），再由 @deepseek-ai/dsh-agent-instructions 以基线消息
// 读取并注入。这条路径与用户自己说的话分开，不会改写、也不会出现在用户的
// 消息里；同时中转站也拦不住（它不是 system 字段）。
//
// 为什么不用 system prompt：部分 API 中转站会丢弃请求体里的 `system` 字段
// （实测：带 8.8KB 系统提示词时 input_tokens 与不带时完全相同）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'vst-sandbox-prompt';

// 不声明服务注入：本插件只消费 agent/pre-step 的事件参数。
// （写成 { optional: [...] } 会被 Cordis 当成"等待名为 optional 的服务"，永不激活。）

const PROMPT = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8');
const FILE = 'VST_SANDBOX.md';

/** 已处理过的 session（按对象身份去重）。 */
const handled = new WeakSet();

/** 把提示词文件同步到会话工作目录；内容不同才写，避免无谓的 mtime 变化。 */
function ensureFile(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return;
  const target = join(cwd, FILE);
  try {
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf8');
      if (current === PROMPT) return;
    } else {
      mkdirSync(cwd, { recursive: true });
    }
    writeFileSync(target, PROMPT);
  } catch {
    // 工作目录不可写时静默跳过：模式仍可运行，只是没有指令注入。
  }
}

export function apply(ctx) {
  // 在 agent-instructions 读取文件之前落地（本 handler 在 next() 前执行）。
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (agent !== undefined && agent.session !== undefined && !handled.has(agent.session)) {
      handled.add(agent.session);
      ensureFile(agent.session.header?.cwd);
    }
    return next();
  });
}