# better-sqlite3 is a native module, so every stage that installs it needs a
# toolchain. Alpine has none by default.
FROM node:24-alpine AS development-dependencies-env
RUN apk add --no-cache python3 make g++
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:24-alpine AS production-dependencies-env
RUN apk add --no-cache python3 make g++
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:24-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
# Migrations run when the database is opened, so they ship with the app.
COPY --from=build-env /app/drizzle /app/drizzle
# The Seed Script and the CSV it reads, so `npm run db:seed` works against the
# volume. It can only ever add and refuses a populated database, which is what
# makes shipping it here safe.
# Only the two modules it needs, so the image does not carry the routes twice.
COPY --from=build-env /app/scripts /app/scripts
COPY --from=build-env /app/app/seed /app/app/seed
COPY --from=build-env /app/app/database /app/app/database
COPY --from=build-env /app/docs/seed /app/docs/seed
WORKDIR /app
# The whole persistence layer is one file on a Coolify volume (ADR-0005).
ENV DATABASE_PATH=/data/launch-tasks.sqlite
VOLUME ["/data"]
CMD ["npm", "run", "start"]
