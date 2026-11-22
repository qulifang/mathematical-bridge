# Mathematical Bridge

学院桥牌网站 · [fdmathbridge.top](https://fdmathbridge.top)

本仓库保存网页源码、录入工具、内容目录和网站使用的素材。成员本机编辑，通过 Pull Request（PR）提交给负责人检查。合并到 `main` 后，GitHub Actions 构建并发布静态网站。

## 第一次维护

1. 安装 [GitHub Desktop](https://desktop.github.com/) 和 [Python 3.10 或更新版本](https://www.python.org/downloads/)，用自己的 GitHub 账号接受仓库邀请。
2. 用 GitHub Desktop 的 **File → Clone repository** 克隆本仓库。以后在原目录同步 `main` 即可。
3. 从 `main` 建一个工作分支。Windows 双击 `启动维护.cmd`，浏览器会打开本机预览，在页脚点击「内容管理」。macOS/Linux 可运行 `python3 tools/manage.py`。
4. 保存并预览后，在 GitHub Desktop 提交工作分支，推送并创建目标为 `main` 的 PR。操作和审核约定见[协作与发布](docs/GitHub协作与发布.md)。

维护服务只在 `127.0.0.1` 上运行，编辑期间保持启动窗口打开。日常维护使用 Python 标准库。

## 项目文件

| 位置 | 用途 |
| --- | --- |
| `content/catalog.json` | 条目、素材引用和复盘正文 |
| `content/conventions.json` | 约定叫文档目录 |
| `media/lesson`、`media/system`、`media/tool` | 讲义、约定和工具附件 |
| `media/session`、`media/photo` | 训练 PBN、展示照片和缩略图 |
| `src/` | 页面、样式与浏览器交互 |
| [`src/bridge-table/`](src/bridge-table/README.md) | 桥牌记牌器源码，发布至 `/tools/bridge-table/` |
| `tools/` | 本机维护服务和静态构建 |
| `.github/` | 审核人、PR 模板与 Pages 工作流 |
| `docs/` | 维护、协作与交接说明 |

录入方法见[日常维护](docs/日常维护.md)，文件处理见[仓库与交接](docs/仓库与交接.md)。

本地「生成发布包」与「下载维护备份」用于预览、备份及恢复。`releases/` 和 `dist/` 都是本机产物，Git 会忽略它们。日常协作从仓库同步源码和内容。
