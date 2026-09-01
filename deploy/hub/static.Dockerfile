FROM node:24.7.0-bookworm-slim AS service-worker

ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /build
COPY deploy/hub/static-build/package.json deploy/hub/static-build/package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
	&& npm ci --ignore-scripts \
		--fetch-retries=5 \
		--fetch-retry-mintimeout=2000 \
		--fetch-retry-maxtimeout=60000 \
	&& npm cache clean --force

WORKDIR /site
COPY . .
RUN ln -s /build/node_modules node_modules \
	&& node node/build-sw.mjs prod \
	&& rm -rf deploy node node_modules package.json package-lock.json sw-template.js sw-injector-template.js

FROM caddy:2.8.4-alpine

COPY --from=service-worker /site /srv

CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
