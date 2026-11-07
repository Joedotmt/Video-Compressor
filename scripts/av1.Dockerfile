# Pinned companion core: FFmpeg.wasm bindings + libaom AV1 encoder.
FROM docker.io/emscripten/emsdk:3.1.40 AS builder
ENV INSTALL_DIR=/opt/av1 FFMPEG_ST=yes
ENV CFLAGS="-O3 -I/opt/av1/include" CXXFLAGS="-O3 -I/opt/av1/include" LDFLAGS="-O3 -L/opt/av1/lib"
ENV EM_PKG_CONFIG_PATH=/opt/av1/lib/pkgconfig PKG_CONFIG_PATH=/opt/av1/lib/pkgconfig
RUN apt-get update && apt-get install -y git cmake pkg-config
RUN git clone https://aomedia.googlesource.com/aom /aom --depth 1 --branch v3.9.1
RUN emcmake cmake -S /aom -B /aom/build -DCMAKE_INSTALL_PREFIX=/opt/av1 -DAOM_TARGET_CPU=generic -DCONFIG_MULTITHREAD=0 -DENABLE_DOCS=0 -DENABLE_TESTS=0 -DENABLE_EXAMPLES=0 -DENABLE_TOOLS=0 -DCMAKE_BUILD_TYPE=Release && cmake --build /aom/build -j4 && cmake --install /aom/build
RUN git clone --depth 1 --branch n5.1.4 https://github.com/FFmpeg/FFmpeg.git /src
WORKDIR /src
COPY build/ffmpeg.sh /src/build.sh
RUN sed -i 's/make -j$/make -j4/' build.sh && bash build.sh --enable-libaom
COPY src/bind /src/src/bind
COPY src/fftools /src/src/fftools
COPY build/ffmpeg-wasm.sh /src/link.sh
RUN sed -i '/  -lpostproc /d' link.sh && embuilder build sdl2 && mkdir /output && bash link.sh -laom -sEXPORT_ES6 -o /output/ffmpeg-core.js
FROM scratch
COPY --from=builder /output /
