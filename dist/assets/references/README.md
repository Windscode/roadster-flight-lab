# Tesla 官方外形与吸附参考索引

核查日期：2026-10-18。图片均从实际打开的 [Tesla Roadster 英国产品页](https://www.tesla.com/en_GB/roadster) 的 `img/source` 地址取得，并逐张打开检查。原始尺寸、来源地址、校验值见项目中的 `qa/official-download-manifest.json`；完整观察和证据边界见 `qa/reference-review.json`。

图片 © Tesla，仅用作本非官方项目的车型研究参考，不声称获得原厂 CAD、生产标定或开放素材授权。

| 本地图片 | 主要用途 | 已直接观察到的细节 |
|---|---|---|
| [01 Hero](Roadster-01-Hero-Desktop.jpg) | 后视轮廓 | 贯穿尾灯、折面尾肩、下方设备区 |
| [02 Pilot](Roadster-02-Pilot-Desktop.jpg) | 侧视比例 | 楔形鼻端、低矮座舱、玻璃侧窗、紧贴轮胎的轮拱 |
| [03 Slide 1](Roadster-03-Carousel-Slide-1-Desktop.jpg) | 正前灯组 | 翼子板内侧的三角灯窝、宽黑色前脸、薄前唇 |
| [03 Slide 2](Roadster-03-Carousel-Slide-2-Desktop.jpg) | 后部细节 | 四个金属圆喷口、碳纤维面板、尾灯与尾盖折面 |
| [03 Slide 3](Roadster-03-Carousel-Slide-3-Desktop.jpg) | 俯视和门缝 | 向上开启的门、铜色玻璃、短鼻端与座舱边界 |
| [03 Slide 4](Roadster-03-Carousel-Slide-4-Desktop.jpg) | 内饰 | 白灰座椅、紧凑方向盘、中央屏幕、低调灯带 |
| [03 Slide 5](Roadster-03-Carousel-Slide-5-Desktop.jpg) | 悬架与轮胎 | 横置螺旋弹簧减振器、摇臂连杆、纵沟胎纹 |
| [04 World](Roadster-04-World-Desktop.jpg) | 后侧及下方硬件 | 主动尾翼支架、黑色侧裙、金属下喷嘴 |
| [05 Graph](Roadster-05-Graph-Desktop.jpg) | 吸附概念 | 风扇控制下压力曲线；没有可供标定的数值坐标 |
| [06 Gravity](Roadster-06-Gravity-Desktop.jpg) | 冷气喷流最有用的直接参考 | 窄白色喷流、撞地扩散的厚雾、正倒后视硬件 |
| [07 Augments](Roadster-07-Augments-Desktop.jpg) | 尾部风扇和喷口 | 上排四喷口，下排四个有叶片的风扇模块，黑色深罩 |
| [08 End](Roadster-08-End-Desktop.jpg) | 前侧曲面 | 平齐板件、略带曲率的白色面、真实轮拱开口 |

## 吸附结构能确认到哪里

官方说明了风扇抽走车底空气、地面密封系统和静止倒挂能力，页面图片也显示了尾部风扇和下方罩体。[官方说明](https://www.tesla.com/en_GB/roadster) 没有给出完整 2026 车底图、密封裙剖面、泄漏曲线或风扇特性图。搜索到的 Roadster 1.5 / 2.x 维修手册属于第一代，不能当成新车图纸。

仿真中的连续底护板、低压腔、周缘密封唇和内部风道需明确标注为工程重建。抽吸也不要求绝对气密：风扇持续抽气，与缝隙漏气达到平衡后维持压差；有效面积和压差共同决定吸附力。轮舱不应直接敞开连通整个低压腔。

## 喷流参考和视频核查边界

[Gravity 原图](https://digitalassets.tesla.com/tesla-contents/image/upload/f_auto,q_auto/Roadster-06-Gravity-Desktop.jpg) 直接显示狭窄白色核心、很快变粗的湍流和沿地面扩散的浓雾，没有橙色燃烧火焰。它支持喷流外观，不能提供阀门时序、流速、质量流量或推力标定。

本次打开 [Tesla 官方 Kickflip 视频](https://www.youtube.com/watch?v=r5vsHHPVhJg) 时，播放器要求登录以确认不是机器人。已核对 Tesla 官方频道和视频标题，但没有绕过验证或下载视频，也未宣称观察到不可见帧。准确脉冲频率及各动作起止时间本轮未复核。其他原始链接：[完整发布会](https://www.youtube.com/watch?v=qt5p-_tE8d0)、[The Ramp](https://www.youtube.com/watch?v=7p5LxFdc-Qg)、[设计技术简介](https://www.youtube.com/watch?v=cvKIR-c1SsU)。

## 建模与效果实施建议

- 优先轮廓、玻璃座舱、灯窝和轮拱体积，再增加细分；增加面数不能修正比例错误。
- 白色大面保留细微曲率与连续法线，板缝和边缘保持锐度，避免整车像折纸壳。
- 轮拱和内衬应覆盖压缩、下垂、转向及胎宽的运动包络；不是通过抬高车身掩盖穿模。
- 下喷流使用浓密、窄而不规则的白芯，远场迅速扩散；撞地后横向铺开，不采用发光火焰或稀疏亮点。
- 喷口独立于风扇吸附，轮舱独立于低压腔。未经公开证实的隐藏件应在工程说明里列为假设。
