# 候选证据复制的局部检查

这里保存本轮打包改动的局部验证。**八项 fixture 检查不计入 607 项整轮测试；真正最终的 prepare-pages 尚未运行。** 没有创建部署身份、运行浏览器、改旧 payload、提交或执行 GitHub 公开操作。

- [local-fixture-result.json](local-fixture-result.json)：八项局部检查的原始结果，原字节保留。覆盖普通文本／二进制精确复制、重复旧条目保留来源、普通报告重生成、复制中变化、旧 payload 严格拒绝、Git 未跟踪、越界／符号链接，以及 validation/native 文件路径覆盖。
- [initial-336-coverage.json](initial-336-coverage.json)：原 336 普通路径与 37 旧 QA 的实际源规划结果，373 项；原完整 validation 的 90 个实际文件引用被覆盖，代码行定位另列。对工作树当时仅含两项报告路径的临时 validation 也单列检查，不把它称为完整最终 validation。
- [local-fixture-runner-original.mjs](local-fixture-runner-original.mjs)：执行上述检查的原脚本字节。临时目录与导入路径保留原执行环境，属于执行来源归档；不作为网站运行模块，也不冒充可直接在任意目录运行的公开测试入口。
- [initial-path-proposal.json](initial-path-proposal.json)：根代理审查的初始 336 路径提案原件。SHA-256 为 `6a570c94be7fdee01bf9174fadeda345187f19c8fef9ff1f72eeeaed2bff1682`。
- [list-at-local-check.json](list-at-local-check.json)：局部检查时的普通路径清单原字节，含原 336 项与两项明确追加。SHA-256 与局部结果中的清单源哈希一致；后续清单追加不会重写此快照。

当前候选实际使用 [scripts/pages-evidence-files-3.16.json](../../scripts/pages-evidence-files-3.16.json)。其中只列显式 Git 普通文件路径；本目录和后续最终 native／图像证据会逐项追加，不加入旧 44 项 immutable payload。每次正常准备重新测量普通文件内容；准备中若文件又改变会拒绝该次复制，避免生成不对应源字节的回执。

最后测试、native 汇总与文档完成并进入最终提交后，再运行真正的 prepare-pages。它生成的 `evidence-manifest.json` 才是那次候选的完整复制清单与实际 SHA／字节回执；本目录的 fixture 结果不能替代它。
