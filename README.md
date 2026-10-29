# electron-suite

可独立分发的 Electron 工程能力，npm scope 统一为 `@pesuite`。
长期目标见 [#1](https://github.com/PerishCode/electron-suite/issues/1)，guard 实施与验收见 [#3](https://github.com/PerishCode/electron-suite/issues/3)。

## 命令与交付

唯一可执行入口为 `pesuite`，检查命令为 `pesuite guard`。`@pesuite/cli` 负责路由，`@pesuite/guard` 提供检测库；不发布独立 `guard` 命令。
源码实现已合入主线；正式 registry 发布及 open-design-slim 的 registry 接入以 #3 中的验收记录为准。

```sh
pesuite guard
pesuite guard --root /path/to/repo --json
pesuite --help
pesuite --version
```

显式 `--root` 优先；否则使用当前 Git worktree 根，非 Git 目录使用 cwd。完整扫描真实目录树，不读取 Git index，不提供 `--staged`。默认排除 `.git`、`node_modules`、`dist`、`coverage`、`.artifacts` 和 `.state`；不隐式采用 `.gitignore`。
配置只读取确定根目录下的 `pesuite.yaml`，不存在时使用默认值；不读取 `guard.yaml`。退出码：0 通过、1 规范违规、2 参数／配置／扫描执行错误。

## 默认规范

| 规则                       | 默认行为                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| module                     | 按 pnpm workspace packages 识别；没有 workspace 声明时使用 apps/_、packages/_；单包仓库根本身也是 module            |
| directory.name / file.name | module 目录与文件采用单个小写字母数字词，文件可使用 config、test、tests、d 角色后缀；标准文档和工具文件名有显式例外 |
| directory.depth            | module 根为 0，src/tests 为 1；目录深度不超过 5                                                                     |
| directory.children         | module 内每目录直接文件及子目录不超过 8；包括空目录与 tests 子树                                                    |
| components                 | 默认只有精确路径 packages/components 豁免该目录的宽度，其他规则继续检查                                             |
| file.lines                 | 源码与测试最多 500 物理行，含空行／注释；末尾换行不额外增加一行                                                     |
| file.test / module.layout  | src 与 tests 同级；测试在 tests/**/*.test.ts；根目录工具配置有明确例外，CLI 入口也位于 src                          |
| module.typescript          | 独立 tsconfig.json 与 tsconfig.tests.json；测试显式 @ -> ./src 并扩展源码配置；精确 TypeScript 7 依赖               |
| module.vitest              | Vitest 精确依赖、vitest run 脚本，以及可静态识别的 tests/**/*.test.ts 发现配置                                      |
| repository.biome           | 根声明 Biome 依赖并提供 biome.json 或 biome.jsonc                                                                   |
| dependency.version         | 依赖四个字段中，外部严格 x.y.z，本仓库包严格 workspace:*；不允许范围、tag、预发行或其他协议                         |
| file.style                 | 样式表仅允许 packages/components/**/*.less；禁止其他源码中的样式定义                                                |
| file.coverage              | TS/JS 解析失败及未支持的 Vue/Svelte 源码不得报告通过                                                                |

格式、通用 lint 和 import 整理由 Biome 执行，测试由 Vitest 执行，类型检查由 TypeScript 7 执行；guard 检查工程契约，不代替这些工具运行。

## 配置

```yaml
schemaVersion: 1
guard:
  components:
    - packages/components
  rules:
    file.lines:
      max: 500
  overrides:
    - paths: [scripts/**]
      rules:
        file.lines:
          max: 200
  exceptions:
    - paths: [packages/example/src/legacy.ts]
      rules: [file.lines]
      reason: 有界迁移期间保留，完成拆分后删除
```

guard 支持 `exclude`、`modules`、`components`、`names`、`rules`、`overrides` 和 `exceptions`。`modules` 一旦显式声明即覆盖 workspace 发现模式；`components` 仅接受精确 repo 相对路径；`names` 为文件 basename 例外。

未声明字段继承默认值，数组整体替换，显式 `[]` 清空列表；局部 overrides 按声明顺序覆盖已提供的规则字段。每条规则可设置 `enabled`，数值规则另支持非负整数 `max`。exceptions 仅豁免匹配路径的指定规则，必须提供非空理由；exclude 才改变扫描集合。

路径采用正斜杠，`*` 不跨目录段，`**` 跨段，不支持取反或花括号等其他方言。未知字段／规则、重复 YAML key、错误类型、非法 glob 及不支持的 schemaVersion 都是执行错误。配置为空文档时使用默认值；不提供代码配置、远程继承或 YAML alias。

## 样式检查的证据边界

源码类别包括 TS/TSX/MTS/CTS、JS/JSX/MJS/CJS、HTML、Less/CSS/SCSS/Sass/Styl，以及被明确拒绝的 Vue/Svelte。
TS/JS 使用 Babel 语法树，HTML 使用 parse5。检查 JSX style 属性／style 元素、CSS-in-JS 模板及相关导入、style/CSSOM 操作、样式表导入、HTML style 属性／元素／链接，以及 HTML 内脚本和事件代码。普通注释和未被注入的字符串样本不是样式定义。

为了避免动态值绕过隔离，JSX props spread、动态 DOM 标签／属性名及无法静态检查的 HTML 注入会被拒绝。符号链接只检查自身路径，不遍历目标；源码链接因无法证明覆盖而拒绝。JSON 报告列出链接、排除模式和显式例外。不把链接目标或排除内容计入通过声明。

这是语法约束，不做跨函数／跨包数据流、别名与运行时行为证明。任意动态代码、间接调用或第三方包内部行为不能凭一次静态检查保证；新的源码形态应先添加明确规则和反例再纳入支持，不能把已知覆盖空缺描述成“所有运行行为均已证明”。

## 本地开发

使用 Node.js 24、pnpm。首次安装构建 workspace；CLI 的受版本管理 bin 适配器保证冷安装可建立命令链接，发布包包含构建输出。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm guard
```

`apps/` 为运行载体与能力验证应用，`packages/` 为共享能力；包职责见 [AGENTS.md](./AGENTS.md)。
