<p align="center">
  <img src="client/src/main/resources/assets/cadeditor/icon.png" width="96" alt="CAD Editor">
</p>

<h1 align="center">CAD Editor · GT 版</h1>

<p align="center">
  在游戏里直接编辑物品、方块和实体的 NBT 编辑器——这一版给服务器加上了权限和编辑历史。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Minecraft-26.3-62B47A" alt="Minecraft 26.3">
  <img src="https://img.shields.io/badge/Fabric-0.19.5+-DBD0B4" alt="Fabric">
  <img src="https://img.shields.io/badge/Paper-26.3-F7CF0D" alt="Paper 26.3">
  <img src="https://img.shields.io/badge/Java-25-ED8B00?logo=openjdk&logoColor=white" alt="Java 25">
  <img src="https://img.shields.io/badge/Oriel_UI-0.15_~_0.16-7E57C2" alt="Oriel UI 0.15 ~ 0.16">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <a href="https://github.com/Rinorsi/CAD-Editor-Recast"><img src="https://img.shields.io/badge/upstream-CAD_Editor_Recast_0.99.9-555" alt="upstream"></a>
</p>

---

[CAD Editor Recast](https://github.com/Rinorsi/CAD-Editor-Recast) 本身已经很好用了，但放到多人服务器上有两个问题：
谁改了什么查不到，以及客户端说自己有权限，服务端基本就信了。这个分支就是为了解决这两件事：

- **按节点的权限控制**。每项服务端能力单独一个权限节点，每个请求都在服务端重新判定，客户端没法冒充管理员。
- **编辑历史**。每次编辑都在服务端留一条记录，能查、能搜、能加备注和标签，删除本身也会被记下来。
- **Paper 插件**。同一份服务端逻辑也打成了 Paper 插件，Paper 服务器不用换核心就能让装了模组的玩家用完整编辑器。

代价是只保留 Minecraft 26.3：上游的 NeoForge、26.1、26.2 都删掉了。

## 下载哪个

| 文件 | 装在哪 |
|---|---|
| `cadeditor-fabric-26.3-<版本>.jar` | 玩家客户端的 `mods/`（还要 Fabric API）。Fabric 专用服务器和单人存档也用它 |
| `cadeditor-paper-26.3-<版本>.jar` | Paper 服务器的 `plugins/`，不需要其他前置 |

版本号 `0.99.9+gt.2` 读作“上游 0.99.9 的 GT 版第 2 次修订”。编辑器的网络协议没有版本号，**服务器和客户端请用同一次构建的产物**，混用不同版本可能出现字段对不上的问题。

模组默认把 Oriel UI（编辑器的界面引擎）打包在 jar 里，玩家只需要装一个文件。如果你另外装了 Oriel UI 完整版 0.16.x，游戏会优先加载那个完整版，两者不冲突。

配置和历史的位置：

- Paper：`plugins/CADEditor/cadeditor.json`，历史在 `plugins/CADEditor/history/`
- Fabric 服务器 / 单人：`config/cadeditor.json`，历史在各存档的 `cadeditor-history/`

## 权限

Paper 上，LuckPerms 之类权限插件里的明确设置优先；Fabric 上支持 fabric-permissions-api。都没设置时，按 OP 等级和 `cadeditor.json` 判断（下表的“默认”一列）。

| 节点 | 管什么 | 默认 |
|---|---|---|
| `cadeditor.use` | 使用任何服务端功能 | 所有人 |
| `cadeditor.item.edit` | 任何模式下直接写自己的背包和打开的容器 | 管理员 |
| `cadeditor.item.creative` | 创造模式下编辑物品 | 管理员，或创造模式玩家 |
| `cadeditor.item.bypass` | 不受 `itemRules` 限制 | 管理员 |
| `cadeditor.world.read` / `world.edit` | 读 / 写方块实体和实体 | 管理员 |
| `cadeditor.player.edit` | 读写在线玩家数据 | 管理员 |
| `cadeditor.player.offline` | 玩家列表和离线玩家文件 | 管理员 |
| `cadeditor.vault.give` | 生存 / 冒险模式下从保险库“给我” | 管理员 |
| `cadeditor.history.own` | 看自己的历史 | 所有人 |
| `cadeditor.history.view` / `history.edit` | 看所有人的历史 / 加记录、改备注和标签 | 管理员 |
| `cadeditor.history.delete` | 删除和清除记录 | 服主（OP 4 级、控制台） |

“管理员”指 OP 等级不低于 `permissionLevel`（默认 2）。拿不准某个玩家实际能做什么，用 `/cadeditor permissions <玩家>` 看判定结果。

有几处和上游不一样，升级前留意一下：

- 没有权限的创造模式玩家默认**只能编辑自己的物品**，不能再读写方块和实体。想要上游的行为，把 `creativeWorldEdit` 设为 `true`。
- 请求里带着“我是谁”“我有什么权限”之类字段的，一律拒绝，并在历史里记成 `forged`。
- 没有 `cadeditor.item.bypass` 的玩家受 `itemRules` 约束：不能放违禁物品，不能伪造或剥掉插件数据之类的受限组件，不能写会执行命令的点击事件。

## 编辑历史

每个编辑器请求都会留下一条记录：谁、什么时候、改了什么、成功还是被拒、拒绝原因、涉及哪些节点。记录里的事实不能改，只能补充备注和标签。

- 游戏里：保险库窗口底部的“编辑历史”按钮，或者 `/cade history`
- 服务器命令：`/cadeditor history list|search|view|add|note|tag|delete|purge`

控制台默认不刷逐条日志，需要时打开 `cadeditor.json` 里的 `debugLog`。

## 服务器没装插件时

客户端进服后会先和服务端握手，确认装了插件才发编辑请求。服务器什么都没装的话，编辑器只用原版能做到的方式：

- 创造模式：通过原版的创造模式槽位包写回自己的背包。
- 非创造模式：只有 OP 能用原版命令写回物品、使用保险库“给我”和编辑自己的玩家页（命令控制在 256 字符以内，不会被踢）。其他人可以编辑草稿，但“应用”会在本地被拦下。
- 方块和实体页面只读打开，顶部会一直提示服务端没装 CAD Editor。

每次应用都按当时的游戏模式和权限重新判断，中途切模式不会绕过限制。

## 从源码构建

需要 JDK 25、Node.js（i18n 和界面检查要用）和 Git。

**1. 先准备 Oriel UI。** 它没有发布到公共 Maven，需要从 [GTOrielUI](https://github.com/GTedd/GTOrielUI) 构建一次。编辑器只用到 0.15 的接口，所以公开仓库里现有的 0.15.0 就够了。把它克隆到本仓库旁边：

```bash
git clone https://github.com/GTedd/GTOrielUI.git ../GTOrielUI
cd ../GTOrielUI
./gradlew :fabric:26.3:publishAllPublicationsToTemplateLocalRepository -Poriel_slim
```

产物会落在 `../GTOrielUI/build/template-maven`，这正是 `gradle.properties` 里 `orielRepository` 的默认值。放在别处也行，改 `orielRepository` 指过去，或者换成 `publishToMavenLocal` 发布到本机的 MavenLocal。

**2. 构建。**

```bash
./gradlew build             # 模组 + 插件 + 全部检查
./gradlew check             # 只跑检查
./gradlew spotlessApply     # 格式化代码；check 会检查格式
./gradlew :paper:probeJar   # 带服务端探针的插件，只给测试服用
```

产物在 `client/build/libs/` 和 `paper/build/libs/`。

**用更新的 Oriel 构建。** 如果你本地有更新的 Oriel（比如 0.16.0），不用改 `gradle.properties`。在仓库根目录建一个 `local.properties`（已被 git 忽略）：

```properties
oriel_version=0.16.0
```

它会覆盖 `gradle.properties`，命令行的 `-P` 又会覆盖它。允许的范围由 `oriel_min` / `oriel_max` 决定（现在是 `>=0.15.0 <0.17.0`），这个范围也会写进 `fabric.mod.json`，超出范围构建会直接报错。不想把 Oriel 打进 jar，加 `-PorielEmbedded=false`，玩家就得另外安装 Oriel。

一些构建细节：

- Gradle 走阿里云镜像；守护进程固定在 JDK 25（`gradle/gradle-daemon-jvm.properties`），这是 paperweight 的要求。
- Loom 只在 `client` 里加载，paperweight 只在 `paper` 里加载，两边互不干扰。

## 代码结构

```
common/src/   共享源码：协议、服务端编辑、编辑历史、权限判定，以及三种语言的文案
client/       Fabric 模组：common + 编辑器界面、Oriel 页面、Fabric 接入
paper/        Paper 插件：common + Bukkit 传输层、PaperPlatform
tools/        界面的 node 测试、i18n 同步、探针和端到端测试脚本
```

`common` 不是一个 Gradle 项目，只是一个源码目录，`client` 和 `paper` 各自把它编译进去。所以 `common` 里不能出现客户端、Fabric、Oriel、Bukkit 或 Paper 的类型，`./gradlew check` 里的 `checkCommonBoundary` 会拦住。两个平台的差异都收在 `Platform` 接口里（`common/.../platform/Platform.java`），实现分别是 `FabricPlatform` 和 `PaperPlatform`。

## 和上游的关系

源码取自 CAD-Editor-Recast 的 `50723fb`（0.99.9），直接并进了本仓库，不再是 submodule。Stonecutter 的多版本代码已经按 26.3 展开；以前插件依赖的 4 个 Paper 补丁改成了 `Platform` 钩子，不用再给 Paper 打补丁。

同步上游时不做整体 diff，而是逐个看 `gradle.properties` 里 `upstream_commit` 之后的上游提交，判断要不要、对应这边哪些文件，再手工移植。这边统一了代码格式，也把文案键改成了有含义的名字，所以上游补丁没法直接套。移植完更新 `upstream_commit`，跑一遍 `./gradlew check`。

更新记录见 [CHANGELOG.md](CHANGELOG.md)，已知问题和待办见 [TODO.md](TODO.md)。

## 许可

编辑器代码是 MIT 许可，© Rinorsi，详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)，随模组和插件 jar 一起分发。本仓库新增部分的许可证尚未确定。
