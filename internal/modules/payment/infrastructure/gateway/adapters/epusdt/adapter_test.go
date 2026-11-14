package epusdtadapter

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	paymentcontract "github.com/dujiao-next/internal/modules/payment/contract"

	"github.com/dujiao-next/internal/constants"
	"github.com/dujiao-next/internal/modules/payment/infrastructure/gateway/epusdt"
	"github.com/dujiao-next/internal/shared/jsonmap"
	"github.com/dujiao-next/internal/shared/money"
	"github.com/shopspring/decimal"
)

func TestEpusdtAdapter_Type(t *testing.T) {
	a := NewEpusdtAdapter()
	want := constants.PaymentProviderEpusdt + ":"
	if got := a.Type(); got != want {
		t.Fatalf("Type() = %q, want %q", got, want)
	}
}

func TestEpusdtAdapter_ValidateConfig_EmptyRejected(t *testing.T) {
	a := NewEpusdtAdapter()
	err := a.ValidateConfig(jsonmap.JSON{}, "")
	if err == nil {
		t.Fatalf("expected error from empty config")
	}
	if !errors.Is(err, paymentcontract.ErrGatewayConfigInvalid) {
		t.Fatalf("expected wrapped paymentcontract.ErrGatewayConfigInvalid, got %v", err)
	}
}

func TestEpusdtAdapter_CreatePayment_ConfigInvalidMapped(t *testing.T) {
	a := NewEpusdtAdapter()
	_, err := a.CreatePayment(context.Background(), jsonmap.JSON{}, paymentcontract.GatewayCreateInput{
		OrderNo:  "ORDER_1",
		Currency: "USDT",
	})
	if err == nil {
		t.Fatalf("expected error from empty config")
	}
	if !errors.Is(err, paymentcontract.ErrGatewayConfigInvalid) {
		t.Fatalf("expected wrapped paymentcontract.ErrGatewayConfigInvalid, got %v", err)
	}
}

func TestEpusdtAdapter_InlinePayment(t *testing.T) {
	tests := []struct {
		name, mode, orderMode, address, amount, token, network string
		invalid, inline                                        bool
	}{
		{name: "wallet QR", mode: "qr", address: "TWallet", amount: "1.000123", token: "USDT", network: "tron", inline: true},
		{name: "missing address", mode: "qr", amount: "1", token: "USDT", network: "tron", invalid: true},
		{name: "invalid amount", mode: "qr", address: "TWallet", amount: "NaN", token: "USDT", network: "tron", invalid: true},
		{name: "zero amount", mode: "qr", address: "TWallet", amount: "0", token: "USDT", network: "tron", invalid: true},
		{name: "wrong asset", mode: "qr", address: "TWallet", amount: "1", token: "USDC", network: "tron", invalid: true},
		{name: "wrong network", mode: "qr", address: "TWallet", amount: "1", token: "USDT", network: "bsc", invalid: true},
		{name: "hosted redirect", mode: "redirect"},
		{name: "cashier QR", mode: "qr", orderMode: "cashier"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var params map[string]interface{}
				if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
					t.Error(err)
				}
				inline := tc.mode == "qr" && tc.orderMode != "cashier"
				if _, hasReturn := params["redirect_url"]; hasReturn == inline {
					t.Errorf("redirect_url presence = %v for inline=%v", hasReturn, inline)
				}
				if params["notify_url"] != "https://shop.example.com/api/v1/payments/callback" || params["signature"] != epusdt.Sign(params, "test-secret") {
					t.Error("signed callback configuration not preserved")
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"status_code": 200,
					"data":        map[string]interface{}{"trade_id": "TRADE-1", "receive_address": tc.address, "actual_amount": tc.amount, "token": tc.token, "network": tc.network},
				})
			}))
			defer srv.Close()
			result, err := NewEpusdtAdapter().CreatePayment(context.Background(), jsonmap.JSON{
				"gateway_url": srv.URL, "pid": "1001", "secret_key": "test-secret", "order_mode": tc.orderMode,
				"token": "usdt", "network": "tron", "currency": "cny",
				"notify_url": "https://shop.example.com/api/v1/payments/callback", "return_url": "https://shop.example.com/pay",
			}, paymentcontract.GatewayCreateInput{
				OrderNo: "DJP-1", Currency: "CNY", Amount: money.FromDecimal(decimal.RequireFromString("6.78")),
				Extra: jsonmap.JSON{"interaction_mode": tc.mode}, ReturnURLQuery: map[string]string{"guest": "1", "order_no": "ORDER-1"},
			})
			if tc.invalid {
				if !errors.Is(err, paymentcontract.ErrGatewayResponseInvalid) {
					t.Fatalf("error = %v, want invalid gateway response", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tc.inline {
				if result.RedirectURL != "" || result.QRCodeURL != tc.address || result.ProviderRef != "TRADE-1" {
					t.Fatalf("expected wallet QR without external link: %+v", result)
				}
			} else if result.RedirectURL == "" || result.QRCodeURL != result.RedirectURL {
				t.Fatalf("hosted cashier result lost: %+v", result)
			}
		})
	}
}

func TestEpusdtDisplayChannelType(t *testing.T) {
	tests := []struct {
		name string
		cfg  *epusdt.Config
		want string
	}{
		{name: "nil", cfg: nil, want: ""},
		{
			name: "cashier",
			cfg:  &epusdt.Config{OrderMode: constants.PaymentEpusdtOrderModeCashier},
			want: "",
		},
		{
			name: "tron usdt",
			cfg:  &epusdt.Config{Token: " USDT ", Network: " TRON "},
			want: "usdt.tron",
		},
		{
			name: "tron trx",
			cfg:  &epusdt.Config{Token: " trx ", Network: " tron "},
			want: "trx.tron",
		},
		{
			name: "fallback payment type",
			cfg:  &epusdt.Config{Token: "usdc", Network: "ethereum", PaymentType: "ethereum-usdc"},
			want: "usdc.ethereum",
		},
		{
			name: "unknown without payment type",
			cfg:  &epusdt.Config{Token: "usdc", Network: "ethereum"},
			want: "usdc.ethereum",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := epusdtDisplayChannelType(tc.cfg); got != tc.want {
				t.Fatalf("epusdtDisplayChannelType() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestEpusdtAdapter_MapEpusdtError(t *testing.T) {
	cases := []struct {
		name string
		in   error
		want error
	}{
		{"config", epusdt.ErrConfigInvalid, paymentcontract.ErrGatewayConfigInvalid},
		{"request", epusdt.ErrRequestFailed, paymentcontract.ErrGatewayRequestFailed},
		{"response", epusdt.ErrResponseInvalid, paymentcontract.ErrGatewayResponseInvalid},
		{"signature", epusdt.ErrSignatureInvalid, paymentcontract.ErrGatewaySignatureInvalid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapEpusdtError(tc.in)
			if !errors.Is(got, tc.want) {
				t.Fatalf("mapEpusdtError(%v) errors.Is %v = false, want true", tc.in, tc.want)
			}
		})
	}
}
