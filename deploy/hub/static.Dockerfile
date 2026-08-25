FROM caddy:2.8.4-alpine

COPY . /srv

CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
