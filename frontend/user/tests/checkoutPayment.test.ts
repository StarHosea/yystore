import test from 'node:test'
import assert from 'node:assert/strict'

const selection = {
  orderNo: 'DJ-test-checkout',
  isGuest: true,
  channelId: 3,
  useBalance: false,
  paymentFailed: true,
}

const installStorage = (t: test.TestContext, blocked = false) => {
  const values = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (blocked) throw new Error('storage blocked')
          values.set(key, value)
        },
        removeItem: (key: string) => values.delete(key),
      },
    },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return values
}

const importSelection = (name: string) => import(`../src/utils/checkoutPayment.ts?test=${name}`)

test('a failed checkout hands its selected channel to the matching guest order only once', async (t) => {
  const storage = installStorage(t)
  const payment = await importSelection('guest')
  payment.saveCheckoutPaymentSelection(selection)
  assert.equal(payment.takeCheckoutPaymentSelection('another-order', true), null)
  assert.equal(payment.takeCheckoutPaymentSelection(selection.orderNo, false), null)
  assert.deepEqual(payment.takeCheckoutPaymentSelection(selection.orderNo, true), selection)
  assert.equal(payment.takeCheckoutPaymentSelection(selection.orderNo, true), null)
  assert.equal(storage.size, 0)
})

test('member checkout preserves the balance preference and snapshots the selected channel', async (t) => {
  installStorage(t)
  const payment = await importSelection('member')
  const submitted = { ...selection, isGuest: false, useBalance: true, paymentFailed: false }
  payment.saveCheckoutPaymentSelection(submitted)
  submitted.channelId = 0
  assert.deepEqual(payment.takeCheckoutPaymentSelection(selection.orderNo, false), {
    ...submitted,
    channelId: 3,
  })
})

test('checkout selection survives a page reload via sessionStorage', async (t) => {
  installStorage(t)
  const checkout = await importSelection('before-reload')
  checkout.saveCheckoutPaymentSelection(selection)
  const payment = await importSelection('after-reload')
  assert.deepEqual(payment.takeCheckoutPaymentSelection(selection.orderNo, true), selection)
})

test('checkout selection survives blocked storage during SPA navigation', async (t) => {
  installStorage(t, true)
  const payment = await importSelection('blocked')
  payment.saveCheckoutPaymentSelection(selection)
  assert.deepEqual(payment.takeCheckoutPaymentSelection(selection.orderNo, true), selection)
  assert.equal(payment.takeCheckoutPaymentSelection(selection.orderNo, true), null)
})

test('invalid stored channel IDs cannot be restored and guests never enable balance payments', async (t) => {
  const storage = installStorage(t)
  const payment = await importSelection('invalid')
  for (const channelId of [-1, 0, 1.5, 'invalid', null]) {
    storage.set('checkout_payment_selection', JSON.stringify({ ...selection, channelId, useBalance: true }))
    assert.deepEqual(payment.takeCheckoutPaymentSelection(selection.orderNo, true), {
      ...selection,
      channelId: null,
    })
  }
  storage.set('checkout_payment_selection', '{invalid json')
  assert.equal(payment.takeCheckoutPaymentSelection(selection.orderNo, true), null)
})
