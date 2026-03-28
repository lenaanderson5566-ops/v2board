# 用户订单预览接口文档

## 接口

- **URL**: `/api/v1/user/order/preview`
- **Method**: `POST`
- **Auth**: 必须（`user` 中间件）

该接口按照 `/api/v1/user/order/save` 的入参进行价格试算，不创建订单、不扣减钱包余额。

## 入参

与 `/api/v1/user/order/save` 保持一致，常见字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `plan_id` | integer | 是 | 套餐 ID；`0` 表示充值订单 |
| `period` | string | 是 | 周期：`month_price`,`quarter_price`,`half_year_price`,`year_price`,`two_year_price`,`three_year_price`,`onetime_price`,`reset_price`,`deposit` |
| `coupon_code` | string | 否 | 优惠券编码 |
| `deposit_amount` | integer | 否 | 当 `plan_id=0` 时的充值金额（分） |

## 出参

返回字段：`plan_id`、`period`、`pricing_currency`、`total_amount`、`discount_amount`、`coupon_discount_amount`、`user_discount_amount`、`surplus_amount`、`balance_amount`。

```json
{
  "data": {
    "plan_id": 1,
    "period": "month_price",
    "pricing_currency": "CNY",
    "total_amount": 1200,
    "discount_amount": 300,
    "coupon_discount_amount": 100,
    "user_discount_amount": 200,
    "surplus_amount": 0,
    "balance_amount": 500
  }
}
```

## 说明

- `total_amount` 为预览后的待支付金额（已扣除折扣与钱包抵扣预估）。
- `balance_amount` 为钱包可抵扣金额预估值。
