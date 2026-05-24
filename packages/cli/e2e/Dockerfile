FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends jq curl sqlite3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# The driver copies the packed @nimrobo/superdense tarball in as superdense.tgz, then
# globally installs it. We install into /opt/superdense so the install survives
# across `docker run` invocations launched from the same image.
COPY superdense.tgz /tmp/superdense.tgz
RUN npm install -g /tmp/superdense.tgz \
 && rm /tmp/superdense.tgz \
 && superdense --version >/dev/null

COPY scenarios /work/scenarios
COPY fixtures /work/fixtures
COPY run-all.sh /work/run-all.sh
RUN chmod +x /work/run-all.sh /work/scenarios/*.sh

ENV SUPERDENSE_E2E_HOME=/tmp/e2e-home
CMD ["/work/run-all.sh"]
