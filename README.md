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
│   ├── src/stores/           会话与筛选状态
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
npm run build        # 仅类型检查 + 打包
npm run build:checked # 推荐：先跑构建前检查，通过后再打包
```

## 测报方案版本治理

测报方案（`plan`）在普通条目之外多一套**版本库**，页面渲染、版本检查、归档三处的判断
统一收敛到 `src/data/plan/`，不在组件里各写一遍：

```text
src/data/plan/
├── types.ts       状态/动作常量、版本与检查报告类型（唯一事实来源）
├── policy.ts      纯函数：状态归类、批准时间回填、版本号、迁移引擎、上线前检查
├── store.ts       版本库门面（localStorage 适配器）+ 方案统一动作入口
├── node-adapter.ts Node 侧文件/临时适配器
└── pipeline.ts    迁移自检（断点续跑/幂等）+ 同一快照上线前检查
```

约定与流程：

- **统一写法**：方案页的按钮可用性、「上线前检查」、「归档废止方案」都走
  `executePlanAction` / `archiveRepealedPlans` 与 `runPreflightChecks`；状态阶段、
  动作目标、版本规则只在 `policy.ts` 定义。
- **旧方案回填**：迁移时缺少版本号的旧方案按**批准时间**生成版本号
  （`V-YYYYMMDD`）；原文没有「批准时间」列时按回填基准日 `1970-01-01` 生成并在
  页面标记「批准时间回填」。版本记录保存批准当时的原文快照，**只追加、不回写、
  不覆盖历史方案原文**。
- **三个迁移入口共用同一条管线**（`pipeline.ts`）：
  - 本地开发：`npm run dev` 启动时 Vite 插件（`vite-plan-plugin.ts`）自动迁移 + 检查；
    浏览器端 `main.ts` 启动也会对 localStorage 里的数据幂等迁移；
  - 构建前：`npm run prebuild`（或 `make prebuild`），`build:checked` 会先跑它；
  - 示例数据：`npm run plan:migrate`（或 `make migrate`，状态文件
    `frontend/.plan-state/plan-versions.json`，已 gitignore）。
- **断点续跑 / 幂等**：迁移以已处理方案 id 为游标，中断后再次执行从未处理方案继续，
  `--limit=N` 可单批处理；重复执行新增版本数为 0，同一方案不会产生第二个有效版本。
  每次管线都会在临时版本库上自检这两条保证。
- **上线前检查同一批数据**：方案状态 ↔ 版本库、站房维护待办（`stationhouse` 的
  pending 记录）、巡检清单（`inspection`）三项核对跑在**同一个 `PlanSnapshot`** 上：
  有效方案必须恰好一个有效版本且原文指纹一致、废止方案必须已归档且无有效版本、
  站房待办站点必须被某个有效方案覆盖、巡检记录必须能追溯到同一方案版本及其检查项目。
- **其他页面读同一版本**：巡检记录、站房维护、运营概览页挂同一个
  `components/PlanChecklistPanel.vue`，清单条目（监测项目 × 测次安排）全部由当前
  生效方案版本派生；巡检表每行还会显示该站点解析到的同一方案版本号。


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
