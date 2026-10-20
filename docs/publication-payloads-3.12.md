# 3.12 完整数值数据的发布清单

3.12 沿用仓库已有的无损 gzip 分块机制保存四份完整数值 JSON。文件仍以原名还原到原目录；所有曲线、样本、统计和 Git blob 身份与已通过完整验证的本地提交一致。生产代码和模型构建未变化。

## 新增原文件

| 原始文件 / 下载 | 原始字节 | 压缩字节 | 分段数 |
|---|---:|---:|---:|
| [qa/braking-controls-curves-3.12.json](https://windscode.github.io/roadster-flight-lab/qa/braking-controls-curves-3.12.json) | 1,601,124 | 614,863 | 4 |
| [qa/fixtures/numerical-control-capture-city-3.12.json](https://windscode.github.io/roadster-flight-lab/qa/fixtures/numerical-control-capture-city-3.12.json) | 9,426,546 | 1,822,682 | 10 |
| [qa/research-recovery-grid-curves-3.12.json](https://windscode.github.io/roadster-flight-lab/qa/research-recovery-grid-curves-3.12.json) | 2,622,692 | 551,922 | 3 |
| [qa/vehicle-dynamics-curves-3.12.json](https://windscode.github.io/roadster-flight-lab/qa/vehicle-dynamics-curves-3.12.json) | 6,468,076 | 2,679,951 | 14 |

本轮新增 20,118,438 B 原文件，保存为 5,669,418 B、31 个分段。原有 10 项清单及其分段原样保留；合计 14 项原文件、47,190,458 B。Pages 在构建时恢复数值数据，只有打开链接时才下载，城市启动不加载这些 QA JSON。

## 校验与复现

`node tests/repository-payloads.test.mjs` 已在空目录中还原全部 14 项，并逐字节对照原文件；重复还原、保留本地修改、拒绝符号链接和损坏分段的原有检查通过。每个新 JSON 又独立与本地已验证提交 `5d59e4ba560f0c7578d086c1cca7b7bcd8f00e55` 的原 Git 对象比较 SHA-256。该本地提交用作数值来源身份，不是公开发布 SHA；真实公开提交由线上 `deployment.json` 记录。

新目录完整性报告：[qa/repository-payloads-3.12.json](../qa/repository-payloads-3.12.json)。逐文件来源、SHA-256、原 Git blob ID 和分块哈希：[qa/public-payload-review-3.12.json](../qa/public-payload-review-3.12.json)与[manifest](../repository-payloads/manifest.json)。

新克隆运行 `npm start`、`npm test` 或 `npm run validate` 时会先还原；也可执行 `npm run payloads:restore`。单独执行依赖这些数据的脚本前需先还原。普通还原保留已有本地修改，严格 Pages 准备遇到未归档修改会拒绝发布。

此次调整源于约 9.4 MB 原始 JSON 的一次直接上传在 444.8 秒内未返回结果，随后被中止；没有返回可证实的硬大小上限。采用既有分块方式避免重复长时间等待，没有删减数据或改变运行模型。用户上传的原始条纹 PNG 继续排除在公开 Git 与 Pages 之外。
