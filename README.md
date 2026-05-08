# GPT Image 2 Prompt Gallery

一个可部署到 Vercel 的 Next.js 网站，用来展示公共 X 相关来源中提到 `gpt-image-2` / `gpt-image2` 的图片和提示词。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，页面会自动检测本地是否能访问 X，并显示抓取诊断。

## 本地抓取真实 X 数据

X 搜索页现在不会把搜索结果直接放在 HTML 里，未登录/无 Token 时只能拿到网页外壳，拿不到图片和提示词。稳定抓取需要配置 X 官方 API Bearer Token：

```bash
cp .env.example .env.local
```

然后在 `.env.local` 填入：

```bash
X_BEARER_TOKEN=你的_X_API_BEARER_TOKEN
DEFAULT_SEARCH_QUERY="gpt-image2 OR gpt-image-2 OR \"gpt image 2\""
```

重启本地服务后点击页面里的“刷新”。如果 Token 有 Recent Search 权限，接口会返回真实的 X 图片和提示词；如果没有权限，页面会显示 X API 的具体错误状态。

## 部署到 Vercel

建议使用 Node `>= 18.18`（本项目依赖 Next.js 15）。

```bash
npx vercel
npx vercel deploy --prod
```

说明：
- 页面“刷新”只会刷新服务端拉取（`/api/discover` / `/api/refresh-local`），不会自动把结果写入 `public/`。
- 如果你要把“最新原图 + prompt.md + manifest.json”作为静态站内容发布，请先在本地更新 `public/collected/live-gpt-image-2/`，再部署。
- 可用命令：`npm run collect:live-gpt-image-2:x`（同步/去重本地 manifest + prompt.md），以及 `npm run deploy:prod`（仅提交并 push 与站点相关的文件）。

## 自动每小时更新（推荐）

仓库已内置 GitHub Actions 定时任务：`.github/workflows/hourly-x-collector.yml`，每小时会：
1) 调用 X Recent Search API 拉取最近 1 小时的相关推文（需要图片 + prompt 关键字）
2) 下载原图到 `public/collected/live-gpt-image-2/<createdAt>-<tweetId>/original-*.{jpg|png|webp}`
3) 同步 `manifest.json` 与 `prompt.md`
4) 自动提交并 push 到 `main`，触发 Vercel 自动部署

你需要在 GitHub 仓库里配置：
- `Settings → Secrets and variables → Actions → Secrets`：新增 `X_BEARER_TOKEN`
- （可选）`Settings → Secrets and variables → Actions → Variables`：新增 `DEFAULT_SEARCH_QUERY`

注意：每小时 push 一次会触发 Vercel 每小时部署一次；如果你只想更新数据但不频繁重新构建，也可以改为更低频（比如每天一次）或改成 Vercel Cron + Blob 存储方案。

## 环境变量

- `X_BEARER_TOKEN`：可选。配置后优先使用 X 官方 Recent Search API。
- `NITTER_BASE_URL`：可选。未配置 `X_BEARER_TOKEN` 时使用的公开 Nitter 兼容镜像。
- `DEFAULT_SEARCH_QUERY`：可选。默认搜索表达式。

说明：不要把 X Token 或其他密钥放到前端代码里。生产部署建议在 Vercel 项目设置里配置环境变量。
