# 品享 Pinxiang · 数字商品商城

独立数字商品商城与商家管理系统。项目专用仓库：**trandainho27-source/Pinxaing**。

这一版有数据库、后端接口和完整测试交易流程。当前交付的是私人演示站；示例商品只用于体验，不代表真实商品或授权，演示不会收款。正式营业前需要配置自己的商品、库存和收款通道。

- [打开商城](https://pinxiang-commerce.classylotus10.chatgpt.site)
- [打开管理后台](https://pinxiang-commerce.classylotus10.chatgpt.site/admin)，点击「进入演示管理后台」
- [不会操作？从这里开始](docs/OPERATIONS.md)
- [部署到自己的 Cloudflare](docs/DEPLOY.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/trandainho27-source/Pinxaing)

## 可以做什么

| 顾客商城 | 管理后台 |
| --- | --- |
| 搜索、分类、排序、库存筛选 | 商品、价格、分类与上下架 |
| 商品详情、适用地区、购买说明 | 主图标选择与地区标识 |
| 购物车与多商品下单 | 加密库存导入、重复内容去重 |
| 保存订单凭证、查询订单 | 订单搜索、详情、分页和 CSV 导出 |
| 付款确认后自动交付、复制或下载 | 确认线下收款、退款登记、支付对账 |
| 售后工单及回复查看 | 工单回复、关闭与重新打开 |
| 演示环境模拟付款与交付 | 经营数据、库存提醒与开店指引 |
| 手机与桌面响应式布局 | 店主 / 运营 / 客服权限、操作日志 |

正式交易采用服务端计算价格、事务锁定库存、支付幂等、防重复交付。卡密采用 AES-GCM 加密；管理员会话使用 HttpOnly Cookie，并对写操作校验来源及 CSRF。订单查询需要订单号和独立密钥。正式模式默认关闭演示入口和测试付款。

## 技术与验证

React + TypeScript + Vinext / Vite；部署运行在 Cloudflare Workers，业务数据保存在 D1。此版本按单店数字商品设计，一个商品对应一个可售规格。

使用 Node.js 24：

```bash
npm run install:ci
npm run typecheck
npm test
npm run build
npm run verify:worker
```

`npm test` 验证交易、加密、权限、付款核验和采购恢复；`verify:worker` 在 Cloudflare workerd 中验证编译后的页面、D1、登录、下单、交付和支付核验。支付网络与货源接口在测试中使用模拟响应，不产生真实资金或采购。

GitHub Actions 会对 main 和 PR 执行同样的检查。具体发布验收记录见 [VALIDATION.md](docs/VALIDATION.md)。

## 首版范围

已提供 TRC20 USDT 收款适配与可选 didipifa 货源适配，但本项目未配置真实收款或货源凭据，也未进行实付与采购验收。微信 / 支付宝、会员钱包、优惠券、分销、实物物流、多商户和自动支付退款不在当前已实现范围。

退款按钮仅登记商家已经退回的款项，不会替商家执行退款。模板与服务也统一以卡密 / 链接 / 预约码交付，不包含文件上传平台或预约日历。

本项目是可运行的第一版工程，尚未经过生产容量压测、灾备恢复演练和独立安全审计；不将这些未完成的事项标为「企业级验收完成」。

## 文件说明

- `app/`：顾客页面、后台与 API 路由。
- `lib/commerce/`：业务逻辑、加密、支付、货源适配。
- `db/`、`drizzle/`：数据库结构及迁移。迁移只建结构，不导入旧商城业务数据。
- `tests/`：自动化业务测试。
- `scripts/`：安装、构建、运行时检查和部署脚本。
- `docs/`：产品范围、操作、部署、收款和验收说明。

当前品牌「品享 Pinxiang」和数字商品方向是首版暂定，可在站点设置及后续迭代中调整；这个仓库不包含旧站的订单、库存、密钥或管理员账号。
