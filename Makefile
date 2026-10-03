.PHONY: install frontend preflight build

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 上线前检查：示例数据迁移（可续跑、幂等）+ 方案状态/站房维护待办/巡检清单同批核对
preflight:
	cd frontend && npm run prebuild:check

build:
	cd frontend && npm run build
