FROM node:24.18.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN npm install --global pnpm@11.9.0

WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @giwapay/api... build
RUN pnpm --filter @giwapay/api deploy --prod --legacy /opt/giwapay-api

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=build /opt/giwapay-api /app

USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
