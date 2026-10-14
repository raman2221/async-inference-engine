#include "report.hpp"

#include <cstdio>
#include <fstream>
#include <sstream>
#include <stdexcept>

void print_ingress(const IngressReport& r) {
  std::printf("\n== ingress (gateway) ==\n");
  std::printf("sent %zu in %.2fs -> %.0f req/s achieved\n", r.sent, r.elapsed_s, r.achieved_rps());
  std::printf("202 accepted: %lld (%.3f%%)  503: %lld  other: %lld  transport errors: %lld\n",
              static_cast<long long>(r.accepted), r.success_pct(), static_cast<long long>(r.rejected_503),
              static_cast<long long>(r.other_status), static_cast<long long>(r.transport_errors));
  std::printf("latency ms: p50=%.2f p90=%.2f p99=%.2f max=%.2f\n", r.latency_ms.p50, r.latency_ms.p90,
              r.latency_ms.p99, r.latency_ms.max);
}

void print_completions(const CompletionReport& r) {
  std::printf("\n== end-to-end (accepted -> result written) ==\n");
  std::printf("completed %zu/%zu  failed %lld\n", r.completed, r.tracked, static_cast<long long>(r.failed));
  std::printf("e2e ms:        p50=%.1f p90=%.1f p99=%.1f mean=%.1f\n", r.e2e_ms.p50, r.e2e_ms.p90, r.e2e_ms.p99,
              r.e2e_ms.mean);
  std::printf("queue wait ms: p50=%.1f p99=%.1f\n", r.queue_wait_ms.p50, r.queue_wait_ms.p99);
  std::printf("inference ms:  p50=%.1f p99=%.1f\n", r.inference_ms.p50, r.inference_ms.p99);
  std::printf("batch sizes:  ");
  for (const auto& [size, jobs] : r.jobs_by_batch_size) std::printf(" %d:%d", size, jobs);
  std::printf("\n");
}

std::string to_json(const RunResult& result) {
  const auto& i = result.ingress;
  const auto& c = result.completions;
  std::ostringstream json;
  json << "{\"rps_target\":" << result.options.rps << ",\"duration_s\":" << result.options.duration_s
       << ",\"sent\":" << i.sent << ",\"achieved_rps\":" << i.achieved_rps() << ",\"accepted\":" << i.accepted
       << ",\"rejected_503\":" << i.rejected_503 << ",\"errors\":" << i.transport_errors + i.other_status
       << ",\"success_pct\":" << i.success_pct() << ",\"ingress_p50_ms\":" << i.latency_ms.p50
       << ",\"ingress_p99_ms\":" << i.latency_ms.p99 << ",\"completed\":" << c.completed
       << ",\"e2e_p50_ms\":" << c.e2e_ms.p50 << ",\"e2e_p90_ms\":" << c.e2e_ms.p90
       << ",\"e2e_p99_ms\":" << c.e2e_ms.p99 << ",\"e2e_mean_ms\":" << c.e2e_ms.mean
       << ",\"inference_p50_ms\":" << c.inference_ms.p50 << "}";
  return json.str();
}

void write_json_file(const std::string& path, const RunResult& result) {
  std::ofstream file(path);
  if (!file) throw std::runtime_error("cannot open " + path + " for writing");
  file << to_json(result) << "\n";
}
