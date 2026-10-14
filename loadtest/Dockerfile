FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
RUN cmake -S . -B build && cmake --build build -j
# The image only builds if the unit tests pass.
RUN ctest --test-dir build --output-on-failure

FROM debian:bookworm-slim
COPY --from=build /src/build/loadtest /usr/local/bin/loadtest
ENTRYPOINT ["loadtest"]
