export interface CheckoutPaymentSelection {
  orderNo: string
  isGuest: boolean
  channelId: number | null
  useBalance: boolean
  paymentFailed: boolean
}

const STORAGE_KEY = 'checkout_payment_selection'
let pendingSelection: CheckoutPaymentSelection | null = null

// 仅承接结算页的支付偏好；支付结果仍由经过鉴权的 latest 接口恢复。
export const saveCheckoutPaymentSelection = (selection: CheckoutPaymentSelection) => {
  pendingSelection = { ...selection }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // 禁用浏览器存储时，SPA 跳转仍可使用内存中的偏好。
  }
}

export const takeCheckoutPaymentSelection = (orderNo: string, isGuest: boolean): CheckoutPaymentSelection | null => {
  let selection = pendingSelection
  if (!selection) {
    try {
      selection = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null')
    } catch {
      return null
    }
  }
  if (!selection || selection.orderNo !== orderNo || selection.isGuest !== isGuest) return null

  pendingSelection = null
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 存储不可用时只清除内存状态。
  }
  const channelId = Number(selection.channelId)
  return {
    orderNo,
    isGuest,
    channelId: Number.isSafeInteger(channelId) && channelId > 0 ? channelId : null,
    useBalance: !isGuest && selection.useBalance === true,
    paymentFailed: selection.paymentFailed === true,
  }
}
