// dsh-vst-sandbox-pack 包入口。Bundle 的 patch 由 cordis.patch.yml 提供；
// 这里只导出空插件，使包本身可被 Cordis 加载（有些宿主会先 import 包主线）。
export const name = 'dsh-vst-sandbox-pack';

export function apply() {
  // 本包的全部行为都由 cordis.patch.yml 里的 preset 声明与
  // ./prompt-inject 提供，入口本身不注册任何东西。
}