package indexer

import "testing"

func TestValidateIntegrationDatabaseURLUsesDatabasePathOnly(t *testing.T) {
	for _, tc := range []struct {
		name string
		url  string
		want bool
	}{
		{name: "development database", url: "postgresql://zonk:local@127.0.0.1:5432/zonk", want: false},
		{name: "application name cannot bypass", url: "postgresql://zonk:local@127.0.0.1:5432/zonk?application_name=indexer_test", want: false},
		{name: "query database name cannot bypass", url: "postgresql://zonk:local@127.0.0.1:5432/zonk?dbname=zonk_test", want: false},
		{name: "hostname cannot bypass", url: "postgresql://zonk_test:local@zonk_test/zonk", want: false},
		{name: "explicit test database", url: "postgresql://zonk:local@127.0.0.1:5432/zonk_indexer_test?application_name=worker", want: true},
		{name: "api convention", url: "postgresql://zonk:local@127.0.0.1:5432/zonk_api_test", want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateIntegrationDatabaseURL(tc.url)
			if (err == nil) != tc.want {
				t.Fatalf("url=%q err=%v want_safe=%v", tc.url, err, tc.want)
			}
		})
	}
}
