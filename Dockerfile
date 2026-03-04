FROM curlimages/curl AS fetch

RUN curl -fsSL -o /tmp/server.tar.gz \
  "https://github.com/alexkroman/aai/releases/latest/download/aai-server-linux-x64.tar.gz" \
  && tar xz -C /tmp -f /tmp/server.tar.gz

FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=fetch /tmp/server /server

EXPOSE 8080

ENTRYPOINT ["/server"]
