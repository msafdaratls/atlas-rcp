# syntax=docker/dockerfile:1

# Built on the Playwright image so Chromium + all system libraries needed for
# PDF generation (src/server/finance/pdf.ts) are present, and the Prisma query
# engine is compiled and run on the same glibc platform (Ubuntu jammy).
ARG PLAYWRIGHT_VERSION=v1.61.1-jammy

# ---- Builder ---------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
# AUTH_SECRET is only needed at runtime; a build-time placeholder is fine.
ENV AUTH_SECRET=build-time-placeholder
RUN npm run build

# ---- Runner ----------------------------------------------------------------
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Next.js standalone server bundle + static assets + public files.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Prisma schema/migrations (for `migrate deploy`) and the generated client +
# external server packages (Prisma, nodemailer, node-cron, bcryptjs, playwright)
# which are excluded from the traced bundle by serverExternalPackages.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
# Source + tsconfig are needed by the maintenance scripts under prisma/ that
# are run with tsx against a live deployment (`npm run db:templates` installs
# the blank client forms, which `prisma migrate deploy` cannot do because it
# only executes SQL and cannot copy bytes into the storage volume). They import
# the app's own storage adapter via the "@/*" path alias, so both must be
# present — the server bundle itself does not read them.
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# Chromium browsers live here in the Playwright base image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Standalone entrypoint (server.js) is emitted by `output: "standalone"`.
CMD ["node", "server.js"]
