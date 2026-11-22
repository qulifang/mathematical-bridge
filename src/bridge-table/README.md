# 桥牌记牌器

源码在本目录。学院网站从「学习资料 → 常用工具 → 桥牌记牌器」打开 `/tools/bridge-table/`。页面、样式和交互分别在 `index.html`、`style.css` 和 `app.js`，桥牌规则及 PBN 在 `bridge.js`，开闭室对分在 `match.js`。

从仓库根目录运行 `python tools/manage.py` 预览，或运行 `python tools/project.py --output-dir dist` 生成发布版。GitHub Actions 会随主站发布。源码目录含字体和许可证，照片、生成的 PBN、发布包和 APK 不进仓库。

## 记录和识牌

叫牌、计分、牌例簿、开闭室对分和 PBN 导出都在浏览器执行。记录和选入的照片留在当前浏览器及域名下。开闭室在赛后交换成绩文本。

可以对着照片手录牌，或粘贴已有的 PBN Deal。识牌接口接通后，选择照片并点「识别四手牌」，返回的牌面会直接出现在核对区。照片只在点识别时上传，交给 [BridgeLens](https://bridgelens.johnfaben.com/about) 处理，后端不保存照片，也不勾选训练选项。

## 开通站内识牌

学院主站继续使用 [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。仓库里的 `tools/bridge-recognition/_worker.js` 单独部署到 Cloudflare Pages 免费项目，用来转送照片和读取识别结果。

1. 负责人创建 Cloudflare Pages 的 Direct Upload 项目。在仓库的 `tools/bridge-recognition/` 目录运行 `npx wrangler pages deploy . --project-name 项目名` 完成部署。
2. 在 Pages 项目里添加自定义域名，例如 `recognize.fdmathbridge.top`。域名负责人只需为这个子域名添加 CNAME，指向该项目的 `*.pages.dev` 地址。主站现有的 DNS 记录沿用。
3. 接口通过测试后，在学院 GitHub 仓库的 Actions Variables 设置 `BRIDGE_RECOGNITION_URL` 为 `https://recognize.fdmathbridge.top/api/recognize`，再运行一次 Pages 发布工作流。变量为空时，页面仅显示手录及 Deal 导入。
4. 用不走代理的手机网络，从学院子页上传一张四手牌照片，确认结果直接出现。免费额度与网络可达性以实际使用为准。

[Cloudflare Pages 上传方式](https://developers.cloudflare.com/pages/get-started/direct-upload/) · [给 Pages 添加自定义子域名](https://developers.cloudflare.com/pages/configuration/custom-domains/)
