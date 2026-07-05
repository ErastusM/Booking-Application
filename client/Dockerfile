# Built from the REPO ROOT context (see ci-cd.yml: context: ., file: client/Dockerfile)
# because the client consumes workspace packages from packages/*.
FROM node:18-alpine AS build

RUN npm install -g pnpm@10

WORKDIR /repo

# Manifests first so dependency install stays in the Docker layer cache.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY client/package.json client/
COPY packages/design-tokens/package.json packages/design-tokens/

RUN pnpm install --frozen-lockfile --filter bookplus-client...

COPY packages/ packages/
COPY client/ client/

ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
# Don't ship source maps in production — they expose the unminified source.
ENV GENERATE_SOURCEMAP=false

RUN pnpm --filter bookplus-client run build

FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=build /repo/client/build ./build

EXPOSE 3000

CMD ["serve", "-s", "build", "-l", "3000"]
