FROM golang:1.26-alpine AS build

WORKDIR /src
COPY apps/indexer/go.mod ./apps/indexer/go.mod
COPY apps/indexer ./apps/indexer
WORKDIR /src/apps/indexer
RUN CGO_ENABLED=0 go build -o /out/zonk-indexer ./cmd/indexer

FROM alpine:3.22
COPY --from=build /out/zonk-indexer /usr/local/bin/zonk-indexer
USER nobody
ENTRYPOINT ["/usr/local/bin/zonk-indexer"]
