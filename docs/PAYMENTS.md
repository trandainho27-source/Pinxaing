# 支付接入现状

当前独立演示站没有接通真实收款。支持 TRON 主网 TRC20 USDT 的服务端核验适配；只有正式环境且配置完整时才展示真实收银台。不会索要钱包私钥或助记词。

## 配置项

| Cloudflare 变量 | 设置 |
| --- | --- |
| `DEMO_MODE` | `false` |
| `PAYMENT_PROVIDER` | `trc20` |
| `TRON_RECEIVING_ADDRESS` | 商家自己的有效 TRON 地址 |
| `USDT_CNY_RATE` | 商家确定的人民币报价汇率 |
| `TRONGRID_API_KEY` | TronGrid 查询 API 密钥，作为 Secret |
| `INVENTORY_KEY` | 已配置的库存加密 Secret |

配置后后台「支付接口」显示就绪状态。生成支付单后锁定汇率，并使用最多 0.009999 USDT 的识别尾差区分订单。页面明确显示完整金额；客户需要一次性准确转账。转账手续费另计。

付款确认只接受官方 USDT 合约、正确收款地址、完整金额、成功且已确认的交易；同一交易不能重复交付。金额不匹配或超时到账进入人工核对，不自动恢复已过期订单。付款页可提交交易哈希补查；钱包密码和私钥不需要提供。

必须完成自己账户的小额实际交易验收，包括正常到账、重复核验、超时和异常处理。本轮仅运行模拟链上响应测试，未验证实际收款地址、API 配额或真实到账。

## 其他支付方式

代码还保留自定义 HMAC 支付通知接口，用于未来的网关对接；它不是已接通的微信 / 支付宝收银台。微信、支付宝或银行卡要根据实际商户账户另行接入和验收。

接口 `/api/payments/webhook` 使用 `x-payment-timestamp`（秒级时间戳）和 `x-payment-signature`（HMAC-SHA256）。签名内容为 `timestamp + '.' + 原始JSON`，Secret 为 `PAYMENT_WEBHOOK_SECRET`，通道为 `PAYMENT_PROVIDER=custom-hmac`。JSON 包含 `orderId`、`transactionId`、`amount`（人民币分）、`currency=CNY`、`status=paid`。服务端校验 5 分钟时间窗口、订单金额与交易唯一性。此适配尚无对应顾客收银台。

后台退款只记录已退款的结果，不发送资金。
