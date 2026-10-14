#include "options.hpp"

#include <cstdio>
#include <functional>
#include <map>
#include <stdexcept>

namespace {

using Setter = std::function<void(Options&, const std::string&)>;

const std::map<std::string, Setter>& setters() {
  static const std::map<std::string, Setter> table = {
      {"--url", [](Options& o, const std::string& v) { o.url = v; }},
      {"--rps", [](Options& o, const std::string& v) { o.rps = std::stod(v); }},
      {"--duration", [](Options& o, const std::string& v) { o.duration_s = std::stoi(v); }},
      {"--threads", [](Options& o, const std::string& v) { o.threads = std::stoi(v); }},
      {"--collect", [](Options& o, const std::string& v) { o.collect = std::stoi(v); }},
      {"--collect-timeout", [](Options& o, const std::string& v) { o.collect_timeout_s = std::stoi(v); }},
      {"--out", [](Options& o, const std::string& v) { o.out = v; }},
  };
  return table;
}

void apply(Options& options, const std::string& flag, const std::string& value) {
  auto setter = setters().find(flag);
  if (setter == setters().end()) throw std::invalid_argument("unknown option " + flag);
  try {
    setter->second(options, value);
  } catch (const std::logic_error&) {  // std::stoi / std::stod failures
    throw std::invalid_argument("invalid value for " + flag + ": " + value);
  }
}

}  // namespace

Options parse_args(int argc, char** argv) {
  Options options;
  for (int i = 1; i < argc; i += 2) {
    if (i + 1 >= argc) throw std::invalid_argument(std::string(argv[i]) + " needs a value");
    apply(options, argv[i], argv[i + 1]);
  }
  if (options.rps <= 0 || options.threads <= 0) throw std::invalid_argument("--rps and --threads must be positive");
  return options;
}

bool wants_help(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::string(argv[i]) == "--help") return true;
  }
  return false;
}

void print_usage() {
  std::puts(
      "usage: loadtest [--url URL] [--rps N] [--duration SEC] [--threads N]\n"
      "                [--collect N] [--collect-timeout SEC] [--out FILE]");
}
