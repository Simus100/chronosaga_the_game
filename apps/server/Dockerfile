FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @paa/server build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@paa/server", "start"]
