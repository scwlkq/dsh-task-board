# DSH Task Board

[English](README.md) | 中文

`dsh-task-board` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区插件。它用一个可安装包、一个 Loader 配置条目，为 Web profile 增加持久化任务看板。

这个包同时包含 Host 服务、Session 桥接、生成的 Typert RPC contribution 和浏览器界面。用户只安装一个仓库；插件只向 profile 配置新增一条 `task-board`，不会把 Host、RPC 和 UI 拆成多个设置项。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6`
- Node.js `^22.19.0` 或 `>=24`
- `PATH` 中可以找到 `pnpm`，这是 `dsh plugin` 的运行要求
- 只有让任务真正执行 Agent 时才需要配置模型凭据；浏览和编辑看板不需要模型凭据

## 安装

```sh
dsh plugin --profile web add github:scwlkq/dsh-task-board
```

先确认组合配置只增加一条记录：

```sh
dsh --profile web --dump-config
```

输出中应当出现由 `dsh-task-board` 提供的一条 `task-board` Loader 记录。然后启动 Web profile：

```sh
dsh web
```

打开终端输出的本地地址，在侧边栏选择“任务看板”。设置页的插件列表中，本插件只显示为一个 `task-board`，不会分别显示 Host、RPC 和 UI 子包。

## 功能

- 创建持久化任务卡片，可填写标题、描述、验收标准、Workspace 或工作目录、Agent Preset，并添加图片附件
- 编辑、排序、重新打开和删除卡片
- 通过普通 DSH Session 启动或停止任务执行
- 审阅完成结果，可通过、填写反馈后驳回、追加任务或重试失败轮次
- 查看每一轮活动记录和对应的 Session 历史
- 定时从 Host 权威快照刷新浏览器状态，不要求 DSH 额外转发自定义事件

任务数据使用当前 profile 的 DSH 存储。移除浏览器插件不会静默提交或修改任务。

## 更新与卸载

更新已经安装的 Git 依赖：

```sh
dsh plugin --profile web update dsh-task-board
```

移除组合包及其 Loader 配置条目：

```sh
dsh plugin --profile web remove dsh-task-board
```

## 本地开发

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
dsh plugin --profile web add .
```

仓库会提交 `lib/` 预构建产物，因此通过 GitHub 安装时不依赖 `prepare`、`install` 或其他生命周期构建脚本。运行 `pnpm pack --dry-run --json` 可以查看 Release tarball 实际包含的预构建运行文件。

## 许可证

[MIT](LICENSE)
