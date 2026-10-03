.PHONY: install frontend build prebuild migrate

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

# 构建前检查：示例数据迁移 + 方案状态/站房待办/巡检清单同一快照核对
prebuild:
	cd frontend && npm run prebuild

# 示例数据迁移流程：可加 ARGS="--limit=2" 演示断点续跑
migrate:
	cd frontend && npm run plan:migrate $(ARGS)

# 先检查再构建
build:
	cd frontend && npm run build:checked
