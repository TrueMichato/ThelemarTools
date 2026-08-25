FROM node:24.7.0-bookworm-slim AS node

FROM postgres:17.6-bookworm

ARG VCS_REF=unknown
ARG VERSION=dev

LABEL org.opencontainers.image.source="https://github.com/TrueMichato/ThelemarTools" \
	org.opencontainers.image.revision="${VCS_REF}" \
	org.opencontainers.image.version="${VERSION}" \
	org.opencontainers.image.title="ThelemarTools Campaign Hub operations"

COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --chown=postgres:postgres server/scripts ./server/scripts
RUN mkdir -p /backups \
	&& chown postgres:postgres /backups

USER postgres
