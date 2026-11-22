# 1.2.7 排查：窗口最小化/长时间空闲后界面卡死

## 现象

- 应用打开后放置一段时间（尤其最小化、锁屏、休眠后恢复），界面卡死：画面半渲染、点击无响应；
- 重启应用恢复；
- 卡死时后端 HTTP 仍正常（`GET /` 200、47ms），Qt 主进程 CPU 很低，窗口不报「未响应」。

## 现场证据（2026-11-22）

| 指标 | 值 |
| --- | --- |
| `QtWebEngineProcess` CPU | 10 秒消耗 14.17 秒（约 1.4 核持续满载） |
| 主进程 `YueqianXingqiong` CPU | 10 秒 0.23 秒 |
| 后端 | HTTP 200 / 47 ms |
| 窗口 | 最小化（`IsIconic=True`），页面停在「对话模式」 |
| CDP 暂停 V8 调用栈 | `desktop-app-*.js:36` → `ManifoldDoodle-*.js:0:5092` → `:0:17087` |
| 压缩代码 | `for(;x.length-1<A;)`，`A=Math.floor(M.t/2800)`，`x.length>40 && (x.splice(0,20),…)` |

## 根因

`frontend/src/sketch/scenes.ts` 的凯莱图 A₅ 画面（`cayley()`）：

```ts
const walk = [0], word: string[] = []
return env => {
  const c = env.context, STEP = 2800, steps = Math.floor(env.t / STEP)
  while (walk.length - 1 < steps) {
    const here = walk.at(-1)!, useFlip = word.at(-1) !== 'a' && Math.random() < .45
    walk.push(useFlip ? flip[here]! : next[here]!); word.push(useFlip ? 'a' : 'b')
    if (walk.length > 40) { walk.splice(0, 20); word.splice(0, 20) }
  }
```

- `steps` 随 `env.t` 单调增长（每 2800ms 一步）；
- `walk` 每超过 40 条就被裁剪回 21 条，`walk.length - 1` 最大约 40；
- 因此 `steps > 40`（画面播放约 115 秒）时，循环条件永远成立 → 同步死循环；
- 窗口隐藏/休眠时 rAF 暂停，恢复后 `env.t` 一次跳几分钟到几小时，会立刻触发该状态；
- 死循环占满渲染线程，Vue 更新与重绘停止，表现为卡死；Qt 主线程空闲，所以系统层面「窗口有响应」。

## 修复

1. 新增 `frontend/src/sketch/walk.ts`：
   - `WalkState = { walk, word, done }`，`done` 是绝对步数；
   - `advanceWalk(state, targetSteps, next, flip, random)`：`targetSteps - done > 40` 时只补最近 40 步（`CATCH_UP`），循环上限 41 次；
   - 视觉语义不变：仍按 a/b 方向随机走相邻顶点，数组仍只保留最近一段用于绘制。
2. `scenes.ts` 的凯莱图画面改用 `advanceWalk(stroll, stepsAt(env.t), next, flip)`；`STEP` 导出后继续用于笔迹淡入。
3. 单测 `frontend/tests/unit/sketch-walk.test.mjs` 6 项：t=0、正常帧、逐帧与单次一致、10 小时跳变、反复大跳变、跳变后恢复。

## 验证数据

| 版本 | 操作 | 结果 |
| --- | --- | --- |
| 旧版（安装版 1.2.2） | 注入 rAF 时间戳 +200s（模拟休眠恢复） | 渲染进程 10 秒吃 **11.73 秒 CPU**，页面 evaluate 不返回 |
| 旧算法模拟 | 41 步 | 循环超过 100000 次未退出（死循环确认） |
| 修复版（1.2.7 源码） | 同上注入 | 10 秒 CPU 3.72 秒（正常动画开销），页面 **3ms** 响应 |
| 修复版 | 正常播放 130 秒（越过旧 41 步阈值） | 页面 4ms 响应，CPU 约 27% 单核 |

测试：前端 618 项（新增 6 项）、后端 88 项；vue-tsc、构建通过。

## 同类排查

- `scenes.ts:225` 洛伦兹吸引子：已有 `if (target - done > 40) done = target - 40` 封顶；
- `scenes.ts:512` 生命游戏：已有 `target - done > 2` 封顶；
- `scenes.ts:588` 画面切换：已有 `env.t - since > STEP*3` 的跳变保护；
- 其余 `while`（树遍历、图遍历、生长模拟）都受结构或数量上限约束；
- `networks.ts` 无时间驱动的无界循环。

## 未做 / 后续可选

- 渲染进程看护（CPU 持续满载自动重载）未做：根因已修，避免误伤大 PDF 正常渲染；
- `/events` 断线重连、记忆请求超时仍为既有待办，与本问题无关。
