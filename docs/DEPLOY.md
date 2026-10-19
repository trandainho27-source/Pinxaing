# 部署与正式开店

现在的 Sites 地址是店主私人体验站，不是公开营业站。正式站建议部署到你自己的 Cloudflare 账户并绑定域名。仓库提供 Cloudflare Worker 部署方式，不能当普通静态文件直接拖入 Pages。

## 从 GitHub 创建 Cloudflare Worker

项目中文名称为「品香」，仓库选择 `trandainho27-source/Pinxaing`。创建应用时填写：

| 设置 | 值 |
| --- | --- |
| 项目名称 | `pinxiang-commerce`，与仓库中的 Worker 配置一致 |
| 构建命令 | `npm run install:ci && npm run build` |
| 部署命令 | `npm run deploy`，负责创建或复用 D1、应用数据库迁移并发布 |
| 根目录 | `/` |
| 预览构建 | 首次部署先关闭，配置独立预览数据库后再启用 |
| Cloudflare Access 保护 | 公开商城保持关闭；后台使用独立员工登录 |

构建变量添加 `NODE_VERSION=24` 与 `SKIP_DEPENDENCY_INSTALL=1`，均为普通文本。使用项目安装脚本安装锁定的依赖版本。

选择为本项目创建新的构建 API 令牌，确认当前账户下包含 Workers Scripts 编辑与 D1 Storage 编辑权限。令牌的备注名称可使用 `Pinxaing`，不会决定网站显示名称。

构建变量只在打包时可用。发布后，进入 Worker → Settings → Variables and Secrets 配置下文的运行时机密，以及 `RESEND_API_KEY` 与 `EMAIL_FROM=品香 <login@auth.pinxiang.lol>`。在此处保存变更并部署后，才会应用到运行中的网站。

如已经运行过旧版，在后台「站点设置」中将品牌名称更正为「品香」；既有数据库、订单和加密密钥继续沿用。

## Windows 快速部署

1. 安装 Node.js 24（包含 npm）。
2. 在 GitHub 仓库点击 Code → Download ZIP，解压到一个普通文件夹。
3. 双击 `deploy-windows.cmd`。
4. 按弹出的 Cloudflare 登录页面授权，脚本会安装依赖、构建、创建或复用数据库、应用迁移并发布 Worker。
5. 完成后继续配置下方两个密钥，再打开网站 `/admin` 创建店主。

遇到错误时脚本会停住并保留提示，不会声称部署成功。此轮未在真实 Windows 电脑或用户 Cloudflare 账户实测。

也可以点击 README 中的 Deploy to Cloudflare 按钮，按 Cloudflare 的账户向导填写绑定；首次新建站点使用全新数据库。

## 两个必须配置的机密

在 Cloudflare Worker 的 Settings → Variables and Secrets 中添加：

| 名称 | 用途 |
| --- | --- |
| `INVENTORY_KEY` | 恰好 64 位十六进制随机字符串，用于加密赠送账号及保留的历史卡密。导入账号后不能随意更换。 |
| `BOOTSTRAP_TOKEN` | 首次建立店主账号的一次性随机令牌。 |

可分别运行 `node scripts/generate-secret.mjs` 生成两个不同值。请放入密码管理器保管；不要提交到 GitHub。

然后访问 `/admin`，输入初始化令牌，建立账号和至少 12 位密码。成功后删除 Cloudflare 中的 `BOOTSTRAP_TOKEN`。

## 正式模式

`wrangler.json` 默认 `DEMO_MODE=false`；新数据库没有示例商品或默认管理员。先建立实体分类和商品、登记数量库存、导入真实 Telegram 赠送账号，并配置客服用户名。微信、支付宝、USDT 仅预留接口，后续接入和实际验收后才能在线收款，详见 [PAYMENTS.md](PAYMENTS.md)。不要把演示数据库直接改成正式库：演示管理员、测试订单和示例商品需要隔离。

自有 Cloudflare 配置包含每分钟执行的 Cron，用于未付款商品库存过期清理；赠送账号不回收，当前不执行支付巡检。部署后检查触发日志。Sites 私人体验地址不保证采用仓库的 Cron，访问目录、订单和后台也会清理过期库存。

## 命令行部署

```bash
npm run install:ci
npm run build
node scripts/deploy-cloudflare.mjs --login
```

脚本会更新本地 `wrangler.json` 的数据库 ID，请确认对应自己的账户。`.openai/hosting.json` 只用于 Sites 体验站，不能代替 Cloudflare 数据库配置。

## 开发及数据库备份

本地开发使用独立 `.dev.vars`，复制 `.dev.vars.example` 后填写自己的本地值。该文件被 Git 忽略。使用 `npm run dev` 前，依次应用数据库迁移：

```bash
node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config wrangler.json --persist-to .wrangler/state
```

正式升级前，在自己的安全环境中导出数据库：

```bash
node node_modules/wrangler/bin/wrangler.js d1 export DB --remote --config wrangler.json --output backup.sql
```

备份包含客户数据、账号哈希、收货资料和加密赠送账号，不应上传到公开仓库。数据库备份与库存加密密钥要分别安全保管。恢复演练请在独立数据库进行；不要未经核对向正式库导入 SQL。本轮未执行实际账户备份或恢复。

## 从数字商品版本升级

按顺序应用新增的 `0006_early_bedlam.sql`，不要重新执行已经应用的迁移或清空数据库。迁移保留原商品、订单与加密内容，以默认数字类型标记旧数据；新商品与新订单使用实体类型。历史订单仍可凭原密钥查询。演示环境首次加载会额外加入实体示例商品和不可登录的赠送账号，不改写自定义品牌与服务文案。

## 客户邮箱登录与本次迁移

本版追加 `0007_empty_typhoid_mary.sql`，新增客户、验证码、客户会话、合并发货组，以及订单归属、回收站、备注和版本字段。迁移仅改结构，不插入默认账号，不清空旧订单；继续执行项目既有迁移命令。

真实邮箱验证需要 `RESEND_API_KEY`（Secret）与 `EMAIL_FROM`。配置后重新部署，详见 [邮箱服务配置](EMAIL.md)。未配置时公开接口不发验证码、不创建真实客户。演示站仍可用明确标注的测试邮箱体验；正式环境拒绝该身份。

客户登录是商城业务身份，与 Sites 外层私人访问权限、后台员工登录分开。此次更新不会扩大站点受众。
