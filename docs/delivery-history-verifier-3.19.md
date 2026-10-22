# 3.19 交付历史独立恢复验证器

`scripts/verify-delivery-history-3.19.py` 用两个全新 bare 仓库验证完整历史与基线加增量历史。它不依赖开发仓库对象、worktree 或 alternates，不生成模型身份，也不修改 runtime。脚本以明确传入的预期 commit、tree、build 和 modelVersion 为判断依据。

## 恢复过程

1. 只读检查三个 bundle 的头、前提提交和 SHA-256。新 full 必须是非 symlink、单硬链接的普通文件，不能与 baseline / incremental 为同一文件。只有明确提供 `--memory-cycle` 后才会进入下一步。
2. 新 full 完整读入 RAM，RAM SHA 与磁盘再次读取的 SHA 严格一致，文件身份在读取期间未变；然后只把这个新生成、可重建的 full 副本临时移出磁盘。
3. 新建空 bare 仓库。把 RAM 中 bundle 头之后的 pack 通过 `git index-pack --stdin` 导入，恢复全部 advertised refs，运行 `git fsck --full`，验证预期 tip 与 tree。
4. 从 `git archive <tip> dist` 的 tar 流读取全部 JS / HTML / CSS，逐个核 `MODEL_SOURCE_HASHES`，按构建器的排序与 JSON 合并规则核聚合 build。另以 `git ls-tree` 比较完整源码清单，`export-ignore` 不能藏掉新增源码。不会把 tar 解包到磁盘。
5. 删除第一个脚本自建 bare。另建新的 bare，从原 3.18 full 文件的 pack offset 直接只读导入，核 baseline；在这一路实际运行 `git bundle verify` 和 `git bundle unbundle` 应用新 incremental，然后核相同 tip、tree、源码清单及 build。
6. `finally` 清除仍存在的脚本自建 bare，把原 RAM 字节恢复到 full 原路径。先写新临时文件、fsync、核 SHA，再用不覆盖现存文件的原子硬链接发布；不产生第二份完整磁盘 pack。最终 full SHA 必须与操作前严格一致。

Git 子进程清除继承的 `GIT_*` 环境，禁用全局/系统配置、hooks 与自动维护，使用空初始化模板，并在导入前后检查没有 object alternates。包含 linked-worktree HEAD 的历史 bundle 头也经过小型真实 fixture 检查。

## 调用

先完成本地提交和 bundle 生成，再提供真实身份。下面的占位符应从最终交付身份填写；验证器不会替源码重新指派版本。

```text
python scripts/verify-delivery-history-3.19.py
  --full-bundle <新3.19_full.bundle绝对路径>
  --baseline-bundle /workspace/scratch/550d690c6c6d/deliverables-318/Roadster_Flight_Lab_3.18_full.bundle
  --incremental-bundle <新3.19_incremental.bundle绝对路径>
  --baseline-commit eb2ca9d67f5b9fe7a81907f5304646e585a535e6
  --baseline-tree 33f4463d70b8490ec74735a28df58ac8e3fea255
  --expected-commit <最终40位commit>
  --expected-tree <最终40位tree>
  --expected-build <最终64位build>
  --expected-model-version 3.19.0
  --expected-full-sha256 <生成后full的SHA256>
  --expected-baseline-sha256 <原3.18_full的SHA256>
  --expected-incremental-sha256 <生成后incremental的SHA256>
  --temp-root <已有且可写的临时目录>
  --receipt <尚不存在的JSON路径>
  --memory-cycle
```

三个 `--expected-*-sha256` 是可选的外部身份核对，其他示例中的主要身份参数必填。没有提供外部 SHA 时也会计算、记录并核对实际 RAM / 磁盘字节身份。Receipt 必须是新路径，不能覆盖先前尝试。原 3.18 bundle 与开发仓库没有写入口。

## 磁盘与中断边界

设新 full 为 `F`，原 baseline 为 `B`，增量包为 `I`。当三个产物已经存在时，cycle 会释放 `F`，临时峰值是一个 full pack，或 baseline pack 加已修复薄包的 incremental pack；两路不会同时保留。初步预算为 `max(F, B + I) + max(64 MiB, max(F, B + I)/16)`，同时保留索引余量。薄包修复可能追加原 delta base 对象，预检不是空间预留，也不能事先保证其最终大小。

若 `F ≈ 700 MiB`、`B ≈ 639 MiB`、`I ≤ 100 MiB`，初步临时预算约 `803 MiB`。在生成 full 之前有约 `970 MiB` 空闲且其他工作不继续占用时，约有 `167 MiB` 余量。实际生成后以精确大小和可用空间重新检查；不通过时保留所有输入并退出，不通过删除旧成果来满足预算。

普通 Python 异常、Git 失败以及 SIGINT / SIGTERM 会进入恢复逻辑。SIGKILL、进程内存被强制销毁或宿主断电无法执行 `finally`，因此 `--memory-cycle` 只能用于此次新生成、可从保留历史重新生成的 full 副本。若原路径出现并发写入的不同文件，脚本拒绝覆盖并明确报错。原 baseline 和源码历史仍保留。

## 已执行的验证范围

`python tests/verify-delivery-history-3.19.test.py` 创建并清理小型真实 Git 仓库，覆盖：独立双路恢复、继承 alternates / Git 目录被忽略、linked-worktree advertised ref、导入后异常仍恢复原 SHA、实际 SIGTERM 发生在 full 离盘后仍恢复、缺显式开关/基线别名/symlink 拒绝、`export-ignore` 不能隐藏未登记 JS。报告为 `qa/verify-delivery-history-fixture-3.19.json`。

小型 fixture 通过不等于大交付 bundle 已通过。真实交付必须另行调用脚本并保留独立 JSON receipt。
