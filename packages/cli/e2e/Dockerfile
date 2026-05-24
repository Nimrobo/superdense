FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends jq curl sqlite3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work

# The driver copies the packed @nimrobo/road42 tarball in as road42.tgz, then
# globally installs it. We install into /opt/road42 so the install survives
# across `docker run` invocations launched from the same image.
COPY road42.tgz /tmp/road42.tgz
RUN npm install -g /tmp/road42.tgz \
 && rm /tmp/road42.tgz \
 && road42 --version >/dev/null

COPY scenarios /work/scenarios
COPY fixtures /work/fixtures
COPY run-all.sh /work/run-all.sh
RUN chmod +x /work/run-all.sh /work/scenarios/*.sh

ENV ROAD42_E2E_HOME=/tmp/e2e-home
CMD ["/work/run-all.sh"]
