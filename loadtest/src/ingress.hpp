#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "options.hpp"
#include "stats.hpp"

struct IngressSample {
  std::optional<int> http_status;  // empty when the request failed at the transport level
  double latency_ms = 0;
  std::string job_id;              // set only for 202 responses
};

struct IngressReport {
  size_t sent = 0;
  double elapsed_s = 0;
  int64_t accepted = 0, rejected_503 = 0, other_status = 0, transport_errors = 0;
  Distribution latency_ms;
  std::vector<std::string> job_ids;

  double achieved_rps() const { return elapsed_s > 0 ? static_cast<double>(sent) / elapsed_s : 0; }
  double success_pct() const { return sent > 0 ? 100.0 * static_cast<double>(accepted) / sent : 0; }
};

/** Phase 1: POST /v1/infer at a fixed rate for the configured duration. */
IngressReport run_ingress(const Options& options);

IngressReport summarize_ingress(const std::vector<IngressSample>& samples, double elapsed_s);
