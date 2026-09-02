FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS dependencies

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
	&& npm ci --omit=dev --ignore-scripts \
		--fetch-retries=5 \
		--fetch-retry-mintimeout=2000 \
		--fetch-retry-maxtimeout=60000 \
	&& npm cache clean --force

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime

ARG VCS_REF=unknown
ARG VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/TrueMichato/ThelemarTools" \
	org.opencontainers.image.revision="${VCS_REF}" \
	org.opencontainers.image.version="${VERSION}" \
	org.opencontainers.image.title="ThelemarTools Campaign Hub BFF"

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 hub \
	&& useradd --system --uid 10001 --gid hub --home-dir /app --shell /usr/sbin/nologin hub \
	&& rm -rf \
		/usr/local/lib/node_modules \
		/usr/local/bin/corepack \
		/usr/local/bin/npm \
		/usr/local/bin/npx \
		/usr/local/bin/yarn \
		/usr/local/bin/yarnpkg \
		/opt/yarn-v*

COPY --from=dependencies --chown=hub:hub /app/node_modules ./node_modules
COPY --chown=hub:hub package.json ./
COPY --chown=hub:hub server ./server
COPY --chown=hub:hub js/hub/hub-json-patch.js ./js/hub/hub-json-patch.js
COPY --chown=hub:hub js/hub/hub-semantic-hp.js ./js/hub/hub-semantic-hp.js
COPY --chown=hub:hub js/hub/hub-semantic-operations.js ./js/hub/hub-semantic-operations.js
COPY --chown=hub:hub js/hub/hub-store-error.js ./js/hub/hub-store-error.js
# Character projections read derived statistics from the authoritative Character Sheet
# calculation rather than reimplementing it, so the server needs those modules. All four
# are pure JavaScript on this path; `lib/ace.js` is behind a lazy import that the server
# never reaches.
COPY --chown=hub:hub js/parser.js ./js/parser.js
COPY --chown=hub:hub js/utils.js ./js/utils.js
COPY --chown=hub:hub js/charactersheet/charactersheet-state.js ./js/charactersheet/charactersheet-state.js
COPY --chown=hub:hub js/charactersheet/charactersheet-class-utils.js ./js/charactersheet/charactersheet-class-utils.js

USER 10001:10001
EXPOSE 5052

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:5052/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/src/index.js"]
