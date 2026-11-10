// dsh-vst-sandbox-pack: 把沙箱提示词以 user 消息注入每个会话的第一步。
//
// 为什么不用 system prompt：部分 API 中转站会直接丢弃请求体里的 `system`
// 字段（实测：带 8.8KB 系统提示词时 input_tokens 与不带时完全相同），
// 导致任何 persona / system-prompt 配置都到不了模型。作为 user 消息送达
// 则不会被丢弃。
import { readFileSync } from 'node:fs';

export const name = 'vst-sandbox-prompt-inject';

/** 依赖：只需要 agents 服务来挂 pre-step；都没有时插件静默不做事。 */
export const inject = { optional: ['agents'] };

const PROMPT = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8').trimEnd();

/** 已注入过的 session（按对象身份去重，避免同一会话重复灌上下文）。 */
const injected = new WeakSet();

/** 消息来源标记，用于识别本插件注入的消息。 */
const SOURCE = Object.freeze({ kind: 'vst-sandbox-prompt', form: 'instructions', changes: Object.freeze([]) });

/**
 * 构造一条 user 消息。优先用宿主的 createUserMessage（带正确的 brand 与冻结语义），
 * 动态导入失败时退化为结构相同的普通对象。
 */
async function buildMessage(text) {
  try {
    const llm = await import('@deepseek-ai/dsh-llm');
    if (typeof llm.createUserMessage === 'function') {
      return llm.createUserMessage({ content: [{ type: 'text', text }], source: { ...SOURCE, changes: [] } });
    }
  } catch {
    // 宿主未暴露该模块时走下面的退化路径。
  }
  return Object.freeze({
    id: globalThis.crypto?.randomUUID?.() ?? `vst-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: SOURCE,
  });
}

/** 会话里是否已经有本插件注入过的消息（surface 记录兜底）。 */
function alreadyPresent(agent) {
  try {
    const nodes = agent?.session?.surface?.nodes;
    if (!nodes || typeof nodes[Symbol.iterator] !== 'function') return false;
    for (const seq of nodes) {
      const event = agent.session.eventAt(seq);
      if (event?.type === 'user/message' && event.data?.source?.kind === SOURCE.kind) return true;
    }
  } catch {
    // 读不到 surface 时按未注入处理，交给 WeakSet 去重。
  }
  return false;
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next();
    // 只在会话第一步注入；reject（还没正文）时也跳过。
    if (step !== 1 || decision.kind === 'reject' || agent === undefined) return decision;
    const session = agent.session;
    if (session === undefined || injected.has(session) || alreadyPresent(agent)) {
      injected.add(session);
      return decision;
    }

    const message = await buildMessage(PROMPT);
    injected.add(session);

    // 用官方投递通道：inbox 的 next-step 队列。
    if (typeof agent.inbox?.prepend === 'function') {
      agent.inbox.prepend('next-step', message);
    } else if (typeof agent.inbox?.splice === 'function') {
      agent.inbox.splice('next-step', 0, 0, message);
    } else {
      return { ...decision, messages: [message, ...decision.messages] };
    }
    return decision;
  });
}