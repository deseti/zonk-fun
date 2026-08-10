FROM golang:1.26-alpine AS build

WORKDIR /src
COPY apps/api/go.mod ./apps/api/go.mod
COPY apps/api ./apps/api
WORKDIR /src/apps/api
RUN CGO_ENABLED=0 go build -o /out/zonk-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache wget
COPY --from=build /out/zonk-api /usr/local/bin/zonk-api
EXPOSE 4000
USER nobody
ENTRYPOINT ["/usr/local/bin/zonk-api"]
