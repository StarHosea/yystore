import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App, type Component } from 'vue'
import PaymentChannelModal from './PaymentChannelModal.vue'
import { adminAPI } from '@/api/admin'

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/api/admin', () => ({
  adminAPI: {
    getMemberLevels: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getPaymentChannel: vi.fn(),
    updatePaymentChannel: vi.fn().mockResolvedValue({}),
  },
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  vi.clearAllMocks()
})

const loadChannel = async (mode: string, orderMode = 'transaction') => {
  vi.mocked(adminAPI.getPaymentChannel).mockResolvedValue({ data: { data: {
    name: 'GMPay', provider_type: 'epusdt', channel_type: 'epusdt', interaction_mode: mode,
    config_json: { order_mode: orderMode, token: 'usdt', network: 'bsc', currency: 'cny' },
  } } } as Awaited<ReturnType<typeof adminAPI.getPaymentChannel>>)
  const props = reactive({ modelValue: false, channelId: null as number | null })
  // Exercise the real form loading, watchers and save handler without dialog rendering.
  const component = { ...PaymentChannelModal, render: () => null } as unknown as Component
  app = createApp({ render: () => h(component, props) })
  const vm = app.mount(document.createElement('div'))
  const state = (vm.$.subTree.component as unknown as { setupState: unknown }).setupState as {
    form: { interaction_mode: string }
    epusdtConfig: { order_mode: string }
    handleSubmit: () => Promise<void>
  }
  props.channelId = 3
  await nextTick()
  await nextTick()
  await nextTick()
  return state
}

describe('GMPay payment channel form', () => {
  it('preserves an existing QR channel when editing and saving', async () => {
    const state = await loadChannel('qr')
    await state.handleSubmit()
    expect(adminAPI.updatePaymentChannel).toHaveBeenCalledWith(3, expect.objectContaining({
      interaction_mode: 'qr', config_json: expect.objectContaining({ token: 'usdt', network: 'bsc' }),
    }))
  })

  it('allows switching a transaction channel from redirect to QR', async () => {
    const state = await loadChannel('redirect')
    state.form.interaction_mode = 'qr'
    await nextTick()
    await state.handleSubmit()
    expect(adminAPI.updatePaymentChannel).toHaveBeenCalledWith(3, expect.objectContaining({ interaction_mode: 'qr' }))
  })

  it('switches QR to redirect when using the hosted cashier', async () => {
    const state = await loadChannel('qr')
    state.epusdtConfig.order_mode = 'cashier'
    await nextTick()
    await state.handleSubmit()
    expect(adminAPI.updatePaymentChannel).toHaveBeenCalledWith(3, expect.objectContaining({
      interaction_mode: 'redirect', config_json: expect.objectContaining({ order_mode: 'cashier' }),
    }))
    const payload = vi.mocked(adminAPI.updatePaymentChannel).mock.calls[0]![1]!
    expect(payload.config_json).toHaveProperty('token', '')
    expect(payload.config_json).toHaveProperty('network', '')
  })
})
