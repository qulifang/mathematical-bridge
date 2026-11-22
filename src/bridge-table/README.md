# 桥牌记牌器

源码在本目录。学院网站从「学习资料 → 常用工具 → 桥牌记牌器」打开 `/tools/bridge-table/`。页面、样式和交互分别在 `index.html`、`style.css` 和 `app.js`，桥牌规则及 PBN 在 `bridge.js`，开闭室对分在 `match.js`。

从仓库根目录运行 `python tools/manage.py` 预览，或运行 `python tools/project.py --output-dir dist` 生成发布版。GitHub Actions 会随主站发布。源码目录含字体和许可证，照片、生成的 PBN、发布包和 APK 不进仓库。

## 记录和识牌

叫牌、计分、牌例簿、开闭室对分和 PBN 导出都在浏览器执行。记录和选入的照片留在当前浏览器及域名下。开闭室在赛后交换成绩文本。

目前可以对着照片手录牌，或粘贴已有的 PBN Deal。学院站由 [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) 静态托管。[BridgeLens](https://bridgelens.johnfaben.com/about) 的识牌模型在它的服务器上，页面未开放供学院站直接调用的跨域接口。应用内一键识牌需要可用的识牌接口，或经过四手牌实拍验证、可在浏览器运行的模型。
