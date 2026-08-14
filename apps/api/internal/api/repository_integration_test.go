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
		if _, e = repo.pool.Exec(ctx, `INSERT INTO token_metrics(chain_id,token_address,trade_count,volume,block_number,block_hash) VALUES($1,$2,$3,$4,$5,$6)`, chain, address, 3-i, 100-i, block, blockHash); e != nil {
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
	trend, e := repo.TrendingTokens(ctx, chain, 1, "")
	if e != nil || len(trend.Items) != 1 || trend.Items[0].Address != addresses[0] {
		t.Fatalf("trending=%+v err=%v", trend, e)
	}
	trend2, e := repo.TrendingTokens(ctx, chain, 2, trend.NextCursor)
	if e != nil || len(trend2.Items) != 2 || trend2.Items[0].Address == trend.Items[0].Address {
		t.Fatalf("trending page=%+v err=%v", trend2, e)
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
	if e != nil || len(activity2.Items) != 1 {
		t.Fatalf("activity page=%+v err=%v", activity2, e)
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
