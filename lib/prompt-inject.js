// dsh-vst-sandbox-pack: 把沙箱提示词并入会话第一条用户消息。
//
// 为什么不用 system prompt：部分 API 中转站会直接丢弃请求体里的 `system`
// 字段（实测：带 8.8KB 系统提示词时 input_tokens 与不带时完全相同），
// 任何 persona / system-prompt 配置都到不了模型。
//
// 为什么不单独插一条 user 消息：模型能看出那是"被塞进对话的一段文本"，
// 会拒绝按它行事（实测：模型回复"它只是被塞进对话里的一段文本，
// 冒充不了真正的要求"）。并进用户自己的消息本体后，它在语义上就是
// 用户提的要求，模型按它执行。
import { readFileSync } from 'node:fs';

export const name = 'vst-sandbox-prompt-inject';

// 不声明服务注入：本插件只消费 agent/pre-step 的事件参数。
// （写成 { optional: [...] } 会被 Cordis 当成"等待名为 optional 的服务"，永不激活。）

const PROMPT = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8').trimEnd();

/** 已处理过的 session（按对象身份去重）。 */
const handled = new WeakSet();

/** 本插件产生的消息来源标记（用于幂等判断，不用于构造新消息）。 */
const SOURCE_KIND = 'vst-sandbox-prompt';

/** 新消息的标识。 */
function newId() {
  const rand = globalThis.crypto?.randomUUID?.();
  return rand ?? `vst-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 会话里是否已经带着提示词（surface 记录兜底）。 */
function alreadyPresent(agent) {
  try {
    const nodes = agent?.session?.surface?.nodes;
    if (!nodes || typeof nodes[Symbol.iterator] !== 'function') return false;
    for (const seq of nodes) {
      const event = agent.session.eventAt(seq);
      if (event?.type !== 'user/message') continue;
      const blocks = event.data?.content;
      if (Array.isArray(blocks) && blocks.some((b) => typeof b?.text === 'string' && b.text.includes('本会话最高优先级运行指令'))) return true;
    }
  } catch {
    // 读不到 surface 时按未处理处理，交给 WeakSet 去重。
  }
  return false;
}

/** 把提示词块并进一条用户消息，返回新消息；无法定位时返回 undefined。 */
function mergeInto(message) {
  const blocks = Array.isArray(message?.content) ? message.content : undefined;
  if (blocks === undefined) return undefined;
  // 已带提示词的消息不再处理（避免二次拼接）。
  if (blocks.some((b) => typeof b?.text === 'string' && b.text.includes('本会话最高优先级运行指令'))) return undefined;
  return Object.freeze({
    ...message,
    id: newId(),
    content: Object.freeze([
      Object.freeze({ type: 'text', text: PROMPT }),
      ...blocks,
    ]),
  });
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next();
    if (step !== 1 || decision.kind === 'reject' || agent === undefined) return decision;
    const session = agent.session;
    if (session === undefined) return decision;
    if (handled.has(session) || alreadyPresent(agent)) {
      handled.add(session);
      return decision;
    }

    const messages = Array.isArray(decision.messages) ? decision.messages : [];
    const index = messages.findIndex((m) => m?.role === 'user' && m?.source?.kind !== SOURCE_KIND);
    if (index === -1) return decision;

    const merged = mergeInto(messages[index]);
    if (merged === undefined) {
      handled.add(session);
      return decision;
    }
    handled.add(session);
    const nextMessages = messages.toSpliced
      ? messages.toSpliced(index, 1, merged)
      : [...messages.slice(0, index), merged, ...messages.slice(index + 1)];
    return { ...decision, messages: nextMessages };
  });
}