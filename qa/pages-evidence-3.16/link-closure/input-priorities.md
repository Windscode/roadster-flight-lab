# 候选可点击链接清点：供根代理决定追加范围

只读推导，未执行 prepare、未建候选目录，未修改 runtime、445 路径清单或旧 44 payload。以下为按计划复制后链接是否有目标的判断，不是已上线 HTTP 404 记录。

快照：2026-10-20T20:25:56.492Z。445 个普通文件；44 个旧 payload 精确保留为 7 个 runtime / 37 个 QA；runtime 242 个；38 个已选 Markdown/HTML 文件。582 个本地实际链接中 511 个已有文件或目录 index，56 个缺口引用指向 repo 中实际存在的 43 个不同文件；其余 15 个是旧资产说明中的路径或原图缺口。代码块、内联代码、HTML 注释与脚本文字不计链接；已用独立惰性解析夹具确认。

## 优先级与边界

1. 两份当前 README 各有 63 个本地链接，55 个覆盖、8 个缺口；两版缺口指向同一组 6 份继承说明，合计 92,513 B。它们是用户实际会点击的主要文档缺口。
2. 两个当前原图索引的 99 个本地链接全部覆盖；4 个 runtime HTML 的 15 个本地 href/src/返回入口全部覆盖。export-worker.js、export-encoder.js、export-download.js 都存在、已跟踪并包含在 runtime 复制集合。没有把旧参考素材说明的断链称作运行纹理缺失。
3. 当前 3.16 城市/反射专项另有 3 个实际 QA 原始文件缺口，合计 36,275 B。
4. 当前专项文档/QA 打包 README 有 10 个显式测试/脚本源码链接（195,269 B），其中包含普通路径清单自身；这些是开发者可点击源码，不能默认为运行门槛。当前普通复制 helper 仅接收 qa/docs/README 路径，是否显式扩充少量源码证据须由根代理决定，不能仅把这些路径塞入现有 list 后称可准备。
5. 3 个 ../dist/... 链接的源码已经复制到了站点根部对应路径，缺的是链接位置。增加相同 runtime 文件不能自动修好既有 URL；是否提供明确源码浏览映射或调整文档导航须按 repo 与站点两种相对根分别处理。
6. DEVELOPMENT 的其他历史说明、根目录旧版本 notes、旧 physics-3.9 原始数据/测试源码，以及参考/景观资产说明的旧图片链接单独保留。没有向未选择的旧文档递归扩张闭包，也没有把全部历史链接提升为发布 gate。
7. 快照时 ordinary 445 项中有 103 项尚未跟踪（新生成证据待最终 stage）；全部源文件存在。这是最终提交前状态，尚不能执行严格 prepare。清单、payload manifest、prepare/helper、model-build 和全部扫描文档的 SHA 在本次扫描前后未改变。

## A：当前 README 的 6 个文档缺口

- `docs/acceptance-3.15.md` — 24,999 B
- `docs/release-3.14.md` — 11,702 B
- `docs/release-3.15.md` — 9,972 B
- `docs/research-platform-3.14.md` — 19,641 B
- `docs/research-value-3.15.md` — 7,091 B
- `docs/x-flip-3.13.md` — 19,108 B

## B：当前报告的 3 个原始 QA 缺口

- `qa/fixtures/city-lighting-3.15-before.json` — 21,713 B；来自 `docs/city-quality-3.16.md`
- `qa/fixtures/reflection-feedback-3.15/manifest.json` — 742 B；来自 `docs/reflection-feedback-3.16.md`
- `qa/reflection-feedback-observed-3.15.json` — 13,820 B；来自 `docs/reflection-feedback-3.16.md`

## C：当前报告/打包说明的可点击源码缺口

- `scripts/native-controls-3.16.mjs` — 37,547 B
- `scripts/pages-evidence-files-3.16.json` — 59,355 B
- `tests/capture-scheduler-3.16.test.mjs` — 14,489 B
- `tests/contact-geometry-oracle-3.16.mjs` — 3,907 B
- `tests/fixtures/capture-scheduler-before-3.16.json` — 11,539 B
- `tests/fixtures/wheel-force-pass-before-crown-3.16.mjs` — 15,256 B
- `tests/fixtures/wheel-support-three-station-before-3.16.mjs` — 5,408 B
- `tests/reflection-feedback-3.16.test.mjs` — 13,482 B
- `tests/reflection-stability-3.12.test.mjs` — 20,612 B
- `tests/visual-corridor-3.9.test.mjs` — 13,674 B

## D：已经复制、但链接仍保留 dist 前缀

| 链接目标源码 | 已复制的站点路径 | 实际引用文档 |
| --- | --- | --- |
| `dist/physics-3.9-notes.md` | `physics-3.9-notes.md` | `docs/DEVELOPMENT.md` |
| `dist/vendor/three.module.js` | `vendor/three.module.js` | `docs/reflection-feedback-3.16.md` |
| `dist/wet-road-reflection.js` | `wet-road-reflection.js` | `docs/reflection-feedback-3.16.md` |

## E：其他历史/维护文档与旧链接（不自动升级 gate）

- `3.5-UPDATE-NOTES.md` — 16,907 B；类别 other；来源 `docs/DEVELOPMENT.md`
- `3.6-UPDATE-NOTES.md` — 7,449 B；类别 other；来源 `docs/DEVELOPMENT.md`
- `3.7-UPDATE-NOTES.md` — 14,940 B；类别 other；来源 `docs/DEVELOPMENT.md`
- `3.8-UPDATE-NOTES.md` — 11,060 B；类别 other；来源 `docs/DEVELOPMENT.md`
- `docs/braking-controls-3.12.md` — 15,273 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/chase-camera-3.12.md` — 2,573 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/control-capture-3.11.md` — 5,958 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/history/README-3.8.md` — 31,153 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/reflection-stability-3.12.md` — 9,875 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/release-3.11.md` — 18,498 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/release-3.12.md` — 9,741 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/research-robustness-3.11.md` — 9,215 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/sampler-budget-3.13.md` — 12,232 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/vehicle-dynamics-3.11.md` — 18,399 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/visual-3.13.md` — 7,336 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `docs/visual-quality-3.13.md` — 11,413 B；类别 docs；来源 `docs/DEVELOPMENT.md`
- `qa/physics-controls-3.9-baseline.json` — 79,164 B；类别 qa；来源 `dist/physics-3.9-notes.md`
- `qa/physics-controls-3.9.json` — 179,572 B；类别 qa；来源 `dist/physics-3.9-notes.md`
- `repository-payloads/README.md` — 2,405 B；类别 other；来源 `docs/DEVELOPMENT.md`
- `tests/physics-controls-3.9.test.mjs` — 18,385 B；类别 tests；来源 `dist/physics-3.9-notes.md`
- `tests/physics-fixtures-3.9.mjs` — 9,062 B；类别 tests；来源 `dist/physics-3.9-notes.md`

## 其他不存在的旧链接

- `dist/assets/landmarks/README.md` 中 3 张旧隔离资产图引用会越出 GitHub Pages 项目根；当前 repo 也未找到目标。
- `dist/assets/references/README.md` 中 12 张 Tesla 原参考 JPG 在当前 repo 未找到；prepare 既有规则也不接受该类参考 JPG。它们不是本轮新原图索引，不据此补下载或更改复制规则。

机器清单 `candidate-local-link-review.json` 保留全部 582 个链接、实际 href/src、源 SHA、候选 URL、repo 路径、被复制的路径、分类与每个真实缺口目标的 SHA/字节数。`candidate-local-link-review.md` 为完整表。`inert-parser-boundary-check.json` 是单独的解析边界检查，不计入整轮 607 条声明断言。
