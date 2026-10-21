# Apify base image with Node.js 22 and Google Chrome (stable).
# Chrome path is exported as APIFY_CHROME_EXECUTABLE_PATH, which the Actor picks up.
FROM apify/actor-node-puppeteer-chrome:22

# Install production dependencies first, for better layer caching.
COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional --no-audit --no-fund \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --depth=0 || true) \
    && echo "Node.js version:" && node --version \
    && echo "NPM version:" && npm --version \
    && (rm -rf ~/.npm || true)

COPY --chown=myuser:myuser . ./

CMD ["npm", "start", "--silent"]
