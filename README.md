# DSH Task Board

[中文说明](README.zh.md)

`dsh-task-board` is a community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It adds a durable task board to the Web profile as one installable package and one Loader entry.

The package includes the Host service, Session bridge, generated Typert RPC contribution, and browser UI. Users install one repository; the plugin adds only the `task-board` row to the profile configuration.

## Requirements

- DeepSeek Harness `0.1.0-rc.6`
- Node.js `^22.19.0` or `>=24`
- `pnpm` available on `PATH`, as required by `dsh plugin`
- A configured model credential only when a task should run an agent; browsing and editing the board do not require one

## Install

```sh
dsh plugin --profile web add github:scwlkq/dsh-task-board
```

Confirm that the bundle contributes one row:

```sh
dsh --profile web --dump-config
```

The output contains one `task-board` Loader row supplied by `dsh-task-board`. Start the Web profile:

```sh
dsh web
```

Open the printed local URL, then select **Task Board** in the sidebar. The Settings plugin list shows this extension as one `task-board` entry rather than separate Host, RPC, and UI packages.

## Features

- Create durable task cards with a title, description, acceptance criteria, workspace or working directory, Agent Preset, and image attachments
- Edit, reorder, reopen, and delete cards
- Start or stop task execution through ordinary DSH Sessions
- Review completed work, approve it, reject it with feedback, send follow-up work, or retry a failed round
- Inspect round activity and Session history
- Refresh the browser projection from the authoritative Host snapshot without requiring a custom event-forwarding patch in DSH

Task records use the profile's DSH storage. Removing the browser plugin does not silently submit or modify tasks.

## Update and remove

Update the installed Git dependency:

```sh
dsh plugin --profile web update dsh-task-board
```

Remove the bundle and its Loader row:

```sh
dsh plugin --profile web remove dsh-task-board
```

## Develop locally

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
dsh plugin --profile web add .
```

The repository commits `lib/` so GitHub installation does not depend on `prepare`, `install`, or another lifecycle build script. `pnpm pack --dry-run --json` shows the same prebuilt runtime files shipped in a release tarball.

## License

[MIT](LICENSE)
