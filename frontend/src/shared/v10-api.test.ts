import { describe, expect, it } from 'vitest';
import { v10Request } from './v10-api';
import { subscriptionUrl } from './import-links';

describe('V10 wire contracts', () => {
  it('decodes payment classification without confusing assets with settlement currency', () => {
    const result = v10Request('user/order/getPaymentMethod').decode({data:[{id:3,category:'crypto',asset:'USDT',network:'tron',networkName:'TRON (TRC20)',networkIconUrl:'/payment-icons/crypto-trx.svg',assetIconUrl:'/payment-icons/crypto-usdt.svg',currency:'CNY',fixedFee:100}]});
    expect(result.data[0]).toMatchObject({id:3,category:'crypto',asset:'USDT',network:'tron',network_name:'TRON (TRC20)',network_icon:'/payment-icons/crypto-trx.svg',currency:'CNY',handling_fee_fixed:100});
  });
  it('uses resource methods and declared public fields', () => {
    const request = v10Request('user/order/save', {plan_id: 3, period: 'year_price', replace_trade_no: 'old', user_id: 999});
    expect(request.url).toBe('/api/v10/me/orders');
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body!)).toEqual({planId: 3, billingPeriod: 'annual', replacementOrderNumber: 'old'});
    expect(v10Request('user/update', {remind_expire: true}).method).toBe('PATCH');
    expect(v10Request('user/removeActiveSession', {session_id:'abc'}).url).toBe('/api/v10/me/sessions/abc');
    expect(v10Request('user/logout').method).toBe('DELETE');
    expect(v10Request('user/usage/reset').url).toBe('/api/v10/me/usage-resets');
    expect(v10Request('user/usage/reset', {request_key:'key'}).url).toBe('/api/v10/me/usage-resets/consumptions');
  });
  it('routes detail reads without using legacy query identifiers', () => {
    expect(v10Request('user/ticket/fetch?id=7').url).toBe('/api/v10/me/tickets/7');
    expect(v10Request('user/plan/fetch?id=3').url).toBe('/api/v10/plans/3');
    const request = v10Request('user/order/fetch?current=2&page_size=10&status=0');
    expect(request.url).toBe('/api/v10/me/orders?status=unpaid&page=2&pageSize=10');
    expect(request.body).toBeUndefined();
  });
  it('decodes declared resource fields, UTC dates and pagination', () => {
    const result = v10Request('user/order/fetch').decode({data:[{orderNumber:'o1',billingPeriod:'annual',status:'completed',createdAt:'2026-10-04T00:00:00Z',internalSecret:'never'}],meta:{pagination:{page:1,pageSize:20,total:21,totalPages:2}}});
    expect(result.data[0]).toEqual({trade_no:'o1',period:'year_price',status:3,created_at:1791072000});
    expect(result.total).toBe(21);
    expect(v10Request('user/plan/fetch').decode({data:[{quotaBytes:53687091200,monthlyPrice:1000}]}).data[0]).toEqual({transfer_enable:50,month_price:1000});
  });
  it('requires an explicit contract instead of silently sending old user APIs', () => {
    expect(() => v10Request('user/unknown')).toThrow('no V10 contract');
    expect(() => v10Request('user/order/detail')).toThrow('Missing resource identifier');
  });
  it('uses format for V10 and preserves configured legacy subscription links', () => {
    expect(subscriptionUrl('https://example.com/api/v10/subscriptions/credential','sing')).toBe('https://example.com/api/v10/subscriptions/credential?format=sing-box');
    expect(subscriptionUrl('https://example.com/custom?token=credential','sing')).toBe('https://example.com/custom?token=credential&flag=sing');
  });
});

it.each([
  ['user/order/save',{plan_id:0,period:'deposit',deposit_amount:500},{planId:0,billingPeriod:'deposit',depositAmount:500}],
  ['user/order/save',{plan_id:2,period:'onetime_price'},{planId:2,billingPeriod:'credits'}],
  ['user/ticket/save',{subject:'Help',level:0,message:'Details'},{subject:'Help',priority:'normal',message:'Details'}],
  ['user/ticket/withdraw',{withdraw_method:'bank',withdraw_account:'account'},{withdrawalMethod:'bank',withdrawalAccount:'account'}],
  ['user/invite/email/send',{email:'user@example.com'},{email:'user@example.com'}],
  ['user/changePassword',{old_password:'old',new_password:'new-password'},{oldPassword:'old',newPassword:'new-password'}],
  ['user/order/checkout',{trade_no:'order',method:0},{paymentMethodId:0}],
] as const)('preserves required fields for %s', (path, body, expected) => {
  expect(JSON.parse(v10Request(path,body).body!)).toEqual(expected);
});
