FROM node:20-bookworm AS luajit-build
ARG LUAJIT_REV=2460b3ff93a1c955de3d62cfc825de7d68dc272e
RUN curl --fail --silent --show-error --location "https://github.com/LuaJIT/LuaJIT/archive/${LUAJIT_REV}.tar.gz" -o /tmp/luajit.tar.gz \
  && echo "5c52d06876d86aa199f9b8cdc65f6f9ac086fdfa8a4489ebf8dc4516e194550b  /tmp/luajit.tar.gz" | sha256sum -c - \
  && mkdir /tmp/luajit-src \
  && tar -xzf /tmp/luajit.tar.gz --strip-components=1 -C /tmp/luajit-src \
  && make -C /tmp/luajit-src -j2 \
  && make -C /tmp/luajit-src install PREFIX=/opt/luajit

FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV POB_DIRECTORY=/builds
ENV POB_FORK_PATH=/opt/PathOfBuilding/src
ENV POB_LUA_ENABLED=true
ENV POB_CMD=/opt/luajit/bin/luajit
ENV POB_ADAPTER_PATH=/opt/pob-mcp/lua/vanilla_stdio_bridge.lua
ENV POE_TRADE_ENABLED=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/pob-mcp

COPY --from=luajit-build /opt/luajit /opt/luajit
RUN ln -s /opt/luajit/bin/luajit /usr/local/bin/luajit

COPY packages/pob-mcp/package.json packages/pob-mcp/package-lock.json ./
RUN npm ci

COPY packages/pob-mcp/tsconfig.json ./
COPY packages/pob-mcp/src ./src
COPY packages/pob-mcp/scripts ./scripts
COPY packages/pob-mcp/lua ./lua
COPY packages/pob-mcp/tests/fixtures/occ-vortex.xml ./tests/fixtures/occ-vortex.xml
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
