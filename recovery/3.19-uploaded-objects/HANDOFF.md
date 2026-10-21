# Roadster 接续记录 — 2026-10-21 16:51 UTC

## 当前发布状态

main 仍为 a0fce89e55efe6eaa54210987ef07cf9dfd7171e（3.16）。3.19 和 3.20 尚未上线。本次恢复快照首提交 d1014f41fe82a686e584ad55aa72f43cb9e4ed91，parent 为该 main；根目录全部 23 项原 tree/blob 引用逐项确认未改，只新增 recovery 目录。23 棵临时树、validation、vehicle-models、一个 gzip chunk 的 SHA 引用全部读回核对匹配。

## 这次实际读取和保全

原3.19 manifest（44 entries / 344次chunk引用）与增量manifest（80 entries / 512次引用、470个唯一chunk路径）逐项比对，原条目零丢失、零改变。原validation 268601 bytes、191源码SHA256、build b734be6afe0bc10ed38c403081625b48931e4e24df72512796e7e51797b7d230 由实际原文件重新读取确认。恢复脚本与合同源码按Git blob校验，未重新实现。

公开main的完整递归tree含2032项、truncated=false。将其与完整payload清单及已确认的独立chunk比较，目前有288个chunk路径已有引用、182个路径尚无可解析的已知引用，共30680354 bytes；涉及43个逻辑文件，其中8个运行资源。此为已知引用覆盖，不将未知单独上传对象一律断言为不存在。详细路径、长度、SHA256和逻辑原件Git SHA见 payload-recoverability.json。

191个3.19源码hash与当前可见旧工作区的实际字节比对，132项相同，24个其他路径已在临时tree中定位，35项仍缺足够恢复索引。该比较不是公开main差集；已上传但回执丢失的独立blob可能仍存在。vehicle-models为额外已单独保全的对象，详见 index.json。

## 环境与文件边界

一次1964419字节availability.json调用等待被中止，随后原229ab6206851、ed64ffe74aa8、46fc9fff05df、920d10a3ff27工作区均无法读取；未执行删除这些目录的操作。仅存867d449c399e的3.16工作区及其未提交改动，保持原样；无目标3.19/3.20提交、无可用于恢复的更新无引用commit。

availability.json预期42ef924a8385a0ba1861cde5477aaba3b9ac6fb7只读返回404；原3.19 commit4ff324f036b76e886dc958d7de1f17a2a8efff53和3.20 commit3b2c13b9f747f7d9205d79a7e538da2c2ab0968d也不能从当前GitHub接口取回。当前正式文件列表最新可确认的项目历史包是3.17；本轮原fullbundle和3.20incremental的保存没有成功回执。原交付对话的浏览器显示登录页，未获取附件。没有读取隐藏凭据或受保护控制面。

## 原材料恢复后继续

优先取原完整3.19候选/完整history bundle和发布合同工作区；按原始SHA逐对象复用已保全内容。原3.20已完成提交或工作区导出须保留全部增量；仅记住提交号不能还原原字节。已记录的增量bundle为1970378 bytes、SHA256 4886bc13bed0bde495d8157f627170668a8083b0a56d42e9aedc7a938e003290，依赖原3.19历史；当前未找到它的可读原件。

继续沿用现有三个分类、192KiB切块、100MiB逻辑原件上限、全校验链和选定依赖恢复。单次对象读/写必须有界，程序读取并直接传入connector，不向模型输出大base64。不再尝试1964419字节单对象的无界调用；若必须打包metadata，应在原系统显式增加受控目录规则及故障测试，不能假冒qa路径。新manifest须精确合并，保留所有旧entries/chunks。得到完整原件后再在干净checkout运行合同检查和实际输入消费者测试；先3.19上线，再3.20。

用户的每轮原仓库/Pages公开授权和项目私有归档授权已明确给出，不需要重新请求这些权限；当前缺的是可访问的原字节。
