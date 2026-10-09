# Payment icon sources

Assets are vendored locally; no third-party image requests are needed at runtime.
Existing `/payment-icons/{id}.svg` URLs remain compatible. Admin previews import
these exact files. Brand artwork is rendered with its original viewBox and aspect
ratio; Stripe, Tether and Bitcoin receive their brand fill colors.

| Icons | Source and pinned revision | License |
| --- | --- | --- |
| Alipay, UnionPay, generic card, PayPal, Visa, Mastercard | [aaronfagan/svg-credit-card-payment-icons](https://github.com/aaronfagan/svg-credit-card-payment-icons/tree/6dd023ae32415ed7b01bf809f15a25613a52098c), `flat-rounded/` | Apache 2.0; see LICENSE-credit-card-icons.txt |
| WeChat Pay, Apple Pay, Google Pay | [datatrans/payment-logos](https://github.com/datatrans/payment-logos/tree/b4175c79813792f1e2ab16c10cfd9f15d5af0e77), `assets/apm/` and `assets/wallets/` | CC BY-SA 4.0; see LICENSE-payment-logos.txt |
| Stripe, Tether (USDT), Bitcoin | [Simple Icons](https://github.com/simple-icons/simple-icons/tree/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d), `icons/` | CC0; see LICENSE-simple-icons.txt |

Brand names and logos remain the property of their respective owners.

`wechat-pay.svg` adapts the WeChat Pay symbol from the existing pinned
datatrans/payment-logos artwork above (CC BY-SA 4.0): omits the wordmark,
centers the unchanged symbol in a 64×64 rounded tile, and adds a pale background.
`card-outline.svg` is original project artwork: a generic card outline in a
matching rounded tile. These are inspired by the supplied dashboard layout,
not assets extracted from or distributed by Stripe.

Crypto coin/network icons: [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons/tree/1a63530be6e374711a8554f31b17e4cb92c25fa5), revision `1a63530be6e374711a8554f31b17e4cb92c25fa5`, `svg/color`; CC0-1.0 (LICENSE-cryptocurrency-icons.md).
