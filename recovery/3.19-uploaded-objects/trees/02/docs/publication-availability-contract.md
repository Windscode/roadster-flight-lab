# 发布资料合同

网站使用 `publication/availability.json` 的显式清单。原开发提交、树、运行构建与完整历史包身份保持独立；`prepare-pages.mjs` 从实际 Git HEAD 生成发布提交和发布树，原作者及日期没有被重新声明。

每个路径只能属于一种类别：

| 类别 | 检查与发布行为 |
| --- | --- |
| `runtime-required` | 运行文件必须存在，字节数、SHA-256 与 Git blob SHA 必须匹配；`dist/` 去前缀后复制到站点根目录。 |
| `online-evidence` | 公开的源码、测试输入、报告、原资料等必须存在且严格匹配身份，然后逐文件复制到真实 URL 对应位置。 |
| `archived-not-published` | 记录原路径、字节数、哈希、开发提交、构建、完整历史包和真实保存状态；`publiclyAvailable` 必须为 false，禁止 `onlineURL`，不复制、不计入在线文件量。 |

没有单独 `source` 的条目按清单的明确声明继承顶层开发身份；离线项仍需独立写出归档路径和保存状态。本地原件存在、完整历史包存在、保存准备失败和成功保存是不同状态。没有成功回执时不能写成成功保存。

顶层 `source` 表示原开发运行与证据基线。本轮新建或修改的发布脚本、专项测试、发布说明须另外声明 `origin.kind: publication-patch`，不假称这些新文件已在原始开发历史包内。每个当前公开文件的实际字节身份独立列在合同中，发布准备还核对它们与真实 HEAD 的 Git blob；未提交的普通文件不能被标成已提交发布源码。

原 `repository-payloads/manifest.json` 与 `dist/validation.json` 保持原字节。发布恢复根据合同从完整 payload 清单选择公开项，严格验证所选压缩段及恢复结果；没有公开的 QA 段不会阻塞网站。默认 `repository-payloads.mjs restore/verify` 仍表示完整归档范围。

`check-static.mjs` 默认执行公开子集检查，将新检查写到被忽略的 `.runtime/publication-check.json`，不覆盖原报告。完整开发回归显式使用 `check-static.mjs --full-archive`。两种结果分别记录，不互相代替。

`prepare-pages.mjs` 对原 validation 的每个 `qa/`、`docs/` 字面路径生成可用性覆盖表；带行号的代码引用也要分类。未分类引用直接失败。报告的通过、失败、未测事实不因大原始数据未上线而被改写。网站 `availability.html` 说明哪些原始数据没有在线下载，`availability.json` 提供逐文件身份。

运行 JS、HTML、CSS 和 Markdown 另有 `dist/` 源码浏览副本，必须与站点根目录对应文件字节一致。`evidence-manifest.json` 的文件数与字节数只统计实际复制的证据，运行文件、生成发布元数据和未发布归档各自独立列出。

发布检查命令与现有 Pages 工作流相同：

```sh
node scripts/check-static.mjs
node scripts/prepare-pages.mjs
```

专项故障检查使用：

```sh
node tests/publication-contract.test.mjs
```

缺运行文件、在线哈希不符、离线身份或真实保存状态缺失、离线虚报 URL、未分类引用、未分类 payload、运行压缩段损坏均须失败。完整归档恢复与公开子集恢复使用分别标识的测试，不将小夹具检查称为完整项目恢复。
