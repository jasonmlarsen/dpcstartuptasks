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
# The Seed Script is deliberately absent: the dangerous capability lives
# outside the running app, where no bug can make it reachable (#11). Seeding
# is done from a checkout against the volume's file, like every other
# operator act here.
WORKDIR /app
# The whole persistence layer is one file on a Coolify volume (ADR-0005).
ENV DATABASE_PATH=/data/launch-tasks.sqlite
VOLUME ["/data"]
CMD ["npm", "run", "start"]
