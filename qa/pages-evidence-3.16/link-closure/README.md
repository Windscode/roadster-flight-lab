# 已选文档的本地链接与包装复核

本目录保存 3.16 候选包装层的后续修复。原 19:37 的八项 fixture 原始脚本、结果和清单仍保留在上级目录，未改字节。本目录的新检查独立于 607 条应用声明断言；真正最终的 `prepare-pages` 和部署身份由完成最终提交后的独立步骤生成。

已选的 README、3.16 文档和原图索引中，原审查发现 43 个实际存在的 repository 目标没有出现在对应候选 URL。本次将这 43 个路径逐一加入普通清单，不扩大历史文档的递归链接范围，也不抓取缺少的旧参考图。

- [原链接审查输入](input-review.json)及[原优先级说明](input-priorities.md)保留第一次只读审查的原字节和 445 路径快照。其“尚未覆盖”状态属于修复前。
- [原解析脚本](input-audit-runner-original.mjs)与[惰性解析边界检查](input-parser-boundary-check.json)保留实际提取方式；脚本归档中的 scratch 路径是原执行来源，不作为站点应用入口。
- [精确决定](decision.json)列出批准的 43 个路径及原审查 SHA。路径清单自身因本次显式追加而正常变化，其余 42 个目标保持审查时的原字节。
- [新局部 runner](local-fixture-runner.mjs)和[实际结果](local-fixture-result.json)重跑原八项检查，并增加五项源码类别、三份 `dist/` 浏览副本及复制保护检查。可从源码仓库执行 `node qa/pages-evidence-3.16/link-closure/local-fixture-runner.mjs /absolute/scratch/output`；它只在指定临时目录创建合成 fixture。
- [覆盖和原字节复核](closure-coverage.json)只重核原审查的链接集合，并检查当前三个 packaging 文档的新链接。它不声称后来追加的全部旧文档不存在更多历史断链。
- [本次局部检查清单](list-at-link-closure.json)冻结本次检查使用的普通路径表；后续最终 native/路线追加不覆写该快照。

`dist/physics-3.9-notes.md`、`dist/wet-road-reflection.js`、`dist/vendor/three.module.js` 在候选中保持原目录，是供文档读取的源码副本。应用仍从站点根部原路径加载，未增加应用 import。逐文件 metadata 明确这些副本的用途和根部对应路径，prepare 在实际复制时检查二者字节相同。

原 44 项 immutable payload 的清单、源字节与严格拒绝规则保持不变。本次只处理本地候选可访问性，没有执行 GitHub 公开操作，也没有删掉任何受阻对象或历史证据。尚未 Git 跟踪的新归档要在最终正常提交前完成跟踪；fixture 成功不能替代最终候选的实际复制回执。
