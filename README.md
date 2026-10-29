# electron-suite

以 pnpm workspace 组织的 Electron 工程。

## 目录结构

```text
electron-suite/
├── apps/                 # 可运行的应用
├── packages/             # 共享能力与工具
├── pnpm-workspace.yaml   # apps/* 与 packages/* 工作区声明
├── package.json          # 根目录命令与开发依赖
├── AGENTS.md             # Agent 协作约定与能力索引
└── README.md             # 项目入口
```

`apps/` 目前包含 carrier、capsule、web 和 daemon。
`packages/` 包含协议、构建、发布及验证等共享能力，具体职责见 [AGENTS.md](./AGENTS.md)。

## 本地开发

使用 Node.js 24 和 pnpm，版本约束见 `package.json`。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm guard
```

后续按照明确的需求逐步完善应用与共享包。
