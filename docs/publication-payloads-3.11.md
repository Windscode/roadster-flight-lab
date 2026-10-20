# 3.11 公开资产与数值证据清单

本清单描述本次公开 Git 树和 Pages 的大文件内容范围。完整源码、测试和文档仍由 Git 保存；大文件通过可校验的无损 gzip 分块还原到原逻辑路径，网站读取的资产格式不变。每个原文件及每个分块的完整哈希保存在 [`repository-payloads/manifest.json`](../repository-payloads/manifest.json)，来源与数据范围保存在[逐文件审查记录](../qa/public-payload-review-3.11.json)。

## 运行资产与生成数据

| 原逻辑文件 | 原始字节数 | 来源与用途 |
|---|---:|---|
| `dist/assets/irradiance/city.bin` | 691,200 | Static city daylight irradiance coefficients；`scripts/bake-indirect.mjs` |
| `dist/assets/night-direct-irradiance/night-direct-city.bin` | 674,160 | Static lamp direct-irradiance coefficients；`scripts/bake-night-direct.mjs` |
| `dist/assets/night-direct-irradiance/night-direct-route-balanced.bin` | 541,200 | Static lamp direct-irradiance coefficients；`scripts/bake-night-direct.mjs` |
| `dist/assets/night-direct-irradiance/night-direct-route.bin` | 2,118,960 | Static lamp direct-irradiance coefficients；`scripts/bake-night-direct.mjs` |
| `dist/assets/night-irradiance/night-city.bin` | 674,160 | Static city reflected-irradiance coefficients；`scripts/bake-night-city.mjs` |
| `dist/assets/night-irradiance/night-route-balanced.bin` | 541,200 | Static city reflected-irradiance coefficients；`scripts/bake-night-city.mjs` |
| `dist/assets/night-irradiance/night-route.bin` | 2,118,960 | Static city reflected-irradiance coefficients；`scripts/bake-night-city.mjs` |
| `qa/fixtures/numerical-control-capture-city-3.10.json` | 3,831,081 | Generated deterministic simulation evidence；`tests/control-capture-3.10.test.mjs (retained 3.10 fixture)` |
| `qa/fixtures/numerical-control-capture-city-3.11.json` | 9,412,958 | Generated deterministic complete-city control capture evidence；`tests/control-capture-3.10.test.mjs (current 3.11 build, deterministic fixture clock)` |
| `qa/vehicle-dynamics-curves-3.11.json` | 6,468,141 | Generated deterministic simulation evidence；`tests/vehicle-dynamics-3.11.test.mjs` |

共 **10 个原文件 / 27,072,020 B**，保存为 **39 个 gzip 分段 / 6,569,181 B**。七项照明数据用于运行；三项 JSON 是生成的数值实验证据，打开其下载链接时才请求，不随城市启动加载。

## 原文件 SHA-256

- `dist/assets/irradiance/city.bin`
  - `13968aa848acc9edb8e1a891a24fe61d0ab0df80877a8d751a897bfcbb4def7a`
- `dist/assets/night-direct-irradiance/night-direct-city.bin`
  - `726109603962cd784255d841b368f7b46fe49bf35c8c4563d500cfc8a441c26f`
- `dist/assets/night-direct-irradiance/night-direct-route-balanced.bin`
  - `da8af890bfd53d3161bc16864bbe0ab3db7766c8552eb09b14d75c8f46cb136e`
- `dist/assets/night-direct-irradiance/night-direct-route.bin`
  - `93ed0f08b560300ec54b17ebce6e81bd7e99c008e50cca0009e796b70a2586d7`
- `dist/assets/night-irradiance/night-city.bin`
  - `78a84b4b7be8a140ecb42873cf783621315cd7cc61d3fad3837bca3568cb0a6a`
- `dist/assets/night-irradiance/night-route-balanced.bin`
  - `58cd03be936aa2a89d3b3383b76dc360f88b80e8f4be3ff0310531c03d56ca1d`
- `dist/assets/night-irradiance/night-route.bin`
  - `eb0e7bdf0919e7726a428032d84ee4c91dd7958ce612f06c6fb4283d2b1c7af2`
- `qa/fixtures/numerical-control-capture-city-3.10.json`
  - `73e9fc313a360c00d4264c104f499aa5fd3245977fd05e349cef09e1829df114`
- `qa/fixtures/numerical-control-capture-city-3.11.json`
  - `3dce177d3b315e826772d95ca6db5b74759189c2d0db923b9da70558c85de1d5`
- `qa/vehicle-dynamics-curves-3.11.json`
  - `26926435fb66e107d825ac8b0e762684e28c69ebb22f8cd8df27ed47d1caef28`

## 用户原图的留存边界

用户新上传的条纹 PNG（1205×667、1,257,262 B）已读取像素并完整保留在本地，未列入此公开 Git 树或 Pages；其七个压缩分块也全部排除。应用运行、测试求解器和数值历史不依赖该附件。公开材料保留[来源及 SHA-256](../qa/body-stripe-source-3.11.json)；内容哈希用于对应原证据，不能替代图片复核。README 继续使用已经公开、明确标为 3.9 的真实历史画面。

## 恢复和发布校验

`node scripts/repository-payloads.mjs restore` 校验每段、解压后字节数、SHA-256 和 Git blob 身份。普通恢复保留本地修改；Pages 准备使用严格模式，遇到修改过但尚未重新审查归档的文件时拒绝发布。目标路径中的现存或悬空符号链接同样拒绝。

`scripts/prepare-pages.mjs` 从版本控制的运行文件及此显式清单准备站点，并生成 `deployment.json`，记录实际源提交、源树及模型构建 ID。线上是否完成更新须核对该文件及对应 Pages 运行；本清单本身不表示已部署，也不表示真实 WebGL 画面已经验收。
