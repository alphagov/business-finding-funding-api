# The funding data API as a container image. See "Run it in Docker" in
# README.md.
#
# Built in stages: the build stage compiles the TypeScript, and the final
# image holds only the compiled API, its production dependencies, the
# database migrations and the data files the release step imports.

# Stage: base image, shared by the other stages. Pinned to an exact version
# and digest. Dependabot keeps it up to date (see .github/dependabot.yml).
FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base

ARG BUILD_NUMBER
ARG GIT_REF
ARG GIT_BRANCH

# Every image must say what it was built from.
RUN test -n "$BUILD_NUMBER" || (echo "BUILD_NUMBER not set" && false)
RUN test -n "$GIT_REF" || (echo "GIT_REF not set" && false)
RUN test -n "$GIT_BRANCH" || (echo "GIT_BRANCH not set" && false)

WORKDIR /app

# Stage: compile the TypeScript
FROM base AS build

COPY package.json package-lock.json ./

# Packages' install scripts are not run, as a defence against a compromised
# package. None of the API's dependencies needs them.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Stage: the image that runs
FROM base

ARG BUILD_NUMBER
ARG GIT_REF
ARG GIT_BRANCH

ENV NODE_ENV=production \
    BUILD_NUMBER=${BUILD_NUMBER} \
    GIT_REF=${GIT_REF} \
    GIT_BRANCH=${GIT_BRANCH}

LABEL org.opencontainers.image.title="Funding data API" \
      org.opencontainers.image.source="https://github.com/govuk-business/business-finding-funding-api" \
      org.opencontainers.image.revision="${GIT_REF}" \
      org.opencontainers.image.licenses="MIT"

# The files belong to root, and the API runs as the unprivileged node user
# (1000), so it cannot change its own code.
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY data ./data

USER 1000

EXPOSE 3001

# The API. The release step (migrations, then the TPX import) runs from the
# same image with a different command: see compose.yaml.
CMD ["node", "dist/server.js"]
