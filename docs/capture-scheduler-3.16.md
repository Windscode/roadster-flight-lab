# 3.16 原生矩阵 PNG 请求调度修复

构建 `28e9bc415a0509990cb88dcbb0a95117f013969e2283260208df5921c54b1d8f` 已完成原始 **1280×720、14 个场景、20,000 ms 请求期限**的实际原生后验：14 个 PNG、28 个普通/导出逐 draw 审计全部通过，物理状态保持，14 张原图均逐张打开评审。前后实际 fetch 核验 172 个源码、三场 manifest 和八个体积全部一致。这里的通过有明确的原始文件，不由函数测试推定。[完整原图与逐帧评审](../qa/capture-matrix-native-3.16/index.html)、[来源、阶段与逐 draw 汇总](../qa/capture-matrix-native-3.16/report.json)、[应用完整原报告](../qa/capture-matrix-native-3.16/gpu-switch-matrix.json)

## 实际失败与定位范围

冻结构建 `81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2` 的两次原生 Chrome 155 / WebGL2 / ANGLE SwiftShader 矩阵都由应用本身的 `requestProgramFrame` 20 秒定时器终止。第一次 1280×720 为 0/14 个完整帧；第二次 800×450 完成 high 白天与湿夜的桥下/车辆共 4/14 个完整帧、8 次普通/导出绘制审计，随后在 ultra 湿夜桥下失败。已有 PNG、完整逐 draw、失败 ZIP 和 partialAudit 均保留，不能以第二次的四帧替代十四帧闭环。[两次原始数据及源码定位](../qa/diagnostic-png-deadline-3.16-before.json)

| 尝试 | 最后保留的普通帧 | 普通审计时长 | 普通结束至矩阵失败 | 已完成 PNG |
| --- | --- | --- | --- | --- |
| 1280×720 | high 晴天桥下，1,209 draw，通过 | 1.138 s | 24.134 s | 0 / 14 |
| 800×450 | ultra 湿夜桥下，1,458 draw，通过 | 1.403 s | 27.459 s | 4 / 14 |

这些间隔不是单独的 PNG 编码耗时。原源码在请求排队时启动期限，它覆盖等待下一帧、场景更新、反射、composer 绘制、诊断结束、条件深拷贝、`toBlob` 调用和异步回调。JavaScript 定时器也不能抢占正在执行的同步工作。ZIP 整理与浏览器下载在矩阵收集结束之后，未被这个单帧期限覆盖，因此不能把这两次错误归为自动化工具下载挂起，也不能直接归因于 PNG 压缩算法。

原 `main.js` 的 `pendingProgramCapture.inFlight` 只禁止再次对同一个任务开始诊断。暂停主循环仍会继续做场景更新、反射提交和 `composer.render()`。原函数抽取测试在三个受控动画回调内实际观察到三次渲染提交，而 PNG 回调尚未返回。这项重复提交行为已经定位；原失败报告只保存前一个 ordinary 报告，缺少失败 export 自身的阶段，所以还不能断定重复提交是两次原生失败的唯一原因。

## 最小修改

暂停状态下，若现有 PNG 任务已完成绘制并进入 `inFlight`，主循环仍排下一个 `requestAnimationFrame`、更新 `lastTime` 并保留 DOM 取消，但暂缓再次进行场景更新、反射和 composer 绘制。任务回调、失败或取消清除原 job 后，正常帧继续。运行中的驾驶导出不满足 `paused` 条件，仍按原循环推进物理和画面。原 20,000 ms 定时器、14 个案例、画质、材质/FBO/逐 draw 判定都保持。

现有 job 增加七个小型时间点：`queued`、`draw-start`、`draw-end`、`conditions-frozen`、`toBlob-call`、`toBlob-return` 和 `callback`。`draw-start` 在本帧场景更新之后、实际反射/主绘制之前；`toBlob-call` 至 `toBlob-return` 只表示浏览器 API 同步调用跨度，不能擅自命名为压缩用时。失败保存当前 `captureProgress`、已存在的当前请求 `captureAudit`，同时将前一 ordinary 的 `partialAuditSource` 标明为 `ordinary-paused-frame`。绘制异常时已有的 aborted audit 也保留。

PNG 条件中的物理状态、相机、帧号、renderTimeS 和 capturedAt 仍在原实际绘制帧冻结。后续回调只添加独立的 `captureProgress` 生命周期字段，不重新读取物理、不更换图像帧、不把回调时刻当作拍摄时刻。失败快照随后不会被迟到的回调改写。

## 独立函数验证

[正式测试](../tests/capture-scheduler-3.16.test.mjs)保留[冻结 81926 的完整原函数与来源 SHA](../tests/fixtures/capture-scheduler-before-3.16.json)，用实际抽出的 request/frame/cancel 函数和原/新矩阵收集器验证 10 条声明检查：原反例、修后暂停等待、取消后恢复、原/新 active-driving 推进、首帧前超时、绘制后超时及迟回调、成功生命周期、无 PNG 普通诊断、异常 draw 审计保留和两类失败审计分离。[结果](../qa/capture-scheduler-3.16.json)

这里的渲染与物理组件是作用计数边界，回调和时钟受控；它验证应用调度与数据冻结，不模拟 GPU、PNG 编码或车辆求解器。实际原生结果另由下面的完整采集记录给出，函数测试没有替代 GPU 或像素验收。

## 原 1280×720 矩阵的实际后验

Chrome 155 / ANGLE SwiftShader 独占浏览器窗口，七组既有画质/天气切换各采桥下与车辆两张。每个案例仍使用原普通 draw 加导出 draw 的判定：实际程序链接与绑定、采样器、FBO 完整性、具名主色类别、每条 draw 的 GL 错误及事件保留情况。28 份实际审计全部通过，最高活动采样器数为 14。八个 high/ultra 湿夜导出包含真正的湿路 FBO 写入，分别有 228、437、274、460 个 draw，并在重复切档时再次出现；这些实际刷新没有 GL 错误。balanced 档没有该反射 FBO 刷新，未被冒算为刷新覆盖。[所有原始审计](../qa/capture-matrix-native-3.16/gpu-switch-matrix.json)

| 现有请求阶段 | 实测最小 | 中位数 | 实测最大 |
| --- | ---: | ---: | ---: |
| 排队至实际 draw 开始 | 1.561 s | 4.659 s | 6.036 s |
| 实际 draw 开始至结束 | 0.257 s | 1.218 s | 1.723 s |
| draw 结束至条件冻结 | 6.7 ms | 15.45 ms | 21.9 ms |
| `toBlob` 调用至同步返回 | 1.500 s | 4.453 s | 5.837 s |
| 同步返回至回调 | 31.9 ms | 84.95 ms | 114.4 ms |
| 请求排队至回调 | **3.433 s** | **10.546 s** | **13.232 s** |

14 次请求的实测完整生命周期都低于原 20 秒期限。`toBlob` 同步跨度包含浏览器内部等待，其 GPU 同步、回读或编码内部工作没有拆测；后续回调间隔也包括调度，不能称为纯 PNG 压缩用时。`capturedAt`、物理状态和原帧号仍早于回调并保持绘制时冻结值。[逐帧全部阶段原值](../qa/capture-matrix-native-3.16/report.json)

这次在原门槛下越过了两个旧失败位置并完成 14 帧，支持对已定位重复渲染调度的修复，关闭了本次环境下的矩阵导出失败。旧报告缺少的失败导出阶段没有被倒填，也不据此保证任意 GPU、负载或浏览器的延迟。整轮 CPU 回归在采集前半段并发、随后结束，这一已知环境事实单独保留；没有根据它放宽门槛。[环境记录](../qa/capture-matrix-native-3.16/environment-concurrency.json)

原图评审仍保留宽暗立面、重复远楼、夹白灯面/前照灯池以及路面平板识别弱的问题。干净 draw 和成功 PNG 不构成整城 3A、原生驾驶路线或硬件 FPS 通过。实际 404 被定位为本地候选的 `deployment.json`；完整 served-source/光场身份仍通过，未伪造远端部署或提交身份。原 81926 的 12 张固定城市照片继续保留原构建；实际两次 source audit 对比只有 `main.js` 和 `render-capture-matrix.js` 改动，其余 170 个声明源和三场八体积同字节。
