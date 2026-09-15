/**
 * Cashfree ids larger than a JavaScript number.
 *
 * The sandbox end-to-end run on 15 September 2026 received cf_payment_id as the
 * JSON number 1453353814355098112; JSON.parse turns that into
 * 1453353814355098000, and one payment was recorded as two attempts. These
 * tests pin lib/cashfree.js parseCashfreeJson across every shape a Cashfree
 * payload can take, not just the one field that surfaced.
 *
 * Samples are embedded (shapes from Cashfree's documented webhook and REST
 * payloads) so the test does not depend on local documentation files.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseCashfreeJson, cashfreeResponseParser, CASHFREE_ID_KEY } = require('../src/lib/cashfree.js');

const BIG = '1453353814355098112'; // > 2^53
const HUGE_UTR = '16448223177812129999'; // 20 digits

describe('JSON.parse really does lose these digits', () => {
  it('rounds an integer beyond 2^53', () => {
    expect(String(JSON.parse(`{"id":${BIG}}`).id)).toBe('1453353814355098000');
  });
});

describe('parseCashfreeJson — payment webhook', () => {
  const webhook = `{
    "data": {
      "order": { "order_id": "sfy_1", "order_amount": 499.00, "order_currency": "INR", "order_tags": null },
      "payment": {
        "cf_payment_id": ${BIG},
        "payment_status": "SUCCESS",
        "payment_amount": 499,
        "payment_currency": "INR",
        "payment_message": "Transaction successful: ref 1234567890123456789, {ok}: \\"quoted\\"",
        "payment_time": "2026-09-15T17:19:30+05:30",
        "bank_reference": 234928698581,
        "auth_id": null,
        "payment_method": { "card": { "channel": null, "card_number": 4111111111111111, "card_network": "visa", "card_type": "credit_card", "card_country": "IN", "card_bank_name": "TEST Bank" } },
        "payment_group": "credit_card"
      },
      "customer_details": { "customer_name": null, "customer_id": "7112AAA812234", "customer_email": "x@y.test", "customer_phone": "9999999999" },
      "payment_gateway_details": { "gateway_name": "CASHFREE", "gateway_order_id": 1634766330, "gateway_payment_id": ${BIG}, "gateway_status_code": null, "gateway_settlement": "CASHFREE" },
      "payment_offers": [{ "offer_id": "0f05e1d0", "offer_type": "DISCOUNT", "offer_meta": { "offer_title": "50% off", "offer_description": "50% off" }, "offer_redemption": { "redemption_status": "SUCCESS", "discount_amount": 1, "cashback_amount": 0 } }]
    },
    "event_time": "2026-09-15T17:19:32+05:30",
    "type": "PAYMENT_SUCCESS_WEBHOOK"
  }`;

  it('keeps every id exact and as a string', () => {
    const p = parseCashfreeJson(webhook).data;
    expect(p.payment.cf_payment_id).toBe(BIG);
    expect(p.payment_gateway_details.gateway_payment_id).toBe(BIG);
    expect(p.payment_gateway_details.gateway_order_id, 'id-like key: a string even when small').toBe('1634766330');
    expect(p.payment.bank_reference).toBe('234928698581');
    expect(p.payment.payment_method.card.card_number).toBe('4111111111111111');
  });

  it('leaves amounts, nulls, and every string value untouched', () => {
    const p = parseCashfreeJson(webhook).data;
    expect(p.order.order_amount).toBe(499);
    expect(p.payment.payment_amount).toBe(499);
    expect(p.payment_offers[0].offer_redemption.discount_amount).toBe(1);
    expect(p.payment.auth_id).toBeNull();
    expect(p.payment.payment_message).toBe('Transaction successful: ref 1234567890123456789, {ok}: "quoted"');
    expect(p.customer_details.customer_phone).toBe('9999999999');
  });

  it('matches JSON.parse exactly for everything except the rewritten numbers', () => {
    const ours = parseCashfreeJson(webhook);
    const plain = JSON.parse(webhook);
    plain.data.payment.cf_payment_id = BIG;
    plain.data.payment.bank_reference = '234928698581';
    plain.data.payment.payment_method.card.card_number = '4111111111111111';
    plain.data.payment_gateway_details.gateway_order_id = '1634766330';
    plain.data.payment_gateway_details.gateway_payment_id = BIG;
    expect(ours).toEqual(plain);
  });
});

describe('parseCashfreeJson — refund webhook and REST refund', () => {
  it('REFUND_STATUS_WEBHOOK sends cf_refund_id and cf_payment_id as numbers: both exact strings', () => {
    const r = parseCashfreeJson(`{"data":{"refund":{"cf_refund_id":${BIG},"cf_payment_id":789727431,"refund_id":"rf_1","order_id":"sfy_1","refund_amount":2.00,"refund_arn":205907014017,"refund_status":"SUCCESS","service_charge":0.00,"refund_splits":[{"merchantVendorId":"v1","amount":1,"percentage":null}]}},"type":"REFUND_STATUS_WEBHOOK"}`).data.refund;
    expect(r.cf_refund_id).toBe(BIG);
    expect(r.cf_payment_id).toBe('789727431');
    expect(r.refund_arn).toBe('205907014017');
    expect(r.refund_amount).toBe(2);
    expect(r.refund_splits[0].amount).toBe(1);
  });

  it('the REST shape (ids already strings) parses identically to JSON.parse', () => {
    const rest = `{"cf_payment_id":"${BIG}","cf_refund_id":"1319869432","refund_amount":499,"refund_speed":{"requested":"STANDARD","processed":null},"forex_conversion_rate":0}`;
    expect(parseCashfreeJson(rest)).toEqual(JSON.parse(rest));
  });
});

describe('parseCashfreeJson — settlements and other numeric fields', () => {
  it('settlement ids and UTRs, including one beyond 2^53, stay exact', () => {
    const s = parseCashfreeJson(`{"data":{"settlement":{"cf_settlement_id":${BIG},"settlement_id":738,"utr":${HUGE_UTR},"settlement_amount":97.94,"adjustment":0,"service_tax":0.06}},"type":"SETTLEMENT_SUCCESS"}`).data.settlement;
    expect([s.cf_settlement_id, s.settlement_id, s.utr]).toEqual([BIG, '738', HUGE_UTR]);
    expect([s.settlement_amount, s.adjustment, s.service_tax]).toEqual([97.94, 0, 0.06]);
  });

  it('an unsafe integer under a NON-id key, or inside an array, is still kept exact', () => {
    const p = parseCashfreeJson(`{"count":${BIG},"list":[1,${BIG},-${BIG}],"nested":{"deep":[{"n":${BIG}}]},"small":42,"exp":1e21,"dec":12345678901234567.5}`);
    expect(p.count).toBe(BIG);
    expect(p.list).toEqual([1, BIG, `-${BIG}`]);
    expect(p.nested.deep[0].n).toBe(BIG);
    expect(p.small, 'safe, not id-like: stays a number').toBe(42);
    expect(p.exp).toBe(1e21);
    expect(p.dec).toBe(12345678901234567.5);
  });

  it('non-id keys that look numeric (status codes, limits, percentages) stay numbers', () => {
    expect(parseCashfreeJson('{"status":400,"limit":1000,"percentage":85,"upi_expiry_minutes":10,"emi_tenure":3}')).toEqual({
      status: 400,
      limit: 1000,
      percentage: 85,
      upi_expiry_minutes: 10,
      emi_tenure: 3,
    });
  });

  it('keys inside string values are never mistaken for keys', () => {
    const p = parseCashfreeJson(`{"note":"cf_payment_id: ${BIG}","cf_payment_id":5}`);
    expect(p).toEqual({ note: `cf_payment_id: ${BIG}`, cf_payment_id: '5' });
  });

  it('the id-key pattern covers every id-like field Cashfree documents, and no quantities', () => {
    for (const key of ['cf_payment_id', 'cf_order_id', 'cf_refund_id', 'cf_settlement_id', 'cf_link_id', 'cf_dispute_id', 'settlement_id', 'transaction_id', 'gateway_order_id', 'gateway_payment_id', 'document_id', 'utr', 'settlement_utr', 'refund_arn', 'bank_reference', 'card_number', 'account_number']) {
      expect(CASHFREE_ID_KEY.test(key), key).toBe(true);
    }
    for (const key of ['order_amount', 'payment_amount', 'refund_amount', 'service_charge', 'status', 'limit', 'percentage', 'uidai', 'version']) {
      expect(CASHFREE_ID_KEY.test(key), key).toBe(false);
    }
  });

  it('invalid JSON still throws, and the axios parser returns it unparsed', () => {
    expect(() => parseCashfreeJson('{"a":')).toThrow();
    expect(cashfreeResponseParser('not json')).toBe('not json');
    expect(cashfreeResponseParser('')).toBe('');
  });
});
