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
runtime/electron 0.2 的持久资源由 `<channel, namespace>` factory 隔离，同 factory 的版本更替保持数据连续。产品仍声明 userData 根；该根的 manager 中断会阻塞其管理的 factory，不能以换 channel 绕过。

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
后续 0.3–0.5 增量补齐排他的持久管理权威、实例目录和跨代生命周期串行化；异常管理器接管仍未交付。
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

目录和 authority 的功能标记在同一 SQLite 事务中提交；已建立目录后缺失/损坏记录不会被当作空目录。正常关闭的旧 0.3 owner 可开始建立目录，但不会补造历史实例；旧版中断权威仍保留阻塞。实例与资源使用关系、存活子进程接管及四单元统一控制面继续由 #10 推进。

## Sidecar 0.5：生命周期会话

同一个 manager root 内，以 namespace/channel 为串行化作用域。单次生命周期写操作自动取得会话；批量编排显式使用以下 API（scope 使用 protocol 的 namespace/channel 类型）：

```ts
await service.session(scope, async () => {
  await service.expose(options);
});
await client.session(scope, async (scoped) => {
  const lease = await scoped.start(spec);
  await scoped.release(lease);
});
```

同作用域本地和 loopback 嵌套沿私有控制上下文重入，避免 initialize/stop 等回调等待自己；顶层并发命令依序执行。不同 channel 可以独立推进。跨作用域嵌套和会话内 manager.close 会快速拒绝；不提供多作用域事务。回调结束后 scoped Client 和遗留异步上下文失效。

控制端持有独立 owner socket；Client timeout 只限制会话取得，不构成持有期租约。正常结束等待已接收操作排空，再提交 completed/failed；回调失败不回滚已发生的外部效果。异常连接丢失则排空已接收操作并提交 interrupted，拒绝该 lane 的后续写入。断连不等于进程死亡，不能自动清锁或超时接管。其他 lane 可继续；manager.close 遇中断 lane 返回 recovery required 并保留管理权威。正常关闭先停止新入口，再等待会话和受管服务排空。

Service.directory / Client.directory / readDirectory 的 sessions 记录只保留每个作用域当前或最近会话的阶段与 manager/incarnation，不公开 token 或回调异常正文。功能标记和记录原子提交；兼容正常关闭的旧版目录，但已建立的会话索引缺失将拒绝打开。

普通业务消息不混入会话字段。若 handler 要启动/停止受管实例，控制方须先进入 Client.session，再在该上下文调用 Peer；普通业务 handler 中直接发起生命周期写入会拒绝，以免与排空互相等待。原始 grant/revoke/forward 仍是 namespace 资源分配能力；实例与资源使用关系将在后续增量统一。四单元 SDK 的控制面接入、恢复写入和存活子进程接管均未据此宣称完成。验收见 [#26](https://github.com/PerishCode/electron-suite/issues/26)。

## 渠道分发契约纠偏（#28）

channel 对标产品分发生命周期；与 namespace 共同确定资源管理 factory。Sidecar 0.5 的会话按二者串行，但 allocator/registry 仍按 namespace 管理，尚未实现 factory 资源隔离。恢复与资源使用关系工作先让位于这一基础纠偏，不把已有会话测试扩张为资源隔离证明。

release 0.2 规范化 OpenDesign 的渠道实践：stable 使用 X.Y.Z；其他渠道使用 X.Y.Z-<channel>.N（N 为正安全整数）。渠道名为 1–12 个小写字母或数字；local 保留给开发运行时，不可发布。产品元数据使用不带 v 的规范版本，Git tag 的展示前缀不进入 manifest。不接纳含糊的 internal 后缀或 build metadata。protocol 0.2 提供统一渠道 token，config 0.2 与之保持类型依赖一致。

```ts
import { channelDescriptor, formatReleaseVersion, resolve } from "@perishcode/release";
const product = { appid: "io.perish.slim", name: "Open Design Slim", scheme: "opendesignslim" };
const descriptor = channelDescriptor("qa2", product);
const version = formatReleaseVersion(descriptor.channel, "1.2.3", 7);
const manifest = resolve({}, { channel: descriptor.channel, version }, product);
```

同一 descriptor 派生渠道安装 appid/name/scheme/origin 与 storagePrefix；parseReleaseVersion 支持从完整版本还原渠道，releaseMetadataVersionFields 统一生成 baseVersion/releaseVersion/releaseNumber（stable 为 stableVersion）。resolve、manifest parse/encode/decode 和 compose/emit 共享版本与渠道一致性检查；配置 version provider 也不能改变所属渠道。resolve 第三个参数传产品身份；省略仍使用 suite 参考产品默认值，产品消费者应显式传入。

本增量只交付渠道版本与产品身份契约。平台 namespace 默认值、factory 存储/API、CLI 的完整 build/pack/release 身份传递、reservation/latest CAS、发布门槛与四单元运行时接入仍由 [#28](https://github.com/PerishCode/electron-suite/issues/28) 推进。渠道是否公开、GitHub 发布与存储后端由产品策略决定。

## Sidecar 0.6：channel + namespace 资源 factory

本节取代前文 0.5 的 namespace-only 边界。config/release 0.3 同步 protocol 0.3 的精确类型依赖，使分发 descriptor 的 channel 可直接交给 factory，不需要类型转换或重复解析。渠道契约继续沿用 release 0.2 的行为。

承接 #28/#30 的渠道纠偏。选定产品数据根后，channel 与 namespace 共同确定 factory；版本/generation/service 是其内部管理对象，不改变 factory 的持久身份。protocol 0.3 提供 FactoryScope/factoryScope/factoryKey；namespace 支持小写词以单个连字符分隔，channel 保持 1–12 个小写字母或数字并允许开发 local。release 对 local 的不可发布约束仍由分发层管理。

```ts
const factory = service.factory({ channel, namespace });
await factory.session(async (scoped) => {
  const data = await scoped.grant({ kind: "data", name: "app", scope: "factory" });
  const attached = await scoped.expose({ identity: { service: "daemon", generation }, handlers, lifecycle });
});
const remote = client.factory({ channel, namespace });
await remote.session(async (scoped) => {
  const lease = await scoped.start(spec);
  await scoped.release(lease);
});
```

绑定后的 start/connect/expose/issue 补齐作用域；传入冲突身份会拒绝，attach/release/retire 校验句柄属于当前 factory。远程 Factory 不提供本地 expose，须从 Service.factory 创建。会话回调后的 scoped Factory/Client 失效。产品调用方使用 factory，不自行拼路径或借底层 Resources/Bindings/Sidecar 另建编排。

目录与 registry 升级为 schema 2，使用 factories 而非 namespaces。资源、ownership、registry 和 binding 位于受管根的 factories/<channel>/<namespace>；socket 短路径由完整受管 base 派生。FactoryEntry 与实例/会话记录使用同一身份；缺失索引、错配身份拒绝读取。持久 scope 从 namespace 改为 factory，临时资源仍为 attempt。相同 factory 的正常 manager 替换、generation 更替保留持久资源；同 namespace 不同 channel 的同名资源完全分离。

资源申请/释放/转发、资源快照初次打开和 binding 读取也参与 factory 会话；控制端断链后的 interrupted lane 不能从资源 API 绕过。业务 handler 需要控制方先进入会话才能执行受管资源写入。停止先取得会话，再拒绝该服务后续分配；排在 stop 后的分配会拒绝，不计入 stop 等待集合。

这是显式 API/存储格式变更：不再接受省略 channel 的 namespace-only 资源调用，不默认 stable。只接受当前 stamped-supervisor owner 与目录格式；旧格式拒绝读写，不提供旧格式读取或迁移适配。没有自动搬迁或清理旧资源，也没有恢复写入工具。

root manager 仍以单个排他 authority 承载多个 factory；其他 channel 的操作可推进不意味着 manager 崩溃故障域独立。源四单元适配已使用显式 factory 作用域和 factory 持久 scope，但尚未发布新四单元 SDK。恢复写入、存活子进程接管、完整资源使用关系和完整渠道发布编排仍未验收；不得以本增量替代 #28 的后续交付。

## 共享 pipeline 与薄发布 workflow

`@perishcode/pipeline` 提供版本、四单元资源构建、构建/打包收据、独立质量检测与 GitHub Release 发布机制；唯一 bin 仍为 pesuite。产品声明路径数据，不复制流程实现：

```yaml
pipeline:
  carrier: apps/electron
  capsule: apps/capsule
  daemon: apps/daemon
  web: apps/web
  blobs:
    probe: apps/capsule/dist/probe.bin
```

runtime 声明 stable 基础身份和版本；--channel 从基础产品派生安装身份，其他渠道通过 --number 或完整 --version 选择版本。version 也可用 --base 脱离仓库计算。build 运行各模块自有 build 工具，将 carrier、host.json 与经验证的 content 固化到 .artifacts/distribution/<channel>/versions/<version>/<fingerprint>，不会改源码配置。源码 Git 提交必须属于当前根，不能把外层仓库的提交记为嵌套消费者来源。产物/配置改变或失败构建不得复用旧成功证据。

```sh
pnpm exec pesuite version --channel preview --base 1.2.3 --number 1
pnpm exec pesuite build --channel preview --number 1
pnpm exec pesuite check --channel preview --gate tests
pnpm exec pesuite pack --channel preview --platform mac
pnpm exec pesuite check --channel preview --gate artifacts
pnpm exec pesuite check --channel preview --gate installed
```

policy、tests、artifacts、installed 是独立 check gate；--channel 只决定身份，工具不为 stable 隐式添加门槛。policy 同时检查两个 release workflow 的 run 为短入口，不允许本地 composite action 藏实现。由 stable.release.yml/channel.release.yml 显式决定质量 gap 和平台矩阵。pack 支持匹配原生 runner/架构的 mac/linux/win 目录包及归档，默认 unsigned；installed 当前仅验收 macOS 的实际首次/冷启动与受管退出，不扩张为签名/公证或所有平台运行时支持。

publish 需要明确 --repository，默认 --mode draft。--require 指定必须属于当前构建/产物/源码提交的通过记录；完整性和干净来源提交始终校验。工具先创建 draft、上传并核对资产，只有显式 release/prerelease 模式才提升，已有 tag 不覆盖，失败保留未公开的 draft 供检查。不在此版本实现跨平台资产聚合、远程更新信任或自动 latest feed。
GitHub 发布接口契约参考 [GitHub Releases REST API](https://docs.github.com/en/rest/releases/releases)。产品 workflow 默认 publish=false；CI registry 认证参考 [GitHub Packages npm](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)，token 通过环境注入，不能提交配置或日志。实际验收与未验收项见 #32。

发布组合：guard/cli 0.5.0、release 0.4.0、pack 0.2.0、pipeline 0.1.0。release 统一拥有 product 目录 IO，runtime 保留其既有 API 的源码 re-export；已发布四单元 SDK 仍为 0.1.0，pipeline 交付不代表 SDK 已完成 factory 版本迁移。


## 四单元 factory SDK（#38）

runtime/electron 0.2.0 与 CLI 0.6.0 将四单元 SDK 升级到 sidecar 0.6.0 / release 0.4.1。
这取代前文仍描述首版 SDK 的待迁移状态；产品依旧只消费固定 registry 版本。
Capsule 和 Session 绑定 factory 管理资源、进程与 binding，多步 lifecycle 操作在同 factory session 内执行。
跨 factory attempt 在管理写入前拒绝；候选及已挂载内容必须匹配分发身份。
运行收据同时记录 factory scope 与 sidecar directory 的 daemon 进程身份，不以业务层另建进程清单作为真相源。
正常停止先退休 daemon、凭据和临时资源，成功关闭 manager 后才报告 stopped；失败关闭保留重试入口。

正常升级与冷启动保留 factory 持久数据，同 namespace 的其他渠道独立。
SIGKILL 后父管道仍使 daemon 收敛，但 manager 保留 interrupted 权威，重新启动必须报 recovery required。
PESUITE_RECOVER 只恢复正常管理器内失败的 generation binding，不提供 manager 中断恢复或 live-child adoption。
不得删除 authority/registry、改根或猜测 stable 来恢复旧布局。本增量不实现旧 SDK 数据迁移执行器。


## 后台自动化 Electron 验证（#40）

SDK 0.2.1 的 HostOptions.automation 将后台窗口行为与 probe 的 ready 后退出分开。
probe 隐含 automation；长驻故障注入用 automation=true、probe=false，仍真实运行 BrowserWindow/renderer。
macOS 在 ready 前设 accessory activation policy，自动化窗口 show=false/focusable=false；正常交互启动保持原行为。
HostReceipt.automation 记录窗口 show/focus 事件与最终可见/可聚焦事实，自动化出现可见或聚焦窗口会拒绝验收。
参考 carrier 共用相同策略。slim 的故障验证通过 PESUITE_AUTOMATION=1 启用，不能用普通交互启动替代后台探针。
这些窗口事实不等价于所有系统配置下的 Space 保证；macOS 前台应用/Space 变化需独立只读观察。


## 原生全屏回归验收（#42）

`@perishcode/automation` 提供共享 `runElectron`、`Observer` 和证据判定。启动器强制后台参数，长驻 SIGKILL 场景使用 probe=0、automation=1；产品仅声明验证环境和业务断言，不复制原生实现。Observer 只读查询真实 Space ID/type，记录目标 PID 激活、ready 收据观察、终止请求与实际退出；退出后默认继续观察 1500ms。未处于原生全屏、原生符号不可用或采样缺失均不能通过验收。用户主动切换 Space 也会使本轮证据失败，不归因为应用故障。

```sh
pnpm exec pesuite check --channel preview --gate desktop
```

此关卡显式执行正常退出、失败启动和真实 SIGKILL；发布方可以明确选择 `--require desktop`。工具不根据 stable 暗加该门槛，现有无桌面上下文的 CI 不声称完成全屏验收。installed 关卡同时检查 SDK 的实际 automation 窗口收据，但不能替代 desktop。

固定分发版本：automation 0.1.0、pipeline 0.2.0、cli 0.7.0。原生观察源码由受管测试目录编译，使用只读 SkyLight 查询；无符号/无 Swift 工具链明确拒绝。正常应用 SDK、正式安装包身份和系统设置不改变。

## 本地 inspect / serve

`pesuite serve --channel stable --namespace primary` 按 pesuite.yaml/serve 声明启动前台静态源；每个源的端口、socket、路径与生命周期归 sidecar 管理。修改目录中的元数据和真实文件即可提供下一组候选，server 不承担更新决策。

`pesuite inspect list --data <manager-root> --channel <channel> --namespace <namespace>` 从 sidecar 私有发现文件连接并验证 manager，再取得实例目录。probe/call/stop 选择精确 service/generation；call/stop 还要求 incarnation，避免操作重启后的另一个实例。方法由调用方定义，SDK 的 Session.expose / HostOptions.inspect 可接入实际四单元宿主；管理凭据不进入 renderer 或 CLI 输出。

本轮版本：sidecar 0.6.1、inspect/serve 0.1.0、runtime 0.2.1、electron 0.2.2、guard 0.5.1、pipeline 0.2.1、cli 0.8.0。交付及证据以 #44 为准；#11/#12 的完整主线门保持逐项验证。

## 运行中候选准备

publish.writeFeed 将公开签名/内容协议投影为普通静态文件，最后原子替换 channel 指针；不导出私钥。update.watch 托管在调用方 sidecar service 中，自动发现、限量下载、校验并缓存 Web/Daemon 候选，通过 inspect 的 updates/status 解释结果，停止时取消在途请求。

prepared 不表示 activated：本轮不修改 binding、不替换运行中的单元。Capsule、carrier 与 blob 改变会拒绝进入这一层；#13 的最小影响激活仍需独立验收。serve 的私有 fault 方法提供精确路径的 404/坏字节/截断/停滞 fixture。版本与证据见 #46。

## Web / Daemon 最小影响激活

#48 在已准备候选上增加 runtime/Electron 唯一激活入口。unit.json 随实际资源字节校验，声明独立版本和接口：Web-only 保留 daemon PID，Daemon-only 保留当前文档，协同更新在旧文档被围栏后切换。兼容集合 binding、进程 artifact 身份和文档 nonce 分别记录。

HostOptions.updates.activate 为显式开关，默认仍只准备。失败会报告实际基线恢复结果并保留失败 binding，正常退出后可显式恢复已提交代际。数据保留不表示回滚业务写入；live-process adoption、断电持久性及完整原生全屏仍未验收。版本、实际消费与 CI 证据见 #48。

Activation interruption probes are tracked by #50 under #13. Optional runtime onActivation checkpoints observe preparation, daemon retirement, readiness and durable commit without replacing actual readiness gates. Sidecar readBinding provides offline journal/directory facts under manager exclusion. File/rename/parent-directory synchronization failures are not reported as successful commits; ambiguous post-rename failures fence the live binding owner. Interrupted-manager startup remains blocked, including explicit binding recover: safe refusal is not manager recovery. No power-loss, adoption or native fullscreen claim follows from these probes.

Sidecar 2.0 uses stamped supervisors as stable process roots. Factory.start declares service identity and arbitrary workload; private supervisor/IPC/OS observation/stop escalation remain package-owned. observeProcesses reports actual root/descendant identities independently of the manager, while directory schema 4 retains birth witnesses, including session controller identity. Only owner schema 3/stamped-supervisor is supported: no old-format reader, dual runner or migration shim. Old experiment roots remain historical evidence. macOS/Linux process observation is supported; other platforms reject runtime launch. See #53 and AGENTS.md.

Explicit recovery (#56): `pesuite recover inspect --data <root>` reconciles a stopped manager's complete root; `pesuite recover apply --data <root> --expected <fingerprint>` applies only that verified intent. All factory locks, OS witnesses, metadata and endpoint identity must agree. Live/unknown state refuses. Recovery intent is durable and retryable across SIGKILL/IO failure, retains durable data/CAS and committed current, and marks running attempts failed before a fresh manager can start. Product binding recovery is still an explicit subsequent choice. Current owner3/directory4 formats only, with no migration or legacy readers; Resources/Bindings are private. See AGENTS.md for scope and evidence.


Capsule is Electron adaptation code and has no independent sidecar identity. Its create/initialize/ready/stop callbacks arrange loading, product IPC, local Web/Daemon communication, channel OS links and leaf-update tasks. Electron owns the resource Context and stable recovery boundary; Generations owns content selection. #60 supersedes #58's hosted Capsule model. The local acceptance matrix spans actual development/installed starts, IPC/protocols, updates, interruptions and resources; #14/#15/#16 keep their incomplete gates open.
