#pragma once

#include <httplib.h>

#include <memory>
#include <string>

inline std::unique_ptr<httplib::Client> make_client(const std::string& url) {
  auto client = std::make_unique<httplib::Client>(url);
  client->set_keep_alive(true);  // reuse TCP connections; no handshake per request
  // httplib writes headers and body as separate packets. With Nagle's
  // algorithm on, the body waits for the server's delayed ACK (~40 ms), which
  // capped throughput at connections / 40ms. TCP_NODELAY sends immediately.
  client->set_tcp_nodelay(true);
  client->set_connection_timeout(5);
  client->set_read_timeout(10);
  return client;
}
