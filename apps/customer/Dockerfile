# Built from the REPO ROOT context (see ci-cd.yml) — workspace packages live in packages/*.
FROM node:18-alpine AS build

RUN npm install -g pnpm@10

WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/ packages/
COPY apps/customer/package.json apps/customer/

RUN pnpm install --frozen-lockfile --filter @bookplus/customer...

COPY apps/customer/ apps/customer/

ARG VITE_API_URL
ARG VITE_BUSINESS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BUSINESS_URL=$VITE_BUSINESS_URL

RUN pnpm --filter "@bookplus/*" build && pnpm --filter @bookplus/customer build

FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=build /repo/apps/customer/dist ./dist

EXPOSE 3000

# SPA fallback: -s rewrites unknown paths to index.html
CMD ["serve", "-s", "dist", "-l", "3000"]
