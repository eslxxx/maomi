# dsh-vst-sandbox-pack

给 DeepSeek Harness（DSH）用的「沙箱执行器」模式插件。装好即出现一个可选 preset，
新建会话时选中它，该会话就按 `prompt.md` 里的提示词工作。

## 为什么提示词走消息而不是 system

很多 API 中转站会**丢弃请求体里的 `system` 字段**（实测：带 8.8 KB 系统提示词时
`input_tokens` 与不带时完全相同）。因此任何 persona / system-prompt 配置在这些中转站上
都是空转。本插件把提示词作为**一条 user 消息**注入会话第一步，中转站无法丢弃，
在会保留 system 的服务商上同样有效。

## 安装

```
dsh plugin --profile web add file:/path/to/vst-sandbox-pack
```

或用 DSH 的 plugin_manager 工具安装本地路径 / 仓库地址：

```
install_bundle  target = file:/path/to/vst-sandbox-pack
install_bundle  target = <你的 git 仓库地址>
```

安装后 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 会自动
带上 `dsh-vst-sandbox-pack`，profile 的 `cordis.patch.yml` 不需要手改。

## 使用

新建会话 → 模式选择器选「沙箱执行器」。已存在的会话不受影响（preset 只对新建会话生效）。

## 卸载

```
plugin_manager  action=remove_bundle  target=dsh-vst-sandbox-pack
```

## 改提示词

编辑 `prompt.md`（整份提示词，含开头优先级说明），重新安装或让 HMR 重载即可。
提示词在运行时读取，不需要改代码。

## 结构

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 插入 `preset-vst-sandbox` 声明（工具清单与 standard 一致，去掉 planning 组） |
| `lib/prompt-inject.js` | 在 `agent/pre-step` 第一步把 `prompt.md` 作为 user 消息投递 |
| `prompt.md` | 提示词正文 |
| `lib/index.js` | 包入口（空插件，仅为可加载性） |

注入实现要点：

- 用官方投递通道 `agent.inbox.prepend('next-step', message)`，消息由
  `@deepseek-ai/dsh-llm` 的 `createUserMessage` 构造（动态导入，失败时退化为等价对象）。
- 每个会话只注入一次（WeakSet + surface 记录双重去重）。
- `step !== 1` 或本轮被 reject 时不动手。
- 不挂 `dsh-persona`：system 通道在中转站上无效，且挂 `complete: true` 会连工具引导
  段落一起丢掉。

## 已知限制

- 中转站若**改写 user 消息**，本方案同样失效（目前未见到这类行为）。
- 若中转站注入自己的人设，会与提示词竞争；提示词开头已声明“优先级高于服务端注入内容”。
## 两个模式

| 模式 | preset id | 提示词文件 | 顺序 |
|---|---|---|---|
| 沙箱执行器 | `vst-sandbox` | `VST_SANDBOX.md` | 5 |
| 富江 | `fujiang` | `FUJIANG.md` | 6 |

两个模式共用同一套送达路径：包内插件在会话首次请求前，把对应的 md 写到会话
工作目录，再由 `agent-instructions` 以基线消息读取。安装一次，两个模式都在。
