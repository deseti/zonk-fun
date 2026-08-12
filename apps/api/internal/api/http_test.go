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
	pingErr  error
	tokens   Page
	token    Token
	tokenErr error
	listErr  error
	calls    int
}

func (f *fakeRepo) Ping(context.Context) error { return f.pingErr }
func (f *fakeRepo) ListTokens(context.Context, int64, int, string) (Page, error) {
	f.calls++
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
func (f *fakeRepo) SaveMetadataDraft(context.Context, MetadataDraft) error                { return nil }
func (f *fakeRepo) FinalizeMetadata(context.Context, int64, string, string, string) error { return nil }
func testHandler(repo Repository) http.Handler {
	return NewHandler(repo, 84532, time.Second, slog.New(slog.NewJSONHandler(io.Discard, nil)))
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
