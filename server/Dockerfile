FROM node:24.7.0-bookworm-slim AS dependencies

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
	&& npm ci --omit=dev --ignore-scripts \
		--fetch-retries=5 \
		--fetch-retry-mintimeout=2000 \
		--fetch-retry-maxtimeout=60000 \
	&& npm cache clean --force

FROM node:24.7.0-bookworm-slim AS runtime

ARG VCS_REF=unknown
ARG VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/TrueMichato/ThelemarTools" \
	org.opencontainers.image.revision="${VCS_REF}" \
	org.opencontainers.image.version="${VERSION}" \
	org.opencontainers.image.title="ThelemarTools Campaign Hub BFF"

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 hub \
	&& useradd --system --uid 10001 --gid hub --home-dir /app --shell /usr/sbin/nologin hub

COPY --from=dependencies --chown=hub:hub /app/node_modules ./node_modules
COPY --chown=hub:hub package.json package-lock.json ./
COPY --chown=hub:hub server ./server
COPY --chown=hub:hub js/hub/hub-json-patch.js ./js/hub/hub-json-patch.js

USER 10001:10001
EXPOSE 5052

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:5052/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/src/index.js"]
