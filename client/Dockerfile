# Built from the REPO ROOT context (see ci-cd.yml: context: ., file: client/Dockerfile)
# because the client consumes workspace packages from packages/*.
FROM node:18-alpine AS build

RUN npm install -g pnpm@10

WORKDIR /repo

# Manifests + package sources first so dependency install stays in the Docker
# layer cache (packages/* are tiny; the api-client's prepare script compiles
# during install and needs its src/ present).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/ packages/
COPY client/package.json client/

RUN pnpm install --frozen-lockfile --filter bookplus-client...

COPY client/ client/

ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
# Don't ship source maps in production — they expose the unminified source.
ENV GENERATE_SOURCEMAP=false

# Explicit package build (idempotent with the install-time prepare) keeps the
# pipeline deterministic even if lifecycle-script behavior changes.
RUN pnpm --filter "@bookplus/*" build && pnpm --filter bookplus-client run build

FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=build /repo/client/build ./build

EXPOSE 3000

CMD ["serve", "-s", "build", "-l", "3000"]
