package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeRepo struct {
	pingErr        error
	tokens         Page
	token          Token
	tokenErr       error
	listErr        error
	calls          int
	chartIntervals []string
}

type fakeETHUSDReader struct {
	price ETHUSDPrice
	err   error
}

func (f fakeETHUSDReader) Read(context.Context) (ETHUSDPrice, error) { return f.price, f.err }

func (f *fakeRepo) Ping(context.Context) error { return f.pingErr }
func (f *fakeRepo) ListTokens(context.Context, int64, int, string) (Page, error) {
	f.calls++
	return f.tokens, f.listErr
}
func (f *fakeRepo) SearchTokens(context.Context, int64, string, int, string) (Page, error) {
	return f.tokens, f.listErr
}
func (f *fakeRepo) TrendingTokens(context.Context, int64, int, string) (Page, error) {
	return Page{Items: []Token{}}, nil
}
func (f *fakeRepo) Token(context.Context, int64, string) (Token, error) { return f.token, f.tokenErr }
func (f *fakeRepo) CreatorTokens(context.Context, int64, string, int, string) (Page, error) {
	return Page{Items: []Token{}}, nil
}
func (f *fakeRepo) Creator(context.Context, int64, string, int, string) (CreatorProfile, error) {
	return CreatorProfile{Tokens: []Token{}}, nil
}
func (f *fakeRepo) Trades(context.Context, int64, string, int, string) (TradePage, error) {
	return TradePage{Items: []Trade{}}, nil
}
func (f *fakeRepo) Activity(context.Context, int64, string, int, string) (ActivityPage, error) {
	return ActivityPage{Items: []Activity{}}, nil
}
func (f *fakeRepo) Chart(_ context.Context, _ int64, _ string, interval string, _ int) (ChartPage, error) {
	f.chartIntervals = append(f.chartIntervals, interval)
	return ChartPage{Interval: interval, SupportedIntervals: append([]string(nil), supportedChartIntervals...), Candles: []ChartPoint{}}, nil
}
func (f *fakeRepo) SaveMetadataDraft(context.Context, MetadataDraft) error                { return nil }
func (f *fakeRepo) FinalizeMetadata(context.Context, int64, string, string, string) error { return nil }
func testHandler(repo Repository) http.Handler {
	return NewHandler(repo, 84532, time.Second, slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func TestETHUSDPriceEndpoint(t *testing.T) {
	repo := &fakeRepo{}
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	price := ETHUSDPrice{Price: "2500.12345678", PriceDecimals: 8, UpdatedAt: time.Unix(2_000_000_000, 0).UTC(), Feed: BaseSepoliaETHUSDFeed, Source: "chainlink_base_sepolia", MaxAgeSeconds: 3600}
	handler := NewHandlerWithDependencies(repo, 84532, time.Second, logger, nil, fakeETHUSDReader{price: price})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/prices/eth-usd", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"price":"2500.12345678"`) || !strings.Contains(w.Body.String(), `"source":"chainlink_base_sepolia"`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d headers=%v body=%s", w.Code, w.Header(), w.Body.String())
	}

	handler = NewHandlerWithDependencies(repo, 84532, time.Second, logger, nil, fakeETHUSDReader{err: errors.New("RPC secret")})
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/prices/eth-usd", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), `"code":"oracle_unavailable"`) || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestHealthAndReadiness(t *testing.T) {
	r := testHandler(&fakeRepo{pingErr: errors.New("database down")})
	for _, tc := range []struct {
		path   string
		status int
	}{{"/health", 200}, {"/readyz", 503}} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s status=%d", tc.path, w.Code)
		}
	}
}
func TestRequestIDValidationAndErrors(t *testing.T) {
	r := testHandler(&fakeRepo{})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x123", nil)
	req.Header.Set("X-Request-ID", "req-test")
	r.ServeHTTP(w, req)
	if w.Code != 400 || w.Header().Get("X-Request-ID") != "req-test" {
		t.Fatalf("status=%d request_id=%q", w.Code, w.Header().Get("X-Request-ID"))
	}
	if !strings.Contains(w.Body.String(), `"code":"invalid_address"`) {
		t.Fatalf("body=%s", w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?limit=101", nil))
	if w.Code != 400 {
		t.Fatalf("limit status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?cursor=bad", nil))
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"code":"invalid_request"`) {
		t.Fatalf("cursor status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r = testHandler(&fakeRepo{listErr: errors.New("secret database detail")})
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens", nil))
	if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"internal_error"`) || strings.Contains(w.Body.String(), "secret") {
		t.Fatalf("internal status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestTokenListEmptyAndDetailNotFound(t *testing.T) {
	r := testHandler(&fakeRepo{tokens: Page{Items: []Token{}}})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?limit=2", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r = testHandler(&fakeRepo{tokenErr: ErrNotFound})
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/0x0000000000000000000000000000000000000001", nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), `"code":"not_found"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
func TestTokenSearchAndV3PricingResponse(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	price, fdv := "7", "7000"
	r := testHandler(&fakeRepo{tokens: Page{Items: []Token{}}, token: Token{Address: address, Metrics: Metrics{CurrentPrice: &price, FullyDilutedValue: &fdv}}})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?search=Zonk", nil))
	if w.Code != 200 {
		t.Fatalf("search status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens?search=%3Cscript%3E", nil))
	if w.Code != 400 {
		t.Fatalf("unsafe search status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/pricing", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"fully_diluted_value":"7000"`) || strings.Contains(w.Body.String(), "market_cap") || strings.Contains(w.Body.String(), "reserve_balance") {
		t.Fatalf("pricing=%s", w.Body.String())
	}
}

func TestChartSupportsEveryCanonicalIntervalAndRejectsInvalidInterval(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	repo := &fakeRepo{}
	r := testHandler(repo)
	for _, interval := range supportedChartIntervals {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/chart?interval="+interval, nil))
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"interval":"`+interval+`"`) || !strings.Contains(w.Body.String(), `"candles":[]`) {
			t.Fatalf("interval=%s status=%d body=%s", interval, w.Code, w.Body.String())
		}
	}
	if len(repo.chartIntervals) != len(supportedChartIntervals) {
		t.Fatalf("chart calls=%v", repo.chartIntervals)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address+"/chart?interval=2h", nil))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"code":"invalid_interval"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestOptionalPublicURLValidation(t *testing.T) {
	for _, tc := range []struct {
		value string
		hosts []string
		ok    bool
	}{
		{"", nil, true},
		{"https://zonk.fun/about", nil, true},
		{"https://x.com/zonk", []string{"x.com", "twitter.com"}, true},
		{"https://example.com/zonk", []string{"x.com", "twitter.com"}, false},
		{"javascript:alert(1)", nil, false},
		{"https://user:pass@x.com/zonk", []string{"x.com"}, false},
	} {
		_, err := optionalPublicURL(tc.value, tc.hosts)
		if (err == nil) != tc.ok {
			t.Fatalf("value=%q err=%v", tc.value, err)
		}
	}
}

func TestTokenDetailReturnsIndexedTokenAndSafeRepositoryError(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	indexed := Token{Address: address, Creator: "0x0000000000000000000000000000000000000002", Name: "Zonk", Symbol: "ZK", InitialSupply: "1000", Description: "Indexed metadata", Metrics: Metrics{Volume: "0", Fees: "0"}}
	r := testHandler(&fakeRepo{token: indexed})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"description":"Indexed metadata"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	r = testHandler(&fakeRepo{tokenErr: errors.New("private database failure")})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), `"code":"internal_error"`) || strings.Contains(w.Body.String(), "private") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestTokenDetailOmitsAbsentGraduationSettlementValues(t *testing.T) {
	address := "0x0000000000000000000000000000000000000001"
	indexed := Token{Address: address, Creator: "0x0000000000000000000000000000000000000002", Name: "Zonk", Symbol: "ZK", InitialSupply: "1000", Metrics: Metrics{Volume: "0", Fees: "0"}, Graduation: &Graduation{Phase: "graduated", TokenAmount: "200", ETHAmount: "3", SoldSupply: "800"}}
	r := testHandler(&fakeRepo{token: indexed})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/tokens/"+address, nil))
	body := w.Body.String()
	if w.Code != http.StatusOK || !strings.Contains(body, `"phase":"graduated"`) || strings.Contains(body, `"liquidity":"0"`) || strings.Contains(body, `"position_token_id":"0"`) || strings.Contains(body, `"liquidity_amount":"0"`) || strings.Contains(body, `"lock_id":"0"`) {
		t.Fatalf("status=%d body=%s", w.Code, body)
	}
}
