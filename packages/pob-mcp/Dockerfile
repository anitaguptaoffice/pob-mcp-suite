FROM node:20-bookworm

ARG POB_REPO=https://github.com/anitaguptaoffice/PathOfBuilding.git
ARG POB_REF=api-stdio

ENV DEBIAN_FRONTEND=noninteractive
ENV POB_DIRECTORY=/builds
ENV POB_FORK_PATH=/opt/PathOfBuilding/src
ENV POB_LUA_ENABLED=true
ENV POB_CMD=luajit
ENV POE_TRADE_ENABLED=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    luajit \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${POB_REF}" "${POB_REPO}" /opt/PathOfBuilding

WORKDIR /opt/pob-mcp

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build \
  && npm prune --omit=dev

RUN mkdir -p /builds

VOLUME ["/builds"]

ENV NODE_ENV=production

ENTRYPOINT ["node", "/opt/pob-mcp/build/index.js"]
