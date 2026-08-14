package api

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestPostgresRepositoryRejectsUnpreparedSchema(t *testing.T) {
	url := os.Getenv("UNPREPARED_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set UNPREPARED_TEST_DATABASE_URL to run schema gate test")
	}
	repo, err := NewPostgresRepository(context.Background(), url)
	if err == nil {
		repo.Close()
		t.Fatal("API accepted an unprepared schema")
	}
	if !strings.Contains(err.Error(), "db/migrate.sh") {
		t.Fatalf("unexpected schema error: %v", err)
	}
}

func TestPostgresMetadataFinalizeIsIdempotentAndProjectsIntoLists(t *testing.T) {
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set API_TEST_DATABASE_URL to run PostgreSQL API integration tests")
	}
	ctx := context.Background()
	repo, err := NewPostgresRepository(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	const chain int64 = 84532
	const block int64 = 499999980
	const draftID = "live-finalize-regression"
	const token = "0x0000000000000000000000000000000000000f01"
	const creator = "0x0000000000000000000000000000000000000f02"
	const txHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01"
	const blockHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff02"
	cleanup := func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metadata_drafts WHERE draft_id=$1`, draftID)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND transaction_hash=$2`, chain, txHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}
	cleanup()
	defer cleanup()
	if _, err = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,'0xparent',0)`, chain, block, blockHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.SaveMetadataDraft(ctx, MetadataDraft{ID: draftID, Name: "Zonk Live Test", Symbol: "ZLT", InitialSupply: "1000000000000000000000000000", Description: "live description", ImageURL: "/objects/live.png", MetadataURL: "/objects/live.json"}); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != ErrNotFound {
		t.Fatalf("finalize before indexing error=%v", err)
	}
	if _, err = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,protocol_version,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'Zonk Live Test','ZLT',1000000000000000000000000000,'endpoint-cp-v3',$4,$5,$6,7)`, chain, token, creator, block, blockHash, txHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != nil {
		t.Fatal(err)
	}
	if err = repo.FinalizeMetadata(ctx, chain, draftID, token, txHash); err != nil {
		t.Fatalf("repeated identical finalize was not idempotent: %v", err)
	}
	page, err := repo.ListTokens(ctx, chain, 100, "")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if strings.EqualFold(item.Address, token) {
			found = item.Description == "live description"
		}
	}
	if !found {
		t.Fatalf("finalized V3 token absent or malformed in token list: %+v", page.Items)
	}
	profile, err := repo.Creator(ctx, chain, creator, 100, "")
	if err != nil || profile.TokenCount != 1 || len(profile.Tokens) != 1 || !strings.EqualFold(profile.Tokens[0].Address, token) {
		t.Fatalf("creator projection=%+v err=%v", profile, err)
	}
}

func TestPostgresRepositoryIndexedData(t *testing.T) {
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set API_TEST_DATABASE_URL to run PostgreSQL API integration tests")
	}
	ctx := context.Background()
	repo, e := NewPostgresRepository(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer repo.Close()
	page, e := repo.ListTokens(ctx, 84532, 2, "")
	if e != nil {
		t.Fatal(e)
	}
	if page.Items == nil {
		t.Fatal("expected non-nil empty collection")
	}
	if len(page.Items) > 2 {
		t.Fatalf("items=%d", len(page.Items))
	}
	if len(page.Items) == 0 {
		return
	}
	token := page.Items[0]
	detail, e := repo.Token(ctx, 84532, token.Address)
	if e != nil {
		t.Fatal(e)
	}
	if detail.Address != token.Address {
		t.Fatalf("detail=%s list=%s", detail.Address, token.Address)
	}
	trades, e := repo.Trades(ctx, 84532, token.Address, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if trades.Items == nil {
		t.Fatal("expected non-nil trades collection")
	}
	activity, e := repo.Activity(ctx, 84532, token.Address, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if activity.Items == nil {
		t.Fatal("expected non-nil activity collection")
	}
	creator, e := repo.Creator(ctx, 84532, token.Creator, 10, "")
	if e != nil {
		t.Fatal(e)
	}
	if creator.TokenCount < 1 {
		t.Fatalf("creator token count=%d", creator.TokenCount)
	}
	if _, e = repo.Token(ctx, 84532, "0x0000000000000000000000000000000000000001"); e != ErrNotFound {
		t.Fatalf("unknown token error=%v", e)
	}
}

func TestPostgresRepositoryKeysetPagination(t *testing.T) {
	url := os.Getenv("API_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set API_TEST_DATABASE_URL to run PostgreSQL API integration tests")
	}
	ctx := context.Background()
	repo, e := NewPostgresRepository(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer repo.Close()
	const chain int64 = 84532
	const block int64 = 499999991
	// The fixture uses a unique height and deterministic addresses, then removes
	// every dependent row so it cannot affect the user's indexed data.
	blockHash := "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	addresses := []string{
		"0x00000000000000000000000000000000000000a1",
		"0x00000000000000000000000000000000000000a2",
		"0x00000000000000000000000000000000000000a3",
	}
	creator := "0x00000000000000000000000000000000000000c1"
	if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_blocks(chain_id,block_number,block_hash,parent_hash,block_timestamp) VALUES($1,$2,$3,$4,0)`, chain, block, blockHash, "0xparent"); e != nil {
		t.Fatal(e)
	}
	defer func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_trade_buckets WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_events WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM trades WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM token_metrics WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM tokens WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
		_, _ = repo.pool.Exec(ctx, `DELETE FROM chain_blocks WHERE chain_id=$1 AND block_hash=$2`, chain, blockHash)
	}()
	for i, address := range addresses {
		tx := "0x" + strings.Repeat(string(rune('b'+i)), 64)
		if _, e = repo.pool.Exec(ctx, `INSERT INTO tokens(chain_id,token_address,creator_address,name,symbol,initial_supply,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,$4,$5,1000,$6,$7,$8,$9)`, chain, address, creator, "Fixture", "FIX", block, blockHash, tx, i); e != nil {
			t.Fatal(e)
		}
		if _, e = repo.pool.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,volume,recent_volume,recent_trade_count,recent_trader_count,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, chain, address, 3-i, 100-i, 300-i*100, 3-i, 2-i, block, blockHash); e != nil {
			t.Fatal(e)
		}
	}
	page, e := repo.ListTokens(ctx, chain, 1, "")
	if e != nil {
		t.Fatal(e)
	}
	if len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatalf("first token page=%+v", page)
	}
	page2, e := repo.ListTokens(ctx, chain, 2, page.NextCursor)
	if e != nil {
		t.Fatal(e)
	}
	if len(page2.Items) != 2 || page2.Items[0].Address == page.Items[0].Address || page2.Items[1].Address == page.Items[0].Address {
		t.Fatalf("keyset token pages overlap: %+v / %+v", page, page2)
	}
	if _, e = repo.ListTokens(ctx, chain, 1, "not-a-cursor"); e != ErrInvalidCursor {
		t.Fatalf("invalid token cursor=%v", e)
	}
	search, e := repo.SearchTokens(ctx, chain, "fixture", 1, "")
	if e != nil || len(search.Items) != 1 || search.NextCursor == "" {
		t.Fatalf("search=%+v err=%v", search, e)
	}
	search2, e := repo.SearchTokens(ctx, chain, "fixture", 2, search.NextCursor)
	if e != nil || len(search2.Items) != 2 || search2.Items[0].Address == search.Items[0].Address {
		t.Fatalf("search page=%+v err=%v", search2, e)
	}
	if _, e = repo.SearchTokens(ctx, chain, "different", 1, search.NextCursor); e != ErrInvalidCursor {
		t.Fatalf("search cursor query mismatch=%v", e)
	}
	trend, e := repo.TrendingTokens(ctx, chain, 1, "")
	if e != nil || len(trend.Items) != 1 || trend.Items[0].Address != addresses[0] {
		t.Fatalf("trending=%+v err=%v", trend, e)
	}
	trend2, e := repo.TrendingTokens(ctx, chain, 2, trend.NextCursor)
	if e != nil || len(trend2.Items) != 2 || trend2.Items[0].Address == trend.Items[0].Address {
		t.Fatalf("trending page=%+v err=%v", trend2, e)
	}
	if _, e = repo.pool.Exec(ctx, `UPDATE token_metrics SET recent_volume=1,recent_trade_count=1,recent_trader_count=1 WHERE chain_id=$1 AND token_address = ANY($2::text[])`, chain, addresses); e != nil {
		t.Fatal(e)
	}
	tiedTrend, e := repo.TrendingTokens(ctx, chain, 3, "")
	if e != nil || len(tiedTrend.Items) != 3 || tiedTrend.Items[0].Address != addresses[0] || tiedTrend.Items[1].Address != addresses[1] || tiedTrend.Items[2].Address != addresses[2] {
		t.Fatalf("deterministic trending ties=%+v err=%v", tiedTrend, e)
	}
	creatorPage, e := repo.CreatorTokens(ctx, chain, creator, 1, "")
	if e != nil || len(creatorPage.Items) != 1 {
		t.Fatalf("creator page=%+v err=%v", creatorPage, e)
	}
	creatorPage2, e := repo.CreatorTokens(ctx, chain, creator, 2, creatorPage.NextCursor)
	if e != nil || len(creatorPage2.Items) != 2 || creatorPage2.Items[0].Address == creatorPage.Items[0].Address {
		t.Fatalf("creator page=%+v err=%v", creatorPage2, e)
	}
	for i := 0; i < 3; i++ {
		tx := "0x" + strings.Repeat(string(rune('d'+i)), 64)
		if _, e = repo.pool.Exec(ctx, `INSERT INTO trades(chain_id,token_address,trader_address,side,token_amount,reserve_amount,curve_value,protocol_fee,creator_fee,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,$3,'buy',1,1,$4,0,0,$5,$6,$7,$8)`, chain, addresses[0], creator, 10+i, block, blockHash, tx, i); e != nil {
			t.Fatal(e)
		}
		if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,contract_address,topic0,event_name,decoded) VALUES($1,$2,$3,$4,$5,$6,$7,'Trade',jsonb_build_object('token',$8::text))`, chain, block, blockHash, tx, i, addresses[0], "0xtopic", addresses[0]); e != nil {
			t.Fatal(e)
		}
	}
	transferTX := "0x" + strings.Repeat("e", 64)
	if _, e = repo.pool.Exec(ctx, `INSERT INTO chain_events(chain_id,block_number,block_hash,transaction_hash,log_index,contract_address,topic0,event_name,decoded) VALUES($1,$2,$3,$4,99,$5,$6,'Transfer',jsonb_build_object('from','0x0000000000000000000000000000000000000001','to','0x0000000000000000000000000000000000000002','value','1'))`, chain, block, blockHash, transferTX, addresses[0], "0xtransfer"); e != nil {
		t.Fatal(e)
	}
	if _, e = repo.pool.Exec(ctx, `INSERT INTO token_trade_buckets(chain_id,token_address,bucket_start,trade_count,buy_count,sell_count,volume,unique_trader_count,open_price,high_price,low_price,close_price,block_number,block_hash,transaction_hash,log_index) VALUES($1,$2,3600,1,1,0,10,1,7,7,7,7,$3,$4,$5,1),($1,$2,7200,1,0,1,11,1,7,8,6,8,$3,$4,$6,2)`, chain, addresses[0], block, blockHash, "0x"+strings.Repeat("f", 64), "0x"+strings.Repeat("a", 64)); e != nil {
		t.Fatal(e)
	}
	trades, e := repo.Trades(ctx, chain, addresses[0], 2, "")
	if e != nil || len(trades.Items) != 2 || trades.NextCursor == "" {
		t.Fatalf("trades=%+v err=%v", trades, e)
	}
	trades2, e := repo.Trades(ctx, chain, addresses[0], 2, trades.NextCursor)
	if e != nil || len(trades2.Items) != 1 || trades2.Items[0].TransactionHash == trades.Items[1].TransactionHash {
		t.Fatalf("trade pages=%+v / %+v err=%v", trades, trades2, e)
	}
	activity, e := repo.Activity(ctx, chain, addresses[0], 2, "")
	if e != nil || len(activity.Items) != 2 || activity.NextCursor == "" {
		t.Fatalf("activity=%+v err=%v", activity, e)
	}
	activity2, e := repo.Activity(ctx, chain, addresses[0], 2, activity.NextCursor)
	if e != nil || len(activity2.Items) != 2 {
		t.Fatalf("activity page=%+v err=%v", activity2, e)
	}
	allActivity, e := repo.Activity(ctx, chain, addresses[0], 10, "")
	transferFound := false
	for _, event := range allActivity.Items {
		transferFound = transferFound || event.EventName == "Transfer"
	}
	if e != nil || len(allActivity.Items) != 4 || !transferFound {
		t.Fatalf("transfer activity=%+v err=%v", allActivity, e)
	}
	chart, e := repo.Chart(ctx, chain, addresses[0], 10)
	if e != nil || len(chart.Items) != 2 || chart.Items[0].BucketStart != 3600 || chart.Items[1].OpenPrice == nil || *chart.Items[1].OpenPrice != "7" || chart.Items[1].HighPrice == nil || *chart.Items[1].HighPrice != "8" || chart.Items[1].LowPrice == nil || *chart.Items[1].LowPrice != "6" || chart.Items[1].ClosePrice == nil || *chart.Items[1].ClosePrice != "8" {
		t.Fatalf("chart=%+v err=%v", chart, e)
	}
	emptyChart, e := repo.Chart(ctx, chain, addresses[1], 10)
	if e != nil || emptyChart.Items == nil || len(emptyChart.Items) != 0 {
		t.Fatalf("empty chart=%+v err=%v", emptyChart, e)
	}
	creatorProfile, e := repo.Creator(ctx, chain, creator, 1, "")
	if e != nil || creatorProfile.Volume != "33" {
		t.Fatalf("creator volume=%q err=%v", creatorProfile.Volume, e)
	}
	empty, e := repo.ListTokens(ctx, chain, 1, encodeCursor(pageCursor{Kind: "tokens", BlockNumber: 0, TokenAddress: addresses[0]}))
	if e != nil || len(empty.Items) != 0 || empty.Items == nil {
		t.Fatalf("empty page=%+v err=%v", empty, e)
	}
}
