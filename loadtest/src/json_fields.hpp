#pragma once

// The gateway and worker produce small, flat JSON objects that we control, so
// reading a field by name is enough; no JSON library needed.

#include <cstdint>
#include <cstdlib>
#include <optional>
#include <string>

namespace json_fields {

inline std::optional<size_t> value_start(const std::string& body, const std::string& key) {
  auto key_pos = body.find("\"" + key + "\"");
  if (key_pos == std::string::npos) return std::nullopt;
  auto colon = body.find(':', key_pos);
  if (colon == std::string::npos) return std::nullopt;
  auto start = body.find_first_not_of(' ', colon + 1);
  if (start == std::string::npos) return std::nullopt;
  return start;
}

inline std::optional<std::string> read_string(const std::string& body, const std::string& key) {
  auto start = value_start(body, key);
  if (!start || body[*start] != '"') return std::nullopt;
  auto end = body.find('"', *start + 1);
  if (end == std::string::npos) return std::nullopt;
  return body.substr(*start + 1, end - *start - 1);
}

inline std::optional<int64_t> read_int(const std::string& body, const std::string& key) {
  auto start = value_start(body, key);
  if (!start) return std::nullopt;
  char* end = nullptr;
  int64_t value = std::strtoll(body.c_str() + *start, &end, 10);
  if (end == body.c_str() + *start) return std::nullopt;
  return value;
}

}  // namespace json_fields
