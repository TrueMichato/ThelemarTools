ARG HUB_TEST_BASE_IMAGE=thelemartools-hub-bff:e2e-base
FROM ${HUB_TEST_BASE_IMAGE}

ENV NODE_ENV=test
COPY --chown=hub:hub test/e2e/hub/test-server.mjs ./test/e2e/hub/test-server.mjs

CMD ["node", "test/e2e/hub/test-server.mjs"]
