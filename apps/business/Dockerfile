# Built from the REPO ROOT context (see ci-cd.yml) — workspace packages live in packages/*.
FROM node:18-alpine AS build

RUN npm install -g pnpm@10

WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/ packages/
COPY apps/business/package.json apps/business/

RUN pnpm install --frozen-lockfile --filter @bookplus/business...

COPY apps/business/ apps/business/

ARG VITE_API_URL
ARG VITE_CUSTOMER_URL
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CUSTOMER_URL=$VITE_CUSTOMER_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

RUN pnpm --filter "@bookplus/*" build && pnpm --filter @bookplus/business build

FROM node:18-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=build /repo/apps/business/dist ./dist

EXPOSE 3000

# SPA fallback: -s rewrites unknown paths to index.html
CMD ["serve", "-s", "dist", "-l", "3000"]
