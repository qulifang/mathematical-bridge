# GitHub 协作与发布

## 首次切换 Pages（负责人操作一次）

1. 在现有仓库用 PR 引入维护源码和 `.github/workflows/pages.yml`。迁移 PR 暂时保留现有根目录的网页入口与生成资源，供原发布方式继续使用。
2. 合并迁移 PR 后，将 **Settings → Pages → Build and deployment → Source** 改为 **GitHub Actions**。确认 Custom domain 仍是 `fdmathbridge.top`，沿用现有 DNS。
3. 打开 **Actions → GitHub Pages → Run workflow**，选择 `main`。等「构建网站」和「发布网站」成功，打开正式网站检查首页、牌例、相册和下载。
4. 上线确认后，另开 PR 删除旧发布产物 `index.html`、`assets/`、`data/` 及原来用于分支发布的根目录 `CNAME`（如有 `.nojekyll` 也可一并删除）。保留 `src/`、`tools/`、`content/`、`media/`、站点工作流和文档。此后 Pages 仅接收构建生成的网页目录。

如果首次 Actions 发布失败，先查看失败步骤。原生成文件仍在时，可暂时把 Pages 切回 **Deploy from a branch → main → /(root)**，确认域名设置后再排查。

## 审核规则

- 启用针对 `main` 的规则，要求通过 PR、至少一个批准，且追加会改变内容的提交时撤销旧批准。
- `Repository admin` 使用 **For pull requests only**，负责人自己的改动也走 PR，可在合并时豁免审批。
- `.github/CODEOWNERS` 将 `@qulifang` 设为所有文件的审核人。迁移合并后，在规则里启用 **Require review from Code Owners**，让成员的 PR 必须有负责人批准。普通维护者使用协作者权限，管理员豁免只留给负责人。处理成员改动时先完成审核，再合并。
- PR 的「构建网站」验证内容和附件。在 Actions 已为 PR 跑出此检查后，可以把它设为必过检查。Pages 的部署只在 `main` 运行，合并前不要要求生产部署成功。

## 每次更新

1. 第一次在 GitHub Desktop 克隆本仓库。以后每次先同步 `main`，再按下方约定建工作分支。
2. 运行 `启动维护.cmd`，通过「内容管理」录入并预览。保存后在 Desktop 核对 **Changes**，将目录和实际引用的附件一起提交。
3. 点 **Publish branch** 或 **Push origin**，创建以 `main` 为目标的 PR。说明改动、检查结果以及有无替换或删除。根据审核反馈在原分支补交更新。
4. 负责人检查 **Files changed** 和构建结果。必要时切到成员分支本机预览，核对活动、牌号、署名及下载。审核通过后合并。
5. 在 Actions 检查 `main` 的发布，再到正式网站验收。网络上已打开的旧页面可刷新后检查。

## 分支命名

工作分支统一使用 `类型/日期-说明`。日期用创建分支当天的 `YYYY-MM-DD`，月份和日补足两位。说明用简短的小写英文，可包含数字，单词之间用 `-` 分隔。每个分支对应一项改动，按主要目的选择类型。

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `content` | 内容更新：新增或修改讲义、训练牌、复盘和照片 | `content/2026-11-22-training` |
| `bugfix` | 问题修复：修复网站或维护工具中的问题 | `bugfix/2026-11-22-gallery-flicker` |
| `feature` | 功能新增：添加网站功能 | `feature/2026-11-22-board-search` |
| `docs` | 文档变更：修改说明或维护指南 | `docs/2026-11-22-branch-naming` |
| `chore` | 杂项：整理仓库、清理旧文件或调整发布配置 | `chore/2026-11-22-cleanup-legacy-files` |

`main` 用于正式发布。工作分支在创建 PR 前确定名称，因为改名会关闭以该分支为来源的未合并 PR。合并后可以删除工作分支，已合并的改动和 PR 记录会保留。

## 版本记录

日常内容用 PR 和提交记录追溯。需要发版本时，先核对 Pages 部署成功的提交，再到 **Releases → Draft a new release** 创建新标签并说明具体变化。`v1.0.0-beta.1` 是首个试用版，`v1.0.0` 是首个正式版。之后的修复版可用 `v1.0.1`，新增重要功能用 `v1.1.0`，大改版用 `v2.0.0`。Beta 勾选 **This is a pre-release**。

[GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) · [Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
