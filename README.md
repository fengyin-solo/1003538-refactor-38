# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   │                          plan-domain（统一判断）、plan-migration（迁移）、
│   │                          plan-versions（版本库）、plan-preflight（上线前检查）
│   ├── scripts/              构建前检查（prebuild-check.js / gate.ts）与 Node 侧文件存储
│   ├── src/stores/           会话与「当前生效方案版本」共享读取
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

`npm run build` 会先执行构建前检查（`scripts/prebuild-check.js`）：先把示例数据迁移跑完，
再用同一批数据核对方案状态、站房维护待办与巡检清单；出现阻断问题（error）构建直接中止，
提醒（warning）只打印不阻断。本地 `npm run dev` 启动时也会跑同一套检查
（`vite-plugin-plan-gate.ts`），但不影响起服，只在终端提示。也可以单独执行：

```bash
make preflight        # 或 cd frontend && npm run prebuild:check
```

## 测报方案版本与归档

测报方案的判断（是否已批准、版本是否有效、归档入口是否开放）全部集中在
`src/data/plan-domain.ts`，方案页面、版本检查、归档入口、上线前检查共用同一套谓词，
不再各自硬编码字符串判断。

- **版本号回填**：历史方案缺少版本号时按「批准时间」回填，规则为 `V + 年月日`
  （同日多版本追加序号）。批准时间缺失的方案会在迁移中阻断并保留游标，补齐批准时间后
  从该方案继续。
- **历史原文不可覆盖**：迁移与批准只向独立版本库（localStorage
  `hydrology-monitor-station:plan-versions`）追加记录，版本里保存批准当时的原文快照；
  方案原表除「批准时间」缺失时补写该列外不做任何改动，归档只标记版本，不改原文。
- **迁移可中断、可重跑**：游标存在 `hydrology-monitor-station:plan-migration`
  （Node 侧闸门状态在 `frontend/.plan-gate-state.json`）。中断后从未处理方案继续；
  已存在版本的方案直接跳过，重复执行不会产生第二个有效版本，每方案至多一个有效版本。
- **上线前检查同批数据**：方案状态、站房维护待办、巡检清单三段核对取自同一个数据快照，
  报告带同一批次号；方案页面上的「上线前检查」按钮输出同样结构的报告。
- **巡检清单同源**：全局横幅与巡检记录页的巡检清单都取自当前生效方案的同一个版本
  （`src/stores/active-plan.ts`），其余页面不各自维护清单。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries` 这一项，或调用 `resetModule(模块)`。
  测报方案还需清掉 `hydrology-monitor-station:plan-versions` 与
  `hydrology-monitor-station:plan-migration`（版本库与迁移游标），构建闸门的本地状态是
  `frontend/.plan-gate-state.json`。
