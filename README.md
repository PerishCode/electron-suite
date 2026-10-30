# electron-suite

可独立分发的 Electron 工程能力，npm scope 统一为 `@perishcode`。
长期目标见 [#1](https://github.com/PerishCode/electron-suite/issues/1)，guard 实施与验收见 [#3](https://github.com/PerishCode/electron-suite/issues/3)。

## 命令与交付

唯一可执行入口为 `pesuite`，工程检查使用 `pesuite guard`，内容准备和安装产物构建使用 `pesuite release` / `pesuite pack`。`@perishcode/cli` 负责路由，`@perishcode/guard` 提供检测库；不发布独立 `guard` 命令。
源码实现已合入主线；发布与 open-design-slim 的消费验收见 #3。

分发 registry 为 GitHub Packages：`https://npm.pkg.github.com`。仓库 `.npmrc` 仅声明 `@perishcode` 的 registry 路由，token 保留在用户级 `~/.npmrc`，不得提交。其他第三方依赖继续使用 npmjs。消费机器需要有 GitHub Packages 读取权限的登录态。

```sh
pesuite guard
pesuite guard --root /path/to/repo --json
pesuite --help
pesuite --version
```

显式 `--root` 优先；否则使用当前 Git worktree 根，非 Git 目录使用 cwd。完整扫描真实目录树，不读取 Git index，不提供 `--staged`。默认排除 `.git`、`node_modules`、`dist`、`coverage`、`.artifacts` 和 `.state`；不隐式采用 `.gitignore`。
配置只读取确定根目录下的 `pesuite.yaml`，不存在时使用默认值；不读取 `guard.yaml`。退出码：0 通过、1 规范违规、2 参数／配置／扫描执行错误。

## 默认规范

| 规则                                | 默认行为                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| module                              | 按 pnpm workspace packages 识别；没有 workspace 声明时使用 apps/_、packages/_；单包仓库根本身也是 module            |
| directory.allowed                   | 仓库与模块相对路径白名单逐节点匹配；默认拒绝未知、隐藏和空目录，不隐式授权后代                                      |
| directory.name / file.name          | module 目录与文件采用单个小写字母数字词，文件可使用 config、test、tests、d 角色后缀；标准文档和工具文件名有显式例外 |
| directory.depth                     | module 根为 0，src/tests 为 1；目录深度不超过 5                                                                     |
| directory.children                  | module 内每目录直接文件及子目录不超过 8；包括空目录与 tests 子树                                                    |
| components                          | 默认只有精确路径 packages/components 豁免该目录的宽度，其他规则继续检查                                             |
| file.lines                          | 源码与测试最多 500 物理行，含空行／注释；末尾换行不额外增加一行                                                     |
| file.test / module.layout           | src 与 tests 同级；测试在 tests/**/*.test.ts；根目录工具配置有明确例外，CLI 入口也位于 src                          |
| module.typescript                   | 独立 tsconfig.json 与 tsconfig.tests.json；测试显式 @ -> ./src 并扩展源码配置；精确 TypeScript 7 依赖               |
| module.vitest                       | Vitest 精确依赖、vitest run 脚本，以及可静态识别的 tests/**/*.test.ts 发现配置                                      |
| repository.biome                    | 根声明 Biome 依赖并提供 biome.json 或 biome.jsonc                                                                   |
| dependency.version                  | 依赖四个字段中，外部严格 x.y.z，本仓库包严格 workspace:*；不允许范围、tag、预发行或其他协议                         |
| file.style                          | 样式表仅允许 packages/components/**/*.less；禁止其他源码中的样式定义                                                |
| package.scripts / directory.scripts | 只允许 lint/test/build；根同名递归分派，模块直接运行工具；禁止 scripts 目录                                         |
| file.coverage                       | TS/JS 解析失败及未支持的 Vue/Svelte 源码不得报告通过                                                                |

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
    - paths: [packages/example/tests/**]
      rules:
        file.lines:
          max: 200
  exceptions:
    - paths: [packages/example/src/legacy.ts]
      rules: [file.lines]
      reason: 有界迁移期间保留，完成拆分后删除
```

guard 支持 `directories`、`exclude`、`modules`、`components`、`names`、`rules`、`overrides` 和 `exceptions`。`modules` 一旦显式声明即覆盖 workspace 发现模式；`components` 仅接受精确 repo 相对路径；`names` 为文件 basename 例外。

未声明字段继承默认值，数组整体替换，显式 `[]` 清空列表；局部 overrides 按声明顺序覆盖已提供的规则字段。每条规则可设置 `enabled`，数值规则另支持非负整数 `max`。exceptions 仅豁免匹配路径的指定规则，必须提供非空理由；exclude 才改变扫描集合。

路径采用正斜杠，`*` 不跨目录段，`**` 跨段，不支持取反或花括号等其他方言。未知字段／规则、重复 YAML key、错误类型、非法 glob 及不支持的 schemaVersion 都是执行错误。配置为空文档时使用默认值；不提供代码配置、远程继承或 YAML alias。

## 样式检查的证据边界

源码类别包括 TS/TSX/MTS/CTS、JS/JSX/MJS/CJS、HTML、Less/CSS/SCSS/Sass/Styl，以及被明确拒绝的 Vue/Svelte。
TS/JS 使用 Babel 语法树，HTML 使用 parse5。检查 JSX style 属性／style 元素、CSS-in-JS 模板及相关导入、style/CSSOM 操作、样式表导入、HTML style 属性／元素／链接，以及 HTML 内脚本和事件代码。普通注释和未被注入的字符串样本不是样式定义。

为了避免动态值绕过隔离，JSX props spread、动态 DOM 标签／属性名及无法静态检查的 HTML 注入会被拒绝。符号链接只检查自身路径，不遍历目标；源码链接因无法证明覆盖而拒绝。JSON 报告列出链接、排除模式和显式例外。不把链接目标或排除内容计入通过声明。

这是语法约束，不做跨函数／跨包数据流、别名与运行时行为证明。任意动态代码、间接调用或第三方包内部行为不能凭一次静态检查保证；新的源码形态应先添加明确规则和反例再纳入支持，不能把已知覆盖空缺描述成“所有运行行为均已证明”。

## 本地开发

使用 Node.js 24、pnpm。安装后显式运行 pnpm build 构建 workspace；CLI 的受版本管理 bin 适配器保证冷安装可建立命令链接，发布包包含构建输出。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm exec pesuite guard
```

`apps/` 为运行载体与能力验证应用，`packages/` 为共享能力；包职责见 [AGENTS.md](./AGENTS.md)。

## 四运行单元 SDK

`@perishcode/runtime` 提供 Capsule 代际编排、内容目录读写、运行会话及最小 Daemon 服务；
`@perishcode/electron` 提供安装宿主适配、沙箱 preload 和窄 IPC 接口。
浏览器仅通过 `@perishcode/electron/bridge` 导入纯类型契约，不加载 Node 协议实现。
`@perishcode/pack` 构建 unsigned macOS `.app`，可嵌入初始 seed。
协议、CAS、发布、资源和身份等依赖包随 SDK 发布，产品不依赖 suite 的参考 apps 或 testkit。

产品在 `pesuite.yaml` 的 `runtime:` 中声明 appid、carrier（最低宿主 ABI）、channel、name、namespace、scheme 和 version。
Electron 在固定 userData 根持有单实例锁，调用 `startElectron`；SDK 读取初始 seed 或显式本地 candidate，校验与物化内容，
执行 Capsule 的 `activate(context)`，使用安装 Electron 的 Node 模式运行 Daemon，再等待实际 Web/Daemon 就绪后提交代际。
renderer 只有 health/read/write 接口，不取得服务 token、任意 URL 或管理器权限。

Daemon 使用父进程管道作为存活信号；正常停止先收敛进程，再退休凭据和释放临时资源。
启动失败保留阻塞状态，需要显式 recover 最近 committed generation；不隐式声称自动回退。
持久资源按 namespace 隔离，产品应为不同渠道选择不同 userData 根；不要将此理解为自动跨渠道隔离。

此 SDK 首版服务于四单元骨架，不迁移 OpenDesign 功能。本地 candidate 是调用者明确选择的可信目录，
不构成公网更新授权；完整远端信任、签名安装器、跨平台进程树与提交中断恢复仍需独立验收。
参考 qualify 不再凭调用方布尔值或手动就绪将完整更新判为 passed。
进展和验收见 [#7](https://github.com/PerishCode/electron-suite/issues/7)、[#8](https://github.com/PerishCode/electron-suite/issues/8)
及 [slim #2](https://github.com/PerishCode/open-design-slim/issues/2)。

## 通用 hosted sidecar 增量

`@perishcode/sidecar` 0.2.0 提供 `Service.expose` 和 `Client.connect<Methods>`。
调用方定义消息、输入/输出校验与 handlers；Peer 提供 call/probe/stop，不内置 OpenDesign 协议。
身份包含 namespace/channel/generation/service，句柄还绑定 incarnation；旧句柄不能操作后继实例。

hosted 服务在 initialize 中接收只读身份及 data/logs/resource/runtime 根目录，
通过 context.allocate 申请 port/socket/lock，通过 context.forward 连接自己持有的端口与 socket。
端口由 sidecar 持有，调用方服务监听受管 socket；服务必须在 stop 中排空自己持有的句柄。
初始化完成后才可连接；停止阻止新调用，等待已接收调用与分配操作完成，再执行 body stop、释放临时资源并退休实例。
停止失败保留权威和临时资源，明确重试成功前不能报告 stopped；持久数据保留。

这是 #10 的第一批增量：控制面仍属于单个管理器进程。
跨进程客户端通信已测试；跨进程管理权威、管理器重启接管和跨代生命周期串行化仍需后续交付。
完整推进见 [#1](https://github.com/PerishCode/electron-suite/issues/1)，消费者验证见 [slim #4](https://github.com/PerishCode/open-design-slim/issues/4)。

## 生命周期入口与 scripts 边界

根 scripts 只保留 lint/test/build，命令固定为 pnpm -r --if-present run 对应脚本；pnpm 不支持 --if-exists。
模块脚本直接运行 Biome、Vitest、esbuild 与 TypeScript；build 同时检查 source/tests 类型。
不保留 postinstall/prepare/pretest/prepack、guard/format/typecheck/package/qualify 等别名，也不允许 scripts 目录。
新增 package.scripts 与 directory.scripts 规则负责持续检测；工具命令边界按实际需求显式扩展。

内容准备使用 pesuite release，unsigned macOS 构建使用 pesuite pack；二者读取明确输入，不隐式构建。
参考 qualification 直接调用 @perishcode/testkit API。完整命令、参数和结果位置见根 AGENTS.md 的迭代流程。


## 目录白名单与有序扩张

目录规则采用严格白名单。guard.directories.repository 匹配仓库相对路径，guard.directories.module 匹配独立 module 相对路径；两者取并集，每个节点都要匹配。默认 repository 开放 apps、packages、apps/_、packages/_、node_modules、.artifacts、.state；module 开放 src、tests、dist、coverage、node_modules。单包根也是 module，workspace 聚合根不按 module 放行 src/tests。

父目录不隐式授权后代；src/config、tests/flows 等需按职责声明。pattern 可使用单层 *，不允许递归 **；有限层级 pattern 不免除原深度、宽度、文件与样式规则。components 仅豁免既有宽度限制。

例如经授权引入共享测试分类时，可在 guard.directories.module 中声明完整数组 [src, tests, dist, coverage, node_modules, tests/flows, tests/flows/*]。这仅允许 flows 及下一层；更深层仍需明确决策。每个 scope 数组整体替换，未声明 scope 继承默认值，[] 清空；仓库专属扩张优先使用 repository 中的精确路径，实际例子见本仓 pesuite.yaml。

新增职责或 pattern 必须经授权，并同步规则回归与必要索引；已有授权 pattern 范围内可正常迭代。AGENTS 说明这一演进流程，不将结构永久冻结。specs/skills/assets 等目录没有隐式特权。

exclude 不能隐藏未知目录或已授权源码目录。仅仓库根 node_modules/.artifacts/.state 和实际 module 根 node_modules/dist/coverage 可作为不展开的生成/依赖/运行数据边界；这些内容不计入源码合规证明。JSON 的 pruned 字段列出边界，directories 字段记录生效的白名单。目录规则拒绝符号链接（包括排除边界上的链接），不遍历链接目标。Git 元数据仅在仓库根特殊处理。


## Sidecar 0.3：独占权威与中断阻塞

同一数据根只能存在一个 manager，同一 namespace 只能存在一个 Resources owner；受管 API 在触碰旧资源前取得权威。内部使用 Node24 内置 SQLite 的独占锁与已提交 owner 状态，没有新增 npm/native 依赖，也不通过 PID/mtime 或删除陈旧 socket 抢占。root alias 归一化，namespace 路径拒绝符号链接。SQLite 的同步调用仅用于小型权威记录；竞争立即失败，不在事件循环中等待抢锁。

正常 close 在排空后退休权威，随后可重开。关闭中的 Resources 拒绝新操作，关闭后旧对象不能修改或关闭后继。namespace/channel/service 槽位跨 generation 排他；停止失败继续占有槽位，成功退休后才可替换，旧代连接与 incarnation 被 fence。

异常退出、未发布/损坏 authority、丢失 committed registry、没有 ownership 见证的旧 attempt 资源，均明确报 recovery required。原状态与资源保留，不把不确定性当作 absent；禁止删除 authority/registry 来绕过错误。当前尚不提供自动接管或清理中断权威的公共命令。首次升级前应由旧 owner 正常 drain/close；遗留临时资源没有见证时保持阻塞。

这一步只证明受管入口的独占权威、中断阻塞与 hosted 跨代隔离，未完成完整服务实例持久目录、lifecycle session、存活子进程接管或四单元统一控制面。slim 的独立探针消费此增量，四单元 runtime 仍固定在首版发布 SDK；#10 保持 Open。约束尺度依靠 API、参考骨架、AGENTS 与验收，不建设 OS 沙箱。

Direct Resources 使用者必须先排空自己持有的 body，再正常 close；Hosted/Service 路径负责按顺序调用生命周期。需要恢复的状态是下一步协议的输入，不是建议下游另写资源清理器。


## Sidecar 0.4：namespace 持久实例目录

Service 管理的 hosted 与独立进程在外部动作前提交实例 claim，记录 namespace/channel/service/generation/incarnation、kind、生命周期阶段和实际 PID；就绪发布后才能连接，排空成功后才精确退休。最后一个进程租约在停止失败时保留，支持原租约重试；同服务槽位跨 kind/generation 排他。原始独立 Sidecar 内存 API 保留兼容，持久目录属于 Service 管理路径；注入已有运行状态的 host 会被拒绝。

Service.directory() 提供根视图，Client.directory(namespace) 提供经管理权威校验的 namespace 视图。readDirectory(root, namespace?) 可在正常关闭或异常中断后只读检查。活跃管理器持锁时应使用在线 API；离线 API 不抢锁、不写文件、不执行清扫或恢复。返回副本不包含 token、capability、命令参数、环境变量或私有 transport 信息。

每个 namespace 索引保留最后资源 owner 及阶段，跨正常 manager 替换保留。NamespaceEntry.phase 的 unopened/opening/ready/failed/closed 描述资源权威状态；服务实例有自己的 initializing/ready/stopping/failed/retired 生命周期。进程尚未申请 namespace 资源时索引为 unopened。每个服务槽位仅保存当前或最近退休的实例，不作为无限追加事件日志；修订号跨管理器单调增加。

SIGKILL 后，离线视图将 manager 标为 interrupted，同时保留实例最后提交的阶段与 PID。ready 记录不推导为当前 OS 存活；托管 body 和仍可能存活的独立子进程会分别保留 kind。中断后重新 serve 仍报 recovery required，不能用快照或删除记录作为接管凭据。

目录和 authority 的功能标记在同一 SQLite 事务中提交；已建立目录后缺失/损坏记录不会被当作空目录。正常关闭的旧 0.3 owner 可开始建立目录，但不会补造历史实例；旧版中断权威仍保留阻塞。完整生命周期会话、实例与资源使用关系、存活子进程接管及四单元统一控制面继续由 #10 推进。
