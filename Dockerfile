FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV POB_DIRECTORY=/builds
ENV POB_FORK_PATH=/opt/PathOfBuilding/src
ENV POB_LUA_ENABLED=true
ENV POB_CMD=luajit
ENV POE_TRADE_ENABLED=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    luajit \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/pob-mcp

COPY packages/pob-mcp/package.json packages/pob-mcp/package-lock.json ./
RUN npm ci

COPY packages/pob-mcp/tsconfig.json ./
COPY packages/pob-mcp/src ./src
COPY packages/pob-mcp/scripts ./scripts
RUN npm run build \
  && npm prune --omit=dev

COPY vendor/PathOfBuilding/src /opt/PathOfBuilding/src
COPY vendor/PathOfBuilding/runtime /opt/PathOfBuilding/runtime
COPY vendor/PathOfBuilding/manifest.xml /opt/PathOfBuilding/manifest.xml
COPY vendor/PathOfBuilding/LICENSE.md /opt/PathOfBuilding/LICENSE.md

RUN mkdir -p /builds

VOLUME ["/builds"]

ENV NODE_ENV=production

ENTRYPOINT ["node", "/opt/pob-mcp/build/index.js"]
