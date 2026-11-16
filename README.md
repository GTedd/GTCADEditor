# CAD Editor（GT 版）

[CAD Editor Recast](https://github.com/Rinorsi/CAD-Editor-Recast) 的 GT 版：在上游 0.99.9 的源码基础上，只构建 **Minecraft 26.3 的 Fabric 模组**和 **Paper 26.3 插件**，并补充了服务端的**编辑历史**（可增删改查）和**按节点的权限控制**（防止权限外泄和客户端冒充管理员）。

| 产物 | 给谁用 | 位置 |
|---|---|---|
| `cadeditor-fabric-26.3-<版本>.jar` | 玩家客户端；也能装在 Fabric 专用服务器上 | `client/build/libs/` |
| `cadeditor-paper-26.3-<版本>.jar` | Paper 服务器（插件名 `CADEditor`） | `paper/build/libs/` |

版本号 `0.99.9+gt.1` 表示“上游 0.99.9 的 GT 版第 1 次修订”。编辑器的网络协议没有版本号，**服务器和客户端要用同一次构建**。

## 目录结构

参照 GTOrielUI：一个共享源码树加两个模块。

```
common/src/main/java       共享源码：协议、服务端编辑逻辑、编辑历史、权限判定（dev.rinorsi.editor.*）
common/src/main/resources  语言文件：简体中文、English、繁體中文（服务端回复按客户端语言给出）
client/                    Fabric 模组：编译 common + 自己的源码（编辑器界面、Oriel 页面、Fabric 接入、mixin）
  src/test/java            回归程序（main 方法）与 JUnit 测试
  verification.gradle      回归程序的 JavaExec 任务
paper/                     Paper 插件：编译同一份 common + 自己的源码（Bukkit 传输、PaperPlatform）
  src/probe/java           编辑器的服务端探针（只进 -probe jar，测试服用）
tools/                     界面 node 测试、i18n 同步、探针与端到端测试脚本
docs/                      本项目文档；docs/editor/ 是上游的设计文档与字段快照
```

`common` 不是 Gradle 项目，只是源码目录：`client` 和 `paper` 各自把它编进去。`common` 里禁止出现客户端、Fabric、Oriel、Bukkit、Paper 的类型，`./gradlew check` 里的 `checkCommonBoundary` 会检查。两个平台的差异全部走 `Platform` 接口（`common/.../platform/Platform.java`），实现分别是 `client/.../fabric/FabricPlatform.java` 和 `paper/.../PaperPlatform.java`。

## 构建

前提：JDK 25、Node.js（i18n 与界面检查）、Git，以及 Oriel 0.15.0。

Oriel（编辑器的页面引擎）来自同目录的 GTOrielUI。第一次构建前，在 GTOrielUI 里发布一次精简版：

```bash
cd ../GTOrielUI
./gradlew :client:publishAllPublicationsToTemplateLocalRepository -Poriel_slim
```

`gradle.properties` 的 `orielRepository` 默认指向 `../GTOrielUI/build/template-maven`，也可以改成任何有 `dev.oriel:oriel-fabric-26.3:0.15.0` 的 Maven 目录（MavenLocal 同样可用）。

```bash
./gradlew build        # 模组 + 插件 + 全部检查
./gradlew check        # 只跑检查
./gradlew :paper:probeJar   # 带服务端探针的插件，只用于测试服
./gradlew spotlessApply     # 统一代码格式（Java：palantir-java-format；界面脚本：Prettier），check 会检查格式
```

- Gradle 用阿里云镜像（9.7.1），守护进程固定在 JDK 25（`gradle/gradle-daemon-jvm.properties`，paperweight 要求）。
- Loom 和 paperweight 分别只在 `client`、`paper` 里加载，互不干扰。
- 模组默认把 Oriel 打进 jar（jar-in-jar），玩家只装一个文件；`-PorielEmbedded=false` 则需另装 Oriel。

## 安装

**客户端**：`cadeditor-fabric-26.3-*.jar` + Fabric API，放进 `mods/`。

**Paper 服务器**：`cadeditor-paper-26.3-*.jar` 放进 `plugins/`，不需要其他前置插件。配置在 `plugins/CADEditor/cadeditor.json`，历史在 `plugins/CADEditor/history/`。

**Fabric 服务器 / 单人**：装同一个模组 jar 即可，配置在 `config/cadeditor.json`，历史在各自存档的 `cadeditor-history/` 里。

## 权限与编辑历史

完整说明见 [docs/编辑历史与权限.md](docs/编辑历史与权限.md)。要点：

- 每项服务端能力一个节点（`cadeditor.item.edit`、`cadeditor.world.read`、`cadeditor.world.edit`、`cadeditor.player.edit`、`cadeditor.player.offline`、`cadeditor.vault.give`、`cadeditor.history.*` 等）。Paper 上 LuckPerms 等权限插件的明确设置优先；Fabric 上支持 fabric-permissions-api；都没有设置时按 OP 等级和 `cadeditor.json` 判断。
- 判定只用服务端自己知道的事实，每个请求重新判定，世界编辑先查节点再找目标。请求里声明身份或权限的字段会被拒绝并记为 `forged`。
- **与上游不同**：没有权限的创造模式玩家默认只能编辑自己的物品，不能再读写方块和实体（`creativeWorldEdit` 可恢复上游行为）。
- 每个编辑器请求都会在服务端留下一条记录：谁、何时、对什么、结果、拒绝原因和涉及的节点。编辑器里有“编辑历史”窗口（保险库窗口底部按钮，或 `/cade history`），服务器有 `/cadeditor history list|search|view|add|note|tag|delete|purge`。只能改备注和标签，删除和清除本身也会被记录。
- `/cadeditor permissions [玩家]` 查看节点的实际判定。
- 物品规则（`itemRules`）：没有 `cadeditor.item.bypass` 的玩家不能放入违禁物品、不能伪造或剥离插件数据等受限组件、不能写入会执行命令的点击事件。
- 客户端进服后先和服务端握手，确认装了插件才发送编辑请求；打开自己的物品不再请求服务端，应用修改时才由服务端严格校验。
- 服务器**没装**插件或模组时只用原版手段：创造模式用原版创造槽位包写回自己的背包；非创造模式只有 OP（有指令权限）才能用原版命令写回物品、保险库“给我”和自身玩家页（命令不超过 256 字符，不会因此被踢），其他玩家可以编辑草稿，但应用会在本地被拒绝。每次应用都按当时的游戏模式和权限重新判断。
- 控制台默认不打印逐请求日志（`debugLog` 可打开），操作都在编辑历史里。

## 验证

见 [docs/验证记录.md](docs/验证记录.md)：本地检查、Paper 上的编辑器服务端探针、客户端连服的端到端测试（用本项目自己构建的模组）。

## 与上游的关系

- 源码取自 CAD-Editor-Recast `50723fb`（0.99.9），已并入本仓库，不再是 submodule。Stonecutter 的多版本条件代码已按 26.3 展开，NeoForge、26.1、26.2、发布与宣传工具已删除。
- 原先插件用的 4 个 Paper 补丁改成了 `Platform` 钩子（末影箱容量、静默设置游戏模式、离线玩家的统计与进度、`Spigot.ticksLived` 列入易变字段），不再需要打补丁。
- 同步上游：不做整体对比，逐个分析上游在 `gradle.properties` 的 `upstream_commit` 之后的提交，判断是否需要、对应本仓库哪些文件，再手工移植，完成后更新 `upstream_commit`，跑 `./gradlew check`、探针和实机测试。本仓库统一了代码格式（`./gradlew spotlessApply`）并把文案键改成了有含义的名字，上游补丁不能直接套用；上游新增的服务端类如果引用了客户端代码，`paper` 编译或 `checkCommonBoundary` 会报出来。

## 许可

编辑器代码为 MIT（© Rinorsi，见 `LICENSE`、`NOTICE`），随模组和插件 jar 一起分发。本仓库新增部分的许可证尚未指定。
