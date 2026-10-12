# Deploying dailies

These steps bring the stack up on any fresh Debian or Ubuntu host that already
has Docker and the Docker Compose plugin installed. Nothing here is specific
to a hosting provider: the same commands work on a bare VM, a VPS, or a VM
rented from any cloud.

## Bring it up

```bash
git clone <this repository's URL> dailies
cd dailies

cp .env.example .env
# edit .env: fill in the model gateway / Venice / Gemini / neatlogs keys this
# deployment should use, and add the deploy-only variables below if you need
# non-default values:
#   DAILIES_OWNER_TOKEN=<a long random string>   # required to approve reels or send owner feedback
#   DAILIES_SITE_ADDRESS=your-domain.example      # default is :80 (plain HTTP on any host)
#   DAILIES_RUNS_PER_IP=3                         # default
#   DAILIES_RUNS_PER_DAY=40                       # default
#   DAILIES_RENDER_CONCURRENCY=4                  # frames drawn at once; the number of cores is a good start
#   DAILIES_RENDER_SCALE=0.75                     # 0.25, 0.5, 0.75 or 1; lower is faster on a server with no graphics card
#   DAILIES_FEATURED_RUN=run_...                  # the reel on the front page; default is the reel approved last

docker compose up -d --build
```

The first build installs the workspace, builds `@dailies/web`, so it is slow the first
time and fast on every rebuild after (Docker layer caching). The headless browser
the renderer needs is fetched on the first render after a build. Three containers
start: `web` (the Next.js app and API), `worker` (the pipeline runner), and
`caddy` (reverse proxy and, when `DAILIES_SITE_ADDRESS` is a real hostname,
automatic TLS).

## Check it is healthy

```bash
curl -s http://localhost/api/health
# {"ok":true,"db":true,"workerAgeSec":1}
```

`ok: false` with a 503 means either the database failed to open or the
worker's heartbeat is missing or older than 60 seconds — check the worker's
logs first.

## Read the logs

```bash
docker compose logs -f web
docker compose logs -f worker
docker compose logs -f caddy
```

## Update to a new commit

```bash
git pull
docker compose up -d --build
```

Compose rebuilds the image only when something changed, keeps the named
`data` volume (the SQLite database and every run's artifacts) across the
update, and restarts `web` and `worker` with the new image.

## Tear down

```bash
docker compose down
```

This stops the containers without touching the `data`, `caddy_data` or
`caddy_config` volumes. Add `-v` to also delete them.
