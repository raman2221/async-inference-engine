FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
RUN cmake -S . -B build && cmake --build build -j

FROM debian:bookworm-slim
COPY --from=build /src/build/loadtest /usr/local/bin/loadtest
ENTRYPOINT ["loadtest"]
